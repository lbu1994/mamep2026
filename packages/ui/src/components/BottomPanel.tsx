import { useTranslation } from "react-i18next";
import {
  Button,
  Descriptions,
  Input,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useAppStore } from "../app-store";

export function BottomPanel(): React.ReactNode {
  const { t } = useTranslation();
  const messages = useAppStore((s) => s.messages);
  const commLog = useAppStore((s) => s.commLog);
  const clearCommLog = useAppStore((s) => s.clearCommLog);
  const notes = useAppStore((s) => s.workspace.notes);
  const setNotes = useAppStore((s) => s.setNotes);
  const host = useAppStore((s) => s.host);
  const properties = host?.getCommProperties() ?? null;
  const connectionState = useAppStore((s) => s.connectionState);

  const levelColor = (level: string): string =>
    level === "error" ? "red" : level === "warning" ? "orange" : "blue";

  const messagesTab = (
    <div className="log-list">
      {messages.length === 0 ? (
        <Typography.Text type="secondary">—</Typography.Text>
      ) : (
        messages.map((message, index) => (
          <div key={index} className="log-row">
            <Space size={8}>
              <Typography.Text type="secondary">
                {new Date(message.timestamp).toLocaleTimeString()}
              </Typography.Text>
              <Tag color={levelColor(message.level)}>{message.level}</Tag>
              <Typography.Text>{message.messageKey}</Typography.Text>
              {message.detail !== null ? (
                <Typography.Text type="secondary">
                  {message.detail}
                </Typography.Text>
              ) : null}
            </Space>
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
            <Space size={8}>
              <Typography.Text type="secondary">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </Typography.Text>
              <Tag color={entry.direction === "request" ? "blue" : "green"}>
                {entry.direction === "request"
                  ? t("panel.request")
                  : t("panel.response")}
              </Tag>
              <Typography.Text code>{entry.bytesHex}</Typography.Text>
            </Space>
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

  return (
    <Tabs
      size="small"
      items={[
        { key: "messages", label: t("panel.messages"), children: messagesTab },
        { key: "commlog", label: t("panel.commLog"), children: commLogTab },
        {
          key: "properties",
          label: t("panel.properties"),
          children: propertiesTab,
        },
        { key: "notes", label: t("panel.notes"), children: notesTab },
      ]}
    />
  );
}
