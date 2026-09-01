import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  App,
  Badge,
  Button,
  Descriptions,
  Input,
  Listy,
  Switch,
  Tabs,
  Tag,
  theme,
  Tooltip,
  Typography,
} from "antd";
import type { ListyRef } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DownOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  UpOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { FlowControl } from "@mamep2026/domain";
import type { CommunicationLogEntry } from "@mamep2026/logging";
import {
  communicationLogExportFileName,
  serializeCommunicationLogToCsv,
} from "@mamep2026/logging";
import { useAppStore } from "../app-store";
import { STATE_DOT_COLOR } from "../connection-state";
import { isNearBottom } from "../log-scroll";
import { usePluginContributions } from "../plugin/use-contributions";
import {
  PluginPanels,
  type PanelContribution,
} from "./plugin-contributions";

/**
 * 通信日志单行（性能优化）：memo 后追加新日志时，旧行 entry 引用不变即跳过整棵子树重渲染，
 * 避免高频轮询日志把 O(n) 列表重渲染（含 toLocaleTimeString 与 antd Tag 开销）摊到每次 append。
 */
const CommLogRow = memo(function CommLogRow({
  entry,
}: {
  entry: CommunicationLogEntry;
}) {
  const { t } = useTranslation();
  return (
    <div className="log-row">
      <span className="log-row__time">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <Tag
        color={entry.direction === "request" ? "blue" : "green"}
        icon={
          entry.direction === "request" ? (
            <ArrowUpOutlined />
          ) : (
            <ArrowDownOutlined />
          )
        }
      >
        {entry.direction === "request"
          ? t("panel.request")
          : t("panel.response")}
      </Tag>
      <span className="log-row__text">
        <Typography.Text code>{entry.bytesHex}</Typography.Text>
      </span>
    </div>
  );
});
CommLogRow.displayName = "CommLogRow";

export function BottomPanel(): React.ReactNode {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  // 与 antd Listy 内部 itemHeight 同公式（listy 源码：fontHeight + itemPaddingBlock*2，
  // fontHeight = round(lineHeight * fontSizeMD)，默认 fontSizeMD === fontSize），
  // 通过 CSS 变量同步给 .log-row，保证虚拟列表行高与实测行高一致（滚动位置准确）。
  const logRowHeight =
    Math.round(token.lineHeight * token.fontSize) +
    (token.Listy?.itemPaddingBlock ?? token.paddingSM) * 2;
  const messages = useAppStore((s) => s.messages);
  const commLog = useAppStore((s) => s.commLog);
  const clearCommLog = useAppStore((s) => s.clearCommLog);
  const notes = useAppStore((s) => s.workspace.notes);
  const setNotes = useAppStore((s) => s.setNotes);
  const host = useAppStore((s) => s.host);
  const setPanelLayout = useAppStore((s) => s.setPanelLayout);
  const panelLayout = useAppStore((s) => s.workspace.panelLayout);
  const properties = host?.getCommProperties() ?? null;
  const connectionState = useAppStore((s) => s.connectionState);
  // 插件面板贡献（2026-08-31，ADR-039）：有贡献时显示「插件」页签。
  const pluginPanels = usePluginContributions<PanelContribution[]>(
    host,
    "panels",
  );

  const collapsed = panelLayout.bottomPanelCollapsed;
  const activeTab = panelLayout.activeBottomTab;

  // 折叠时新错误到达 → Messages 标签红点（事件驱动，避免在 effect 中 setState）。
  const [seenCount, setSeenCount] = useState(0);
  const lastErrorIndex = useMemo(() => {
    let index = -1;
    messages.forEach((message, i) => {
      if (message.level === "error") index = i;
    });
    return index;
  }, [messages]);
  const unseenError =
    lastErrorIndex >= seenCount && (collapsed || activeTab !== "messages");

  const markSeen = (): void => setSeenCount(messages.length);

  const toggleCollapsed = (): void => {
    if (collapsed) markSeen();
    setPanelLayout({ bottomPanelCollapsed: !collapsed });
  };

  const handleTabChange = (key: string): void => {
    // 折叠状态点击标签：展开并切换（折叠时内容不可见）。
    if (key === "messages") markSeen();
    setPanelLayout({ activeBottomTab: key, bottomPanelCollapsed: false });
  };

  const levelColor = (level: string): string =>
    level === "error" ? "red" : level === "warning" ? "orange" : "blue";
  const levelIcon = (level: string): React.ReactNode =>
    level === "error" ? (
      <CloseCircleOutlined />
    ) : level === "warning" ? (
      <WarningOutlined />
    ) : (
      <InfoCircleOutlined />
    );

  // 通信日志：自动滚动开关（会话级，不持久化）+ 跟随状态。
  const [autoScroll, setAutoScroll] = useState(true);
  const stickToBottom = useRef(true);
  const listyRef = useRef<ListyRef | null>(null);
  // Listy 的 height 是数字 prop，必须跟随面板内容区实际高度（面板高度可拖拽调节）。
  const commLogAreaRef = useRef<HTMLDivElement | null>(null);
  // 非零默认避免首次渲染退化为全量渲染；后续由渲染驱动测量修正。
  const [commListHeight, setCommListHeight] = useState(120);

  // 每次渲染后同步测量 .comm-log__area 高度 → Listy。渲染驱动天然跟随 Splitter 拖拽触发的
  // 面板高度变化（拖拽 → MamepApp 重渲染 → 本组件重渲染 → 测量）。setState 相同值不触发
  // 重渲染，开销可忽略。jsdom 下 clientHeight 为 0 → 保持默认 → Listy 非虚拟渲染全部（单测安全）。
  // 注：故意不加依赖数组（须跟随每次渲染），eslint 无法静态证明无更新环，故禁用该规则。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (activeTab !== "commlog") return;
    const el = commLogAreaRef.current;
    if (el === null) return;
    setCommListHeight(el.clientHeight);
  });

  // 新日志到达时，若开关开启且用户未上滚离开底部，则自动滚动到底部。
  // 性能优化：rAF 合并高频 append，避免每次追加同步调用 scrollTo。
  // 利用 antd Listy 官方命令式滚动 API：scrollTo({ key, align: "bottom" })；key 为末条日志的
  // 稳定 seq（rowKey）。scrollTo 触发的滚动同样会触发 onScroll → isNearBottom，贴底判定一致。
  useEffect(() => {
    if (!autoScroll || !stickToBottom.current || commLog.length === 0) return;
    const lastSeq = commLog[commLog.length - 1]?.seq;
    if (lastSeq === undefined) return;
    const handle = requestAnimationFrame(() => {
      listyRef.current?.scrollTo({ key: lastSeq, align: "bottom" });
    });
    return () => cancelAnimationFrame(handle);
  }, [commLog, autoScroll]);

  const handleCommScroll = (e: React.UIEvent<HTMLElement>): void => {
    const el = e.currentTarget;
    stickToBottom.current = isNearBottom(
      el.scrollHeight,
      el.scrollTop,
      el.clientHeight,
    );
  };

  const handleCopy = async (): Promise<void> => {
    if (host === null || commLog.length === 0) return;
    const text = commLog
      .map((entry) => {
        const direction =
          entry.direction === "request"
            ? t("panel.request")
            : t("panel.response");
        return `[${new Date(entry.timestamp).toLocaleTimeString()}] ${direction}  ${entry.bytesHex}`;
      })
      .join("\n");
    const result = await host.copyTextToClipboard(text);
    if (result.ok) {
      message.success(t("panel.copySuccess"));
    } else {
      message.error(t("errors.clipboardUnavailable"));
    }
  };

  // 通信日志 CSV 导出（2026-08-28，PRD §8.3 P1）：仅导出当前缓冲区，不提供搜索/过滤。
  // 导出前按 PRD §15.3.6 / TECH_DESIGN §20.6 提示可能包含设备地址与通信数据。
  // 序列化在 packages/logging（纯函数）；平台落盘/下载经 AppHost.saveTextFile 端口。
  const handleExport = async (): Promise<void> => {
    if (host === null || commLog.length === 0) return;
    await modal.confirm({
      title: t("panel.exportConfirmTitle"),
      content: t("panel.exportConfirmContent"),
      okText: t("panel.export"),
      cancelText: t("connection.cancel"),
      onOk: async () => {
        const csv = serializeCommunicationLogToCsv(commLog);
        const suggestedName = communicationLogExportFileName(commLog);
        const result = await host.saveTextFile({
          suggestedName,
          content: csv,
          mimeType: "text/csv",
        });
        if (!result.ok) {
          message.error(t("panel.exportFailed"));
          return;
        }
        if (result.value.saved) {
          message.success(t("panel.exportSuccess"));
        } else {
          // 用户在保存对话框中取消：非错误，静默提示已取消。
          message.info(t("panel.exportCancelled"));
        }
      },
    });
  };

  const messagesTab = (
    <div className="log-list">
      {messages.length === 0 ? (
        <Typography.Text type="secondary">—</Typography.Text>
      ) : (
        messages.map((message, index) => (
          <div
            key={index}
            className={
              "log-row" +
              (message.level === "error"
                ? " log-row--error"
                : message.level === "warning"
                  ? " log-row--warning"
                  : "")
            }
          >
            <span className="log-row__time">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
            <Tag
              className="log-row__level"
              color={levelColor(message.level)}
              icon={levelIcon(message.level)}
            >
              {message.level}
            </Tag>
            <span className="log-row__text">
              {i18n.exists(message.messageKey)
                ? t(message.messageKey, {
                    address: message.detail ?? "",
                    detail: message.detail ?? "",
                    ...(message.params ?? {}),
                  })
                : message.messageKey}
            </span>
            {message.detail !== null && !i18n.exists(message.messageKey) ? (
              <span className="log-row__detail">{message.detail}</span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );

  const commLogTab = (
    <div
      className="comm-log"
      style={
        {
          "--mamep-log-row-height": `${logRowHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="comm-log__toolbar">
        {/* 视图开关组（Auto scroll）与操作组（Copy/Clear）分组 + 竖分隔，与主表工具栏同语言 */}
        <span className="comm-log__toolbar-group">
          <Tooltip title={t("panel.autoScroll")}>
            <span className="comm-log__autoscroll">
              <Switch
                size="small"
                checked={autoScroll}
                onChange={setAutoScroll}
                aria-label={t("panel.autoScroll")}
              />
              <Typography.Text>{t("panel.autoScroll")}</Typography.Text>
            </span>
          </Tooltip>
        </span>
        <span className="comm-log__toolbar-sep" aria-hidden="true" />
        <span className="comm-log__toolbar-group">
          {/* Copy 为主操作：antd 原生 primary outlined（品牌描边，hover 自动填充强调） */}
          <Button
            size="small"
            color="primary"
            variant="outlined"
            icon={<CopyOutlined />}
            disabled={commLog.length === 0 || host === null}
            onClick={() => void handleCopy()}
          >
            {t("panel.copy")}
          </Button>
          {/* Export：通信日志 CSV 导出（PRD §8.3 P1，2026-08-28） */}
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={commLog.length === 0 || host === null}
            onClick={() => void handleExport()}
          >
            {t("panel.export")}
          </Button>
          <Button size="small" icon={<ClearOutlined />} onClick={clearCommLog}>
            {t("panel.clear")}
          </Button>
        </span>
      </div>
      <div ref={commLogAreaRef} className="comm-log__area">
        {commLog.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Listy<CommunicationLogEntry>
            ref={listyRef}
            virtual
            items={commLog}
            rowKey="seq"
            height={commListHeight}
            onScroll={handleCommScroll}
            classNames={{ root: "comm-log__list log-list" }}
            // antd Listy 的 item 默认带 itemPaddingBlock 纵向 padding，会叠加在 .log-row 高度上
            // 造成实际行高 > itemHeight；覆盖为 0，使行高由 .log-row 决定（= logRowHeight ≈ itemHeight）。
            styles={{ item: { padding: 0 } }}
            itemRender={(entry) => <CommLogRow entry={entry} />}
          />
        )}
      </div>
    </div>
  );

  const flowControlLabels: Record<FlowControl, string> = {
    off: t("connection.flowOff"),
    "rts-cts": t("connection.flowRtsCts"),
    "xon-xoff": t("connection.flowXonXoff"),
  };

  const propertiesTab =
    properties === null ? null : (
      /* 通信属性读数面板（2026-08-19 精修）：容器 + 小写大写字幕标签 + 统一值字体，
         取色走令牌，浅/深主题自动适配。 */
      <div className="comm-props">
        <Descriptions
          size="small"
          column={3}
          classNames={{
            label: "comm-props__label",
            content: "comm-props__content",
          }}
        >
          <Descriptions.Item label={t("panel.serialPort")}>
            {properties.portLabel ?? "-"}
          </Descriptions.Item>
          {properties.protocol === "tcp" ? (
            <>
              <Descriptions.Item label={t("connection.unitId")}>
                {properties.unitId ?? 0}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.timeout")}>
                {properties.timeoutMs}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.retry")}>
                {properties.retryCount}
              </Descriptions.Item>
            </>
          ) : (
            <>
              <Descriptions.Item label={t("panel.baud")}>
                {properties.baudRate}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.dataBits")}>
                {properties.dataBits}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.stopBits")}>
                {properties.stopBits}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.parity")}>
                {properties.parity}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.flowControl")}>
                {flowControlLabels[properties.flowControl]}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.timeout")}>
                {properties.timeoutMs}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.retry")}>
                {properties.retryCount}
              </Descriptions.Item>
              <Descriptions.Item label={t("connection.rxDelay")}>
                {properties.rxDelayMs}
              </Descriptions.Item>
            </>
          )}
          <Descriptions.Item label={t("panel.status")}>
            {/* 与顶栏状态胶囊同语义：圆点 + 文字，data-conn-state 供 CSS 按连接态着色 */}
            <span
              className="comm-props__status"
              data-conn-state={connectionState}
            >
              <span
                className="comm-props__status-dot"
                style={{ backgroundColor: STATE_DOT_COLOR[connectionState] }}
              />
              {t(`state.${connectionState}`)}
            </span>
          </Descriptions.Item>
        </Descriptions>
      </div>
    );

  const notesTab = (
    <Input.TextArea
      rows={6}
      placeholder={t("panel.notesPlaceholder")}
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
    />
  );

  return (
    <div
      className={
        collapsed ? "bottom-panel bottom-panel--collapsed" : "bottom-panel"
      }
    >
      <Tabs
        size="small"
        activeKey={activeTab}
        onChange={handleTabChange}
        tabBarExtraContent={
          <Button
            type="text"
            size="small"
            aria-label={collapsed ? t("panel.expand") : t("panel.collapse")}
            icon={collapsed ? <UpOutlined /> : <DownOutlined />}
            onClick={toggleCollapsed}
          />
        }
        items={[
          {
            key: "messages",
            label: (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {t("panel.messages")}
                <Badge dot={unseenError} />
              </span>
            ),
            children: messagesTab,
          },
          {
            key: "commlog",
            label: t("panel.commLog"),
            children: commLogTab,
          },
          {
            key: "properties",
            label: t("panel.properties"),
            children: propertiesTab,
          },
          { key: "notes", label: t("panel.notes"), children: notesTab },
          ...(pluginPanels.length > 0
            ? [
                {
                  key: "plugins",
                  label: t("panel.plugins"),
                  children: <PluginPanels host={host} />,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
