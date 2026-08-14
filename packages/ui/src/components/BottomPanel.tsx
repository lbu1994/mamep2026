import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Descriptions, Input, Tabs, Tag, Typography } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { useAppStore } from "../app-store";

export function BottomPanel(): React.ReactNode {
  const { t, i18n } = useTranslation();
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
  const panelHeight = panelLayout.bottomPanelHeight;
  const activeTab = panelLayout.activeBottomTab;

  // 拖拽调高：clamp 到 [120, 60% 视口]，松手后持久化到 panelLayout。
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragHeightRef = useRef<number | null>(null);

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

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    const startY = e.clientY;
    const startHeight = panelHeight;
    dragHeightRef.current = startHeight;
    setDragHeight(startHeight);
    const onMove = (ev: PointerEvent): void => {
      const next = Math.min(
        Math.max(startHeight + (startY - ev.clientY), 120),
        Math.floor(window.innerHeight * 0.6),
      );
      dragHeightRef.current = next;
      setDragHeight(next);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const height = dragHeightRef.current;
      dragHeightRef.current = null;
      if (height !== null) setPanelLayout({ bottomPanelHeight: height });
      setDragHeight(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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

  const messagesTab = (
    <div className="log-list">
      {messages.length === 0 ? (
        <Typography.Text type="secondary">—</Typography.Text>
      ) : (
        messages.map((message, index) => (
          <div key={index} className="log-row">
            <span className="log-row__time">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
            <Tag color={levelColor(message.level)}>{message.level}</Tag>
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
    <div>
      <Button size="small" onClick={clearCommLog} style={{ marginBottom: 4 }}>
        {t("panel.clear")}
      </Button>
      <div className="log-list">
        {commLog.map((entry, index) => (
          <div key={index} className="log-row">
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
        ))}
      </div>
    </div>
  );

  const propertiesTab =
    properties === null ? null : (
      <Descriptions size="small" column={2}>
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
        <Descriptions.Item label={t("panel.slave")}>
          {properties.slaveAddress}
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

  const height = dragHeight ?? panelHeight;

  return (
    <div
      className={
        collapsed ? "bottom-panel bottom-panel--collapsed" : "bottom-panel"
      }
      style={collapsed ? undefined : { height }}
    >
      <div
        className={
          dragHeight !== null
            ? "bottom-panel__resize bottom-panel__resize--active"
            : "bottom-panel__resize"
        }
        aria-hidden="true"
        onPointerDown={handleResizeStart}
      />
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
              <>
                {t("panel.messages")}
                {unseenError ? <span className="messages-dot" /> : null}
              </>
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
