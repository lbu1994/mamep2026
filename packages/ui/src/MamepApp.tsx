import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import type { MenuProps, MenuRef } from "antd";
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Divider,
  Dropdown,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Splitter,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  DisconnectOutlined,
  LeftOutlined,
  MoreOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RightOutlined,
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

/** 折叠时底部面板仅保留标签栏的高度（px）。 */
const COLLAPSED_BOTTOM_PANEL_HEIGHT = 40;

export function MamepApp(): React.ReactNode {
  const { t, i18n } = useTranslation();
  const host = useAppStore((s) => s.host);
  // 仅订阅表元数据（id/name）与从站地址：行数据变化不触发本组件重渲染，
  // 避免单行更新（编辑/WP 轮询）级联重渲染整个应用树（性能优化）。
  // 注意：useShallow 只对“原语值/原语数组”逐项浅比较，因此投影为两个原语数组，
  // 再由 useMemo 派生稳定的 { sheetId, name } 元数据数组。
  const sheetIds = useAppStore(
    useShallow((s) => s.workspace.sheets.map((sh) => sh.sheetId)),
  );
  const sheetNames = useAppStore(
    useShallow((s) => s.workspace.sheets.map((sh) => sh.name)),
  );
  const slaveAddress = useAppStore(
    (s) => s.workspace.connectionProfiles[0]?.slaveAddress ?? 1,
  );
  const sheetMeta = useMemo(
    () =>
      sheetIds.map((sheetId, index) => ({
        sheetId,
        name: sheetNames[index] ?? "",
      })),
    [sheetIds, sheetNames],
  );
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
  const setLanguage = useAppStore((s) => s.setLanguage);
  const addSheet = useAppStore((s) => s.addSheet);
  const renameSheet = useAppStore((s) => s.renameSheet);
  // 只订阅追踪窗的键集合（useShallow 逐项比较）：TM 采样（appendTraceSample 重建整个
  // record）不改变键集合，MamepApp 不随之重渲染；TraceWindow 组件自身按 rowId 订阅数据。
  const traceWindowKeys = useAppStore(
    useShallow((s) => Object.keys(s.traceWindows)),
  );
  const appendTraceSample = useAppStore((s) => s.appendTraceSample);
  const setPanelLayout = useAppStore((s) => s.setPanelLayout);
  const sidebarCollapsed = useAppStore(
    (s) => s.workspace.panelLayout.sidebarCollapsed,
  );
  const bottomPanelCollapsed = useAppStore(
    (s) => s.workspace.panelLayout.bottomPanelCollapsed,
  );
  const bottomPanelHeight = useAppStore(
    (s) => s.workspace.panelLayout.bottomPanelHeight,
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
  // 窄窗口（≤1100px）将顶栏次要操作（Plugin Manager/Settings/Help）收入 More 下拉；
  // Connection 入口与连接状态/Disconnect 始终可见（不收进 More）。
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const update = (): void => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  // Splitter 受控 size 拖拽过程缓冲：onResize 更新本地，onResizeEnd 才持久化到 panelLayout（避免高频写 store）。
  const [dragPanelHeight, setDragPanelHeight] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  const menuRef = useRef<MenuRef>(null);

  // antd Menu 无法通过 items 配置直接给 <li> 设 draggable，提交后在真实 DOM 上补齐，
  // 保证表项可被真实拖拽排序（E2E 派发合成事件不依赖该属性，但真实用户拖拽需要）。
  useEffect(() => {
    menuRef.current?.menu?.list
      ?.querySelectorAll<HTMLLIElement>("li[data-sheet-id]")
      .forEach((el) => {
        el.draggable = true;
      });
  });

  // 连接状态同步。
  useEffect(() => {
    if (host === null || host === undefined) return;
    setConnectionState(host.getConnectionState());
    const unsubscribe = host.subscribeConnectionState((state) =>
      setConnectionState(state),
    );
    return unsubscribe;
  }, [host, setConnectionState]);

  // 主题同步到 <html data-mamep-theme>：index.css 的 --mamep-* 暗色令牌依赖该属性，
  // 与 antd ConfigProvider 的暗色算法一起切换（组件内不得散落主题判断）。
  useEffect(() => {
    document.documentElement.dataset.mamepTheme = theme;
    return () => {
      delete document.documentElement.dataset.mamepTheme;
    };
  }, [theme]);

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
      sheetMeta.find((sheet) => sheet.sheetId === activeSheetId) ??
      sheetMeta[0],
    [sheetMeta, activeSheetId],
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
        ? sheetMeta.length - 1
        : Math.max(
            0,
            sheetMeta.length -
              1 -
              sheetMeta.findIndex(
                (sheet) => sheet.sheetId === pendingBulkClose.sheetId,
              ),
          );

  const sheetMenu = (
    sheetId: SheetId,
    index: number,
  ): NonNullable<MenuProps["items"]> =>
    buildSheetMenuItems(t, sheetId, index, sheetMeta.length, {
      onRename: handleRenameSheet,
      onDuplicate: duplicateSheet,
      onCloseOthers: handleCloseOthers,
      onCloseToRight: handleCloseToRight,
      onMoveUp: (id) => moveSheetTo(id, index - 1),
      onMoveDown: (id) => moveSheetTo(id, index + 1),
      onDelete: handleDeleteSheet,
    });

  // 顶栏次要操作：窄窗口收入 More 下拉（与展开态按钮共享动作）。
  const secondaryMenuItems: NonNullable<MenuProps["items"]> = [
    {
      key: "plugins",
      label: t("topbar.pluginManager"),
      onClick: () => setPluginModalOpen(true),
    },
    {
      key: "settings",
      label: t("topbar.settings"),
      onClick: () => setSettingsOpen(true),
    },
    {
      key: "help",
      label: t("topbar.help"),
      onClick: () => setHelpOpen(true),
    },
  ];

  return (
    <ConfigProvider theme={buildTheme(theme === "dark")}>
      <AntApp>
        <Layout style={{ height: "100vh" }}>
          <Layout.Header className="mamep-header">
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
            <Divider
              vertical
              style={{ height: 20, marginInline: 2, flex: "none" }}
            />
            {/* 连接区：左侧「只读状态摘要」+ 右侧 Connect/Disconnect 操作；
                Connection 入口已移至右侧操作组（Plugin Manager 左侧），窄窗口也不收进 More */}
            <div className="connection-cluster">
              <div className="connection-cluster__primary">
                <span className="status-badge">
                  <span
                    className="status-badge__dot"
                    style={{
                      backgroundColor: STATE_DOT_COLOR[connectionState],
                    }}
                  />
                  <span>
                    {t(`state.${connectionState}`)}
                    {" · "}
                    {t("topbar.rtuSlave", { address: slaveAddress })}
                  </span>
                </span>
              </div>
              <span className="connection-cluster__sep" aria-hidden="true" />
              <Button
                size="small"
                className="connection-cluster__action"
                type={connected ? "default" : "primary"}
                danger={connected}
                icon={connected ? <DisconnectOutlined /> : <ApiOutlined />}
                onClick={handleConnectToggle}
                style={{ fontWeight: 600 }}
              >
                {connected ? t("topbar.disconnect") : t("topbar.connect")}
              </Button>
            </div>
            <span className="mamep-header__spacer" />
            <div className="mamep-header__group">
              {/* Connection 入口始终可见（不收进 More），置于 Plugin Manager 左侧 */}
              <Button
                size="small"
                icon={<ApiOutlined />}
                onClick={() => setConnectionModalOpen(true)}
              >
                {t("topbar.connectionSettings")}
              </Button>
              {narrow ? (
                <Dropdown
                  menu={{ items: secondaryMenuItems }}
                  trigger={["click"]}
                >
                  <Button
                    size="small"
                    icon={<MoreOutlined />}
                    aria-label={t("topbar.more")}
                  >
                    {t("topbar.more")}
                  </Button>
                </Dropdown>
              ) : (
                <>
                  <Button
                    size="small"
                    icon={<AppstoreOutlined />}
                    onClick={() => setPluginModalOpen(true)}
                  >
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
                </>
              )}
            </div>
          </Layout.Header>
          <Layout className="mamep-main">
            <Layout.Sider
              className="sheet-sidebar"
              width={160}
              collapsedWidth={36}
              trigger={null}
              collapsible
              collapsed={sidebarCollapsed}
              theme="light"
            >
              <div className="sheet-sidebar__head">
                <span className="sheet-sidebar__title">
                  {t("sidebar.workspace")}
                </span>
                <Tooltip title={t("topbar.toggleSidebar")}>
                  <Button
                    type="text"
                    size="small"
                    className="sheet-sidebar__collapse"
                    aria-label={t("topbar.toggleSidebar")}
                    icon={
                      sidebarCollapsed ? <RightOutlined /> : <LeftOutlined />
                    }
                    onClick={() =>
                      setPanelLayout({ sidebarCollapsed: !sidebarCollapsed })
                    }
                  />
                </Tooltip>
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
              <Menu
                ref={menuRef}
                className="sheet-sidebar__list sheet-sidebar__menu"
                mode="inline"
                inlineCollapsed={false}
                selectable
                selectedKeys={
                  currentSheet !== undefined ? [currentSheet.sheetId] : []
                }
                onClick={({ key, domEvent }) => {
                  // Dropdown 弹层（右键/更多菜单项）在 React 树上是 Menu item 的后代，
                  // 点击弹层项会经 React 树冒泡到条目 onClick；但那是菜单动作（如 Duplicate）
                  // 而非“切换表”意图，忽略以免把 active 切回源表。
                  const target = domEvent.target as HTMLElement;
                  if (target.closest(".ant-dropdown") !== null) return;
                  setActiveSheetId(key as SheetId);
                }}
                onDragStart={(event) => {
                  const li = (
                    event.target as HTMLElement
                  ).closest<HTMLLIElement>("li[data-sheet-index]");
                  if (li?.dataset.sheetIndex !== undefined) {
                    dragIndex.current = Number(li.dataset.sheetIndex);
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const li = (
                    event.target as HTMLElement
                  ).closest<HTMLLIElement>("li[data-sheet-index]");
                  const fromIndex = dragIndex.current;
                  dragIndex.current = null;
                  if (li?.dataset.sheetIndex === undefined) return;
                  if (fromIndex === null) return;
                  const toIndex = Number(li.dataset.sheetIndex);
                  if (fromIndex === toIndex) return;
                  const source = sheetMeta[fromIndex];
                  if (source !== undefined) {
                    moveSheetTo(source.sheetId, toIndex);
                  }
                }}
                items={sheetMeta.map((sheet, index) => ({
                  key: sheet.sheetId,
                  "data-sheet-id": sheet.sheetId,
                  "data-sheet-index": index,
                  // rc-menu 会给 inline 顶层 item 内联 padding-left: inlineIndent(24px)，
                  // 内联样式优先于 CSS，需在 item style 里覆盖回 6px 以保持原视觉。
                  style: { paddingInline: 6 },
                  className:
                    sheet.sheetId === currentSheet?.sheetId
                      ? "sheet-item sheet-item--active"
                      : "sheet-item",
                  label: (
                    <Dropdown
                      trigger={["contextMenu"]}
                      menu={{ items: sheetMenu(sheet.sheetId, index) }}
                    >
                      <span className="sheet-item__label-wrap">
                        {editingSheetId === sheet.sheetId ? (
                          <input
                            className="sheet-item__input"
                            defaultValue={sheet.name}
                            autoFocus
                            onClick={(event) => event.stopPropagation()}
                            onBlur={(event) => {
                              renameSheet(sheet.sheetId, event.target.value);
                              setEditingSheetId(null);
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
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
                            onDoubleClick={() =>
                              setEditingSheetId(sheet.sheetId)
                            }
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
                      </span>
                    </Dropdown>
                  ),
                }))}
              />
              <div className="sheet-sidebar__footer">
                {t("sidebar.footer", { version: host?.appVersion ?? "" })}
              </div>
            </Layout.Sider>
            <Layout.Content className="mamep-body">
              <Splitter
                orientation="vertical"
                style={{ flex: 1, minHeight: 0 }}
                classNames={{ dragger: "bottom-panel__resize" }}
                onResize={(sizes) => {
                  const panelSize = sizes[1];
                  if (panelSize !== undefined) {
                    setDragPanelHeight(Math.round(panelSize));
                  }
                }}
                onResizeEnd={(sizes) => {
                  const panelSize = sizes[1];
                  if (panelSize !== undefined) {
                    setPanelLayout({
                      bottomPanelHeight: Math.round(panelSize),
                    });
                    setDragPanelHeight(null);
                  }
                }}
              >
                <Splitter.Panel>
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
                        items={sheetMeta.map((sheet, index) => ({
                          key: sheet.sheetId,
                          label: (
                            <Dropdown
                              trigger={["contextMenu"]}
                              menu={{
                                items: sheetMenu(sheet.sheetId, index),
                              }}
                            >
                              {editingSheetId === sheet.sheetId ? (
                                <input
                                  className="sheet-tab__input"
                                  defaultValue={sheet.name}
                                  onClick={(event) => event.stopPropagation()}
                                  onBlur={(event) => {
                                    renameSheet(
                                      sheet.sheetId,
                                      event.target.value,
                                    );
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
                </Splitter.Panel>
                <Splitter.Panel
                  size={
                    bottomPanelCollapsed
                      ? COLLAPSED_BOTTOM_PANEL_HEIGHT
                      : (dragPanelHeight ?? bottomPanelHeight)
                  }
                  resizable={!bottomPanelCollapsed}
                  {...(bottomPanelCollapsed ? {} : { min: 120, max: "60%" })}
                >
                  <BottomPanel />
                </Splitter.Panel>
              </Splitter>
            </Layout.Content>
          </Layout>
        </Layout>

        <ConnectionSettingsModal />
        <PluginManagerModal />
        {traceWindowKeys.map((rowId) => (
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
              <Typography.Text type="secondary">
                {t("app.title")}
              </Typography.Text>{" "}
              <Select
                size="small"
                value={i18n.language}
                style={{ width: 100, marginLeft: 8 }}
                onChange={(value) => {
                  // 语言切换：立即生效 + 记入工作区偏好（随自动保存持久化）。
                  const language = value as "en-US" | "zh-CN";
                  setLanguage(language);
                  void i18n.changeLanguage(language);
                }}
                options={[
                  { value: "en-US", label: "English" },
                  { value: "zh-CN", label: "中文" },
                ]}
              />
            </div>
            <div>
              <Popconfirm
                title={t("settings.resetConfirmTitle")}
                description={t("settings.resetConfirmContent")}
                okText={t("settings.resetOk")}
                cancelText={t("connection.cancel")}
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleResetWorkspace()}
              >
                <Button danger size="small">
                  {t("settings.resetWorkspace")}
                </Button>
              </Popconfirm>
            </div>
            <Typography.Paragraph type="secondary">
              {t("settings.aboutText")}
            </Typography.Paragraph>
          </Space>
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
                sheetMeta.find(
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
      </AntApp>
    </ConfigProvider>
  );
}
