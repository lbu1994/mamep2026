import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App,
  Badge,
  Button,
  Descriptions,
  Input,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CopyOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import type { FlowControl } from "@mamep2026/domain";
import type { CommunicationLogEntry } from "@mamep2026/logging";
import { useAppStore } from "../app-store";
import { isNearBottom } from "../log-scroll";

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
      <Tag color={entry.direction === "request" ? "blue" : "green"}>
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
  const { message } = App.useApp();
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

  // 通信日志：自动滚动开关（会话级，不持久化）+ 跟随状态。
  const [autoScroll, setAutoScroll] = useState(true);
  const stickToBottom = useRef(true);
  const commListRef = useRef<HTMLDivElement | null>(null);

  // 新日志到达时，若开关开启且用户未上滚离开底部，则自动滚动到底部。
  // 性能优化：rAF 合并高频 append，避免每秒数十次同步写 scrollTop。
  useEffect(() => {
    if (!autoScroll || !stickToBottom.current) return;
    const el = commListRef.current;
    if (el === null) return;
    const handle = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [commLog.length, autoScroll]);

  const handleCommScroll = (e: React.UIEvent<HTMLDivElement>): void => {
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
            <Tag className="log-row__level" color={levelColor(message.level)}>
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
    <div className="comm-log">
      <div className="comm-log__toolbar">
        <Space size="small">
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
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={commLog.length === 0 || host === null}
            onClick={() => void handleCopy()}
          >
            {t("panel.copy")}
          </Button>
          <Button size="small" onClick={clearCommLog}>
            {t("panel.clear")}
          </Button>
        </Space>
      </div>
      <div
        ref={commListRef}
        className="log-list comm-log__list"
        onScroll={handleCommScroll}
      >
        {commLog.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          commLog.map((entry, index) => (
            <CommLogRow key={index} entry={entry} />
          ))
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
      <Descriptions size="small" column={3}>
        <Descriptions.Item label={t("panel.serialPort")}>
          {properties.portLabel ?? "-"}
        </Descriptions.Item>
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
        <Descriptions.Item label={t("panel.slave")}>
          {properties.slaveAddress}
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
        <Descriptions.Item label={t("connection.addressAdjust")}>
          {properties.addressAdjust.toUpperCase()}
        </Descriptions.Item>
        <Descriptions.Item label={t("panel.status")}>
          <Tag color={connectionState === "connected" ? "green" : "default"}>
            {t(`state.${connectionState}`)}
          </Tag>
        </Descriptions.Item>
      </Descriptions>
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
        ]}
      />
    </div>
  );
}
