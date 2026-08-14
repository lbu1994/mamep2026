import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MenuProps } from "antd";
import {
  Button,
  ConfigProvider,
  Dropdown,
  Layout,
  Modal,
  Segmented,
  Select,
  Space,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import {
  ApiOutlined,
  BulbOutlined,
  DisconnectOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { ConnectionState } from "@mamep2026/communication";
import type { RowId, SheetId } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { buildTheme } from "./theme";
import { useAppStore } from "./app-store";
import { BottomPanel } from "./components/BottomPanel";
import { ConnectionSettingsModal } from "./components/ConnectionSettingsModal";
import { PluginManagerModal } from "./components/PluginManagerModal";
import { RegisterTable } from "./components/RegisterTable";
import { buildSheetMenuItems } from "./components/SheetMenu";
import { TraceWindow } from "./components/TraceWindow";

/** 状态圆点颜色（形状 + 文字之外的颜色提示，取 antd 语义 token）。 */
const STATE_DOT_COLOR: Record<ConnectionState, string> = {
  disconnected: "var(--ant-color-text-quaternary)",
  "selecting-device": "var(--ant-color-primary)",
  connecting: "var(--ant-color-primary)",
  connected: "var(--ant-color-success)",
  disconnecting: "var(--ant-color-primary)",
  "reconnect-waiting": "var(--ant-color-warning)",
  reconnecting: "var(--ant-color-primary)",
  interrupted: "var(--ant-color-warning)",
  failed: "var(--ant-color-error)",
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
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const settingsOpen = useAppStore((s) => s.settingsModalOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsModalOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const addSheet = useAppStore((s) => s.addSheet);
  const renameSheet = useAppStore((s) => s.renameSheet);
  const traceWindows = useAppStore((s) => s.traceWindows);
  const appendTraceSample = useAppStore((s) => s.appendTraceSample);
  const setPanelLayout = useAppStore((s) => s.setPanelLayout);
  const sidebarCollapsed = useAppStore(
    (s) => s.workspace.panelLayout.sidebarCollapsed,
  );
  const closeSheet = useAppStore((s) => s.closeSheet);
  const duplicateSheet = useAppStore((s) => s.duplicateSheet);
  const moveSheetTo = useAppStore((s) => s.moveSheetTo);
  const editingSheetId = useAppStore((s) => s.editingSheetId);
  const setEditingSheetId = useAppStore((s) => s.setEditingSheetId);
  const pendingDeleteSheetId = useAppStore((s) => s.pendingDeleteSheetId);
  const setPendingDeleteSheetId = useAppStore((s) => s.setPendingDeleteSheetId);
  const pendingBulkClose = useAppStore((s) => s.pendingBulkClose);
  const setPendingBulkClose = useAppStore((s) => s.setPendingBulkClose);
  const closeOtherSheets = useAppStore((s) => s.closeOtherSheets);
  const closeSheetsToRight = useAppStore((s) => s.closeSheetsToRight);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const dragIndex = useRef<number | null>(null);

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

  const handleResetWorkspace = (): void => {
    if (host === null || host === undefined) return;
    void host.resetWorkspace().then((result) => {
      setResetConfirmOpen(false);
      if (result.ok) {
        setWorkspace(result.value);
        appendMessage({
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.workspaceReset",
          detail: null,
        });
      } else {
        appendMessage({
          timestamp: Date.now(),
          level: "error",
          messageKey: "messages.resetFailed",
          params: { detail: result.error.code },
          detail: result.error.code,
        });
      }
    });
  };

  const slaveAddress = workspace.connectionProfiles[0]?.slaveAddress ?? 1;

  const handleRenameSheet = (sheetId: SheetId): void => {
    setActiveSheetId(sheetId);
    setEditingSheetId(sheetId);
  };

  const handleDeleteSheet = (sheetId: SheetId): void => {
    setPendingDeleteSheetId(sheetId);
  };

  const confirmDeleteSheet = (): void => {
    if (pendingDeleteSheetId !== null) {
      closeSheet(pendingDeleteSheetId);
    }
    setPendingDeleteSheetId(null);
  };

  const handleCloseOthers = (sheetId: SheetId): void => {
    setPendingBulkClose({ kind: "others", sheetId });
  };

  const handleCloseToRight = (sheetId: SheetId): void => {
    setPendingBulkClose({ kind: "right", sheetId });
  };

  const confirmBulkClose = (): void => {
    if (pendingBulkClose !== null) {
      if (pendingBulkClose.kind === "others") {
        closeOtherSheets(pendingBulkClose.sheetId);
      } else {
        closeSheetsToRight(pendingBulkClose.sheetId);
      }
    }
    setPendingBulkClose(null);
  };

  // 确认弹窗中「将关闭的标签页数量」（关闭其他=总数-1；关闭右侧=右侧表数）。
  const bulkCloseCount =
    pendingBulkClose === null
      ? 0
      : pendingBulkClose.kind === "others"
        ? workspace.sheets.length - 1
        : Math.max(
            0,
            workspace.sheets.length -
              1 -
              workspace.sheets.findIndex(
                (sheet) => sheet.sheetId === pendingBulkClose.sheetId,
              ),
          );

  const sheetMenu = (
    sheetId: SheetId,
    index: number,
  ): NonNullable<MenuProps["items"]> =>
    buildSheetMenuItems(t, sheetId, index, workspace.sheets.length, {
      onRename: handleRenameSheet,
      onDuplicate: duplicateSheet,
      onCloseOthers: handleCloseOthers,
      onCloseToRight: handleCloseToRight,
      onMoveUp: (id) => moveSheetTo(id, index - 1),
      onMoveDown: (id) => moveSheetTo(id, index + 1),
      onDelete: handleDeleteSheet,
    });

  return (
    <ConfigProvider theme={buildTheme(theme === "dark")}>
      <Layout style={{ height: "100vh" }}>
        <Layout.Header className="mamep-header">
          <Button
            type="text"
            size="small"
            aria-label={t("topbar.toggleSidebar")}
            icon={
              sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
            }
            onClick={() =>
              setPanelLayout({ sidebarCollapsed: !sidebarCollapsed })
            }
          />
          <div className="mamep-header__brand">
            <Typography.Text className="mamep-header__brand-title">
              {t("app.title")}
            </Typography.Text>
            <span className="mamep-header__protocol">
              {host !== null && host !== undefined && host.isMockMode
                ? t("topbar.mock")
                : t("app.protocol")}
            </span>
          </div>
          <div className="mamep-header__divider" />
          <div className="connection-cluster">
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
              style={{ fontWeight: 600 }}
            >
              {connected ? t("topbar.disconnect") : t("topbar.connect")}
            </Button>
            <span className="status-badge">
              <span
                className="status-badge__dot"
                style={{ backgroundColor: STATE_DOT_COLOR[connectionState] }}
              />
              <span>
                {t(`state.${connectionState}`)}
                {" · "}
                {t("topbar.rtuSlave", { address: slaveAddress })}
              </span>
            </span>
          </div>
          <span className="mamep-header__spacer" />
          <div className="mamep-header__group">
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
              icon={<QuestionCircleOutlined />}
              onClick={() => setHelpOpen(true)}
            >
              {t("topbar.help")}
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
          </div>
        </Layout.Header>
        <Layout className="mamep-main">
          <Layout.Sider
            className="sheet-sidebar"
            width={160}
            collapsedWidth={0}
            trigger={null}
            collapsible
            collapsed={sidebarCollapsed}
            theme="light"
          >
            <div className="sheet-sidebar__head">
              <span className="sheet-sidebar__title">
                {t("sidebar.workspace")}
              </span>
              <Button
                type="text"
                size="small"
                className="sheet-sidebar__collapse"
                aria-label={t("topbar.toggleSidebar")}
                icon={<LeftOutlined />}
                onClick={() => setPanelLayout({ sidebarCollapsed: true })}
              />
            </div>
            <div className="sheet-sidebar__section">
              <span className="sheet-sidebar__section-title">
                {t("sidebar.registerTables")}
              </span>
              <Tooltip title={t("sidebar.newTable")}>
                <Button
                  type="text"
                  size="small"
                  className="sheet-sidebar__section-action"
                  aria-label={t("sidebar.newTable")}
                  icon={<PlusOutlined />}
                  onClick={addSheet}
                />
              </Tooltip>
            </div>
            <ul className="sheet-sidebar__list">
              {workspace.sheets.map((sheet, index) => (
                <Dropdown
                  key={sheet.sheetId}
                  trigger={["contextMenu"]}
                  menu={{ items: sheetMenu(sheet.sheetId, index) }}
                >
                  <li
                    className={
                      sheet.sheetId === currentSheet?.sheetId
                        ? "sheet-item sheet-item--active"
                        : "sheet-item"
                    }
                    draggable
                    onDragStart={() => {
                      dragIndex.current = index;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const fromIndex = dragIndex.current;
                      dragIndex.current = null;
                      if (fromIndex === null || fromIndex === index) return;
                      const source = workspace.sheets[fromIndex];
                      if (source !== undefined) {
                        moveSheetTo(source.sheetId, index);
                      }
                    }}
                    onClick={() => setActiveSheetId(sheet.sheetId)}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    {editingSheetId === sheet.sheetId ? (
                      <input
                        className="sheet-item__input"
                        defaultValue={sheet.name}
                        autoFocus
                        onBlur={(event) => {
                          renameSheet(sheet.sheetId, event.target.value);
                          setEditingSheetId(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            renameSheet(
                              sheet.sheetId,
                              event.currentTarget.value,
                            );
                            setEditingSheetId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="sheet-item__name"
                        onDoubleClick={() => setEditingSheetId(sheet.sheetId)}
                      >
                        {sheet.name}
                      </span>
                    )}
                    <Dropdown
                      menu={{ items: sheetMenu(sheet.sheetId, index) }}
                      trigger={["click"]}
                    >
                      <Button
                        type="text"
                        size="small"
                        className="sheet-item__more"
                        aria-label={t("table.moreActions")}
                        icon={<MoreOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </li>
                </Dropdown>
              ))}
            </ul>
            <div className="sheet-sidebar__footer">{t("sidebar.footer")}</div>
          </Layout.Sider>
          <Layout.Content className="mamep-body">
            <div className="register-table-wrap">
              {currentSheet !== undefined ? (
                <Tabs
                  type="editable-card"
                  size="small"
                  className="register-table-tabs"
                  activeKey={currentSheet.sheetId}
                  onChange={(key) => setActiveSheetId(key as SheetId)}
                  onEdit={(targetKey, action) => {
                    if (action === "add") {
                      addSheet();
                    } else if (typeof targetKey === "string") {
                      handleDeleteSheet(targetKey as SheetId);
                    }
                  }}
                  items={workspace.sheets.map((sheet, index) => ({
                    key: sheet.sheetId,
                    label: (
                      <Dropdown
                        trigger={["contextMenu"]}
                        menu={{ items: sheetMenu(sheet.sheetId, index) }}
                      >
                        {editingSheetId === sheet.sheetId ? (
                          <input
                            className="sheet-tab__input"
                            defaultValue={sheet.name}
                            onClick={(event) => event.stopPropagation()}
                            onBlur={(event) => {
                              renameSheet(sheet.sheetId, event.target.value);
                              setEditingSheetId(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                renameSheet(
                                  sheet.sheetId,
                                  event.currentTarget.value,
                                );
                                setEditingSheetId(null);
                              } else if (event.key === "Escape") {
                                setEditingSheetId(null);
                              }
                            }}
                          />
                        ) : (
                          <span
                            className="sheet-tab__label"
                            onDoubleClick={() =>
                              setEditingSheetId(sheet.sheetId)
                            }
                          >
                            {sheet.name}
                          </span>
                        )}
                      </Dropdown>
                    ),
                    children: <RegisterTable sheetId={sheet.sheetId} />,
                  }))}
                />
              ) : null}
            </div>
            <BottomPanel />
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
        <Space orientation="vertical" style={{ width: "100%" }}>
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
          <div>
            <Button danger size="small" onClick={() => setResetConfirmOpen(true)}>
              {t("settings.resetWorkspace")}
            </Button>
          </div>
          <Typography.Paragraph type="secondary">
            {t("settings.aboutText")}
          </Typography.Paragraph>
        </Space>
      </Modal>

      <Modal
        title={t("settings.resetConfirmTitle")}
        open={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onOk={() => void handleResetWorkspace()}
        okText={t("settings.resetOk")}
        okButtonProps={{ danger: true }}
      >
        <Typography.Text>{t("settings.resetConfirmContent")}</Typography.Text>
      </Modal>

      <Modal
        title={t("table.deleteConfirmTitle")}
        open={pendingDeleteSheetId !== null}
        onCancel={() => setPendingDeleteSheetId(null)}
        onOk={confirmDeleteSheet}
        okText={t("table.deleteOk")}
        okButtonProps={{ danger: true }}
      >
        <Typography.Text>
          {t("table.deleteConfirmContent", {
            name:
              workspace.sheets.find(
                (sheet) => sheet.sheetId === pendingDeleteSheetId,
              )?.name ?? "",
          })}
        </Typography.Text>
      </Modal>

      <Modal
        title={
          pendingBulkClose?.kind === "right"
            ? t("table.closeToRightConfirmTitle")
            : t("table.closeOthersConfirmTitle")
        }
        open={pendingBulkClose !== null}
        onCancel={() => setPendingBulkClose(null)}
        onOk={confirmBulkClose}
        okText={t("table.deleteOk")}
        okButtonProps={{ danger: true }}
        cancelText={t("connection.cancel")}
      >
        <Typography.Text>
          {pendingBulkClose?.kind === "right"
            ? t("table.closeToRightConfirmContent", { count: bulkCloseCount })
            : t("table.closeOthersConfirmContent", { count: bulkCloseCount })}
        </Typography.Text>
      </Modal>

      <Modal
        title={t("help.title")}
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        footer={null}
      >
        <Typography.Paragraph>{t("settings.aboutText")}</Typography.Paragraph>
      </Modal>
    </ConfigProvider>
  );
}
