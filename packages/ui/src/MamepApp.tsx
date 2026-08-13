import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ConfigProvider,
  Layout,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  theme as antdTheme,
  Typography,
} from "antd";
import {
  PlusOutlined,
  SettingOutlined,
  ApiOutlined,
  DisconnectOutlined,
  BulbOutlined,
} from "@ant-design/icons";
import type { ConnectionState } from "@mamep2026/communication";
import type { RowId } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { useAppStore } from "./app-store";
import { BottomPanel } from "./components/BottomPanel";
import { ConnectionSettingsModal } from "./components/ConnectionSettingsModal";
import { PluginManagerModal } from "./components/PluginManagerModal";
import { RegisterTable } from "./components/RegisterTable";
import { TraceWindow } from "./components/TraceWindow";

type TagColor =
  "default" | "processing" | "green" | "orange" | "red" | "warning";

const STATE_COLORS: Record<ConnectionState, TagColor> = {
  disconnected: "default",
  "selecting-device": "processing",
  connecting: "processing",
  connected: "green",
  disconnecting: "processing",
  "reconnect-waiting": "warning",
  reconnecting: "processing",
  interrupted: "orange",
  failed: "red",
};

export function MamepApp(): React.ReactNode {
  const { t, i18n } = useTranslation();
  const host = useAppStore((s) => s.host);
  const workspace = useAppStore((s) => s.workspace);
  const connectionState = useAppStore((s) => s.connectionState);
  const setConnectionState = useAppStore((s) => s.setConnectionState);
  const activeSheetId = useAppStore(
    (s) => s.activeSheetId ?? s.workspace.activeSheetId,
  );
  const setActiveSheetId = useAppStore((s) => s.setActiveSheetId);
  const setConnectionModalOpen = useAppStore((s) => s.setConnectionModalOpen);
  const setPluginModalOpen = useAppStore((s) => s.setPluginModalOpen);
  const settingsOpen = useAppStore((s) => s.settingsModalOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsModalOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const addSheet = useAppStore((s) => s.addSheet);
  const renameSheet = useAppStore((s) => s.renameSheet);
  const traceWindows = useAppStore((s) => s.traceWindows);
  const appendTraceSample = useAppStore((s) => s.appendTraceSample);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const [readAllRunning, setReadAllRunning] = useState(false);
  const [editingSheetName, setEditingSheetName] = useState<string | null>(null);

  // 连接状态同步。
  useEffect(() => {
    if (host === null || host === undefined) return;
    setConnectionState(host.getConnectionState());
    const unsubscribe = host.subscribeConnectionState((state) =>
      setConnectionState(state),
    );
    return unsubscribe;
  }, [host, setConnectionState]);

  // Trace 采样 -> store。
  useEffect(() => {
    if (host === null || host === undefined) return;
    return host.subscribeTraceSample((sample) => {
      const sheet = useAppStore
        .getState()
        .workspace.sheets.find((sh) =>
          sh.rows.some((r) => r.rowId === sample.key),
        );
      const row = sheet?.rows.find((r) => r.rowId === sample.key);
      if (row === undefined) return;
      appendTraceSample(sample.key as never, {
        no: sample.sequence,
        value: formatRawValue(sample.rawValue, row.dataType),
      });
    });
  }, [host, appendTraceSample]);

  const currentSheet = useMemo(
    () =>
      workspace.sheets.find((sheet) => sheet.sheetId === activeSheetId) ??
      workspace.sheets[0],
    [workspace, activeSheetId],
  );

  const connected = connectionState === "connected";

  const handleConnectToggle = (): void => {
    if (connected) {
      void host?.disconnect();
    } else {
      setConnectionModalOpen(true);
    }
  };

  const handleReadAll = async (): Promise<void> => {
    if (host === null || host === undefined || currentSheet === undefined)
      return;
    setReadAllRunning(true);
    try {
      const handle = host.readAllRows(
        currentSheet.rows.map((row) => ({
          key: row.rowId,
          address: row.addressValue?.value ?? null,
        })),
      );
      const result = await handle.promise;
      if (result.ok) {
        appendMessage({
          timestamp: Date.now(),
          level: "info",
          messageKey: `Read All: ${result.value.successCount} succeeded, ${result.value.failureCount} failed, ${result.value.skippedCount} skipped`,
          detail: null,
        });
      }
    } finally {
      setReadAllRunning(false);
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm:
          theme === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
      }}
    >
      <Layout style={{ height: "100vh" }}>
        <Layout.Header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingInline: 12,
            background: theme === "dark" ? "#141414" : "#fff",
            borderBottom: "1px solid rgba(5,5,5,0.06)",
          }}
        >
          <Typography.Text strong>{t("app.title")}</Typography.Text>
          <Tag>{t("app.protocol")}</Tag>
          <Button size="small" icon={<PlusOutlined />} onClick={addSheet}>
            {t("topbar.newSheet")}
          </Button>
          <Button
            size="small"
            icon={<ApiOutlined />}
            onClick={() => setConnectionModalOpen(true)}
          >
            {t("topbar.connectionSettings")}
          </Button>
          <Button
            size="small"
            type={connected ? "default" : "primary"}
            danger={connected}
            icon={connected ? <DisconnectOutlined /> : <ApiOutlined />}
            onClick={handleConnectToggle}
            style={{ fontWeight: 600, letterSpacing: 0.5 }}
          >
            {connected ? t("topbar.disconnect") : t("topbar.connect")}
          </Button>
          <Tag color={STATE_COLORS[connectionState]}>
            {t(`state.${connectionState}`)}
          </Tag>
          <Button
            size="small"
            loading={readAllRunning}
            onClick={() => void handleReadAll()}
          >
            {t("topbar.readAll")}
          </Button>
          <span style={{ flex: 1 }} />
          <Button size="small" onClick={() => setPluginModalOpen(true)}>
            {t("topbar.pluginManager")}
          </Button>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen(true)}
          >
            {t("topbar.settings")}
          </Button>
          <Button
            size="small"
            icon={<BulbOutlined />}
            aria-label={t("topbar.theme")}
            onClick={() => {
              const next = theme === "light" ? "dark" : "light";
              setTheme(next);
            }}
          />
        </Layout.Header>
        <Layout>
          <Layout.Sider
            width={180}
            theme={theme === "dark" ? "dark" : "light"}
            style={{ borderRight: "1px solid rgba(5,5,5,0.06)" }}
          >
            <div style={{ padding: 8 }}>
              <Typography.Text type="secondary">
                {t("table.sheet")}
              </Typography.Text>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {workspace.sheets.map((sheet) => (
                  <li
                    key={sheet.sheetId}
                    onClick={() => setActiveSheetId(sheet.sheetId)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        sheet.sheetId === currentSheet?.sheetId
                          ? "rgba(22,119,255,0.15)"
                          : undefined,
                    }}
                  >
                    {editingSheetName === sheet.sheetId ? (
                      <input
                        defaultValue={sheet.name}
                        autoFocus
                        style={{ width: "100%" }}
                        onBlur={(e) => {
                          renameSheet(sheet.sheetId, e.target.value);
                          setEditingSheetName(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setEditingSheetName(null);
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={() => setEditingSheetName(sheet.sheetId)}
                      >
                        {sheet.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Layout.Sider>
          <Layout.Content
            style={{
              padding: 8,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {currentSheet !== undefined ? (
                <RegisterTable sheetId={currentSheet.sheetId} />
              ) : null}
            </div>
            <div
              style={{
                height: 220,
                borderTop: "1px solid rgba(5,5,5,0.06)",
                overflow: "auto",
                paddingInline: 8,
              }}
            >
              <BottomPanel />
            </div>
          </Layout.Content>
        </Layout>
      </Layout>

      <ConnectionSettingsModal />
      <PluginManagerModal />
      {Object.entries(traceWindows).map(([rowId]) => (
        <TraceWindow key={rowId} rowId={rowId as RowId} />
      ))}

      <Modal
        title={t("settings.title")}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Typography.Text>{t("settings.theme")}</Typography.Text>
            <Segmented
              style={{ marginLeft: 8 }}
              value={theme}
              onChange={(value) => setTheme(value as "light" | "dark")}
              options={[
                { value: "light", label: t("settings.themeLight") },
                { value: "dark", label: t("settings.themeDark") },
              ]}
            />
          </div>
          <div>
            <Typography.Text type="secondary">{t("app.title")}</Typography.Text>{" "}
            <Select
              size="small"
              value={i18n.language}
              style={{ width: 100, marginLeft: 8 }}
              onChange={(value) => void i18n.changeLanguage(value)}
              options={[
                { value: "en-US", label: "English" },
                { value: "zh-CN", label: "中文" },
              ]}
            />
          </div>
          <Typography.Paragraph type="secondary">
            {t("settings.aboutText")}
          </Typography.Paragraph>
        </Space>
      </Modal>
    </ConfigProvider>
  );
}
