import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import type { MenuProps } from "antd";
import {
  App as AntApp,
  Avatar,
  Button,
  Collapse,
  ConfigProvider,
  Divider,
  Dropdown,
  Empty,
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
import { AppIcon } from "./assets/AppIcon";
import { usePluginContributions } from "./plugin/use-contributions";
import {
  buildThemeColorOptions,
  DEFAULT_THEME_COLOR_ID,
  deriveAppliedPrimary,
  findThemeColorOption,
  themeColorTitle,
  themeConfigForColorOption,
  type ThemeContribution,
} from "./plugin/theme-contributions";
import {
  protocolForSheetType,
  type SettingsContribution,
  type TableTypeContribution,
} from "./plugin/plugin-registries";
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
import type {
  RowId,
  RtuConnectionProfile,
  SheetId,
  SheetType,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import {
  basicTablesProtocolId,
  CORE_TABLE_TYPES,
  createDefaultRtuProfile,
  defaultConfig,
} from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { mergeThemeConfig } from "@mamep2026/ui-theme";
import { STATE_DOT_COLOR } from "./connection-state";
import { buildTheme } from "./theme";
import { useAppStore } from "./app-store";
import { canDirectConnect, runConnect } from "./connection-actions";
import { BottomPanel } from "./components/BottomPanel";
import { AppShortcutLayer } from "./components/AppShortcutLayer";
import { BrowserCompatibilityBanner } from "./components/BrowserCompatibilityBanner";
import { RecoveryBanner } from "./components/RecoveryBanner";
import { ConnectionSettingsModal } from "./components/ConnectionSettingsModal";
import { HelpDrawer } from "./components/HelpDrawer";
import type { DocumentationContribution } from "./components/documentation-markdown";
import { PluginManagerModal } from "./components/PluginManagerModal";
import { RegisterTable } from "./components/RegisterTable";
import { SheetNameEditor } from "./components/SheetNameEditor";
import { buildSheetMenuItems } from "./components/SheetMenu";
import { TraceWindow } from "./components/TraceWindow";
import { WorkspaceFileActions } from "./components/WorkspaceFileActions";
import { WorkspaceImportModal } from "./components/WorkspaceImportModal";

/** 折叠时底部面板仅保留标签栏的高度（px）。 */
const COLLAPSED_BOTTOM_PANEL_HEIGHT = 40;

/** Sheet 名重命名入口来源：页签头（tab）或侧边栏（sidebar），决定编辑态落在哪一处。 */
type RenameSource = "tab" | "sidebar";

/** Settings 主题色选项 label：色块 + 名称（ADR-047）。 */
function themeColorOptionLabel(title: string, color: string): ReactNode {
  return (
    <Space size={4}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
        }}
      />
      {title}
    </Space>
  );
}

export function MamepApp(): React.ReactNode {
  const { t, i18n } = useTranslation();
  const host = useAppStore((s) => s.host);
  // 工作区加载恢复元数据（ADR-049 恢复提示）：加载后写入，用于主体顶部横幅。
  const workspaceRecovery = useAppStore((s) => s.workspaceRecovery);
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
  const sheetOpen = useAppStore(
    useShallow((s) => s.workspace.sheets.map((sh) => sh.open)),
  );
  const sheetTypes = useAppStore(
    useShallow((s) => s.workspace.sheets.map((sh) => sh.type)),
  );
  const sheetMeta = useMemo(
    () =>
      sheetIds.map((sheetId, index) => ({
        sheetId,
        name: sheetNames[index] ?? "",
        open: sheetOpen[index] ?? true,
        // 表类型（ADR-041）：侧边栏按协议分组用。
        type: sheetTypes[index] ?? "holding-register",
      })),
    [sheetIds, sheetNames, sheetOpen, sheetTypes],
  );
  // 当前活动表的 Slave Address（每表独立，2026-08-19）：切换表/修改当前表值时
  // 同步到 host（会话请求使用当前表的值）。原语订阅不触发级联重渲染。
  const activeSheetSlaveAddress = useAppStore(
    (s) =>
      s.workspace.sheets.find(
        (sh) => sh.sheetId === (s.activeSheetId ?? s.workspace.activeSheetId),
      )?.slaveAddress ?? defaultConfig.registerTable.slaveAddress,
  );
  const connectionState = useAppStore((s) => s.connectionState);
  const setConnectionState = useAppStore((s) => s.setConnectionState);
  const activeSheetId = useAppStore(
    (s) => s.activeSheetId ?? s.workspace.activeSheetId,
  );
  const setActiveSheetId = useAppStore((s) => s.setActiveSheetId);
  const setConnectionModalOpen = useAppStore((s) => s.setConnectionModalOpen);
  // Header Connect 直连（2026-09-06）：读存储 profile / 会话内已选串口 / 连接错误（回退弹窗展示）。
  const connectionProfile = useAppStore((s) => s.workspace.connectionProfiles[0]);
  const selectedSerialHandle = useAppStore((s) => s.selectedSerialHandle);
  const setConnectError = useAppStore((s) => s.setConnectError);
  const setPluginModalOpen = useAppStore((s) => s.setPluginModalOpen);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const settingsOpen = useAppStore((s) => s.settingsModalOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsModalOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  // 所选主题色预设（ADR-047）：null=内置 Ant Design 默认蓝；插件色=`<pluginId>:<colorId>`；随工作区持久化。
  const themePrimary = useAppStore((s) => s.themePrimary);
  const setThemePrimary = useAppStore((s) => s.setThemePrimary);
  // 宿主完整主题（VSCode ui-theme 装配，ADR-027）；null=回退 buildTheme 两态。
  const themeConfig = useAppStore((s) => s.themeConfig);
  // 插件主题贡献（2026-09-02，ADR-047）：插件经 theme 贡献点注册一个或多个可选主题色
  // （colors[]）→ Settings 主题色选择器选项；**不再自动应用**（ADR-042 插件层最高优先已移除）。
  const themeContributions = usePluginContributions<ThemeContribution>(
    host,
    "theme",
  );
  // 主题色选择器选项（内置默认蓝恒在 + 各启用插件注册色；禁用/卸载后选项消失）。
  const themeColorOptions = useMemo(
    () => buildThemeColorOptions(themeContributions),
    [themeContributions],
  );
  // 装配链（ADR-047）：base = VSCode 完整主题或 buildTheme 两态（ADR-027）→
  // 用户所选预设（themePrimary 预设 ID；解析不到 = 插件禁用/卸载 → 回退默认蓝）merge 覆盖。
  const baseThemeConfig = themeConfig ?? buildTheme(theme === "dark");
  const selectedThemeColor =
    themePrimary === null
      ? null
      : findThemeColorOption(themeContributions, themePrimary);
  const effectiveThemeConfig =
    selectedThemeColor === null
      ? baseThemeConfig
      : mergeThemeConfig(
          baseThemeConfig,
          themeConfigForColorOption(selectedThemeColor),
        );
  // settings 贡献消费方（ADR-039）：Settings 弹窗分区（Phase A 声明式标题占位）。
  const settingsContributions = usePluginContributions<SettingsContribution>(
    host,
    "settings",
  );
  // 文档贡献（ADR-043 E-5）：Help 弹窗渲染插件寄存器手册等。
  const documentationContributions =
    usePluginContributions<DocumentationContribution>(host, "documentation");
  // 表类型贡献（ADR-041）：侧边栏按协议分组，插件组动态加载（插件启用 + 能力矩阵支持）。
  const tableTypeContributions = usePluginContributions<TableTypeContribution>(
    host,
    "tableType",
  );
  const sheetGroups = useMemo(() => {
    const supportedProtocols = host?.capabilities.protocolExtensions ?? [];
    const groups: Array<{
      key: string;
      sheetType: SheetType;
      titleKey: string;
    }> = [
      // 核心组：标准 Modbus 03H/10H 保持寄存器，恒存在。
      {
        key: "holding-register",
        sheetType: "holding-register",
        titleKey: "sidebar.groupModbus",
      },
    ];
    // 核心基础表组（ADR-043 E-2）：coil/discrete-input/input-register，
    // RTU 承载（codec 协议 ID），按能力矩阵 protocolExtensions 门控（VSCode 未接 codec 前不显示）。
    for (const meta of CORE_TABLE_TYPES) {
      if (meta.id === "holding-register") continue;
      const protocol = basicTablesProtocolId(meta.id);
      if (!supportedProtocols.includes(protocol)) continue;
      groups.push({
        key: meta.id,
        sheetType: meta.id,
        titleKey: meta.titleKey,
      });
    }
    for (const contribution of tableTypeContributions) {
      const { id, protocolId, titleKey } = contribution.payload;
      if (!supportedProtocols.includes(protocolId)) continue;
      const sheetType = `${contribution.pluginId}:${id}` as SheetType;
      groups.push({ key: sheetType, sheetType, titleKey });
    }
    return groups;
  }, [host, tableTypeContributions]);
  // 分组折叠状态（ADR-041 决策②）：受控展开 + 记忆用户手动折叠的组。
  // 不用 defaultActiveKey——插件贡献晚于 Collapse 挂载加载时，新组会默认折叠、
  // 用户看不到「67H 组」入口；这里对未手动折叠的组恒展开（新组加入即展开）。
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sheetGroupActiveKeys = sheetGroups
    .filter((group) => !collapsedGroups.has(group.key))
    .map((group) => group.key);
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
  const openSheet = useAppStore((s) => s.openSheet);
  const deleteSheet = useAppStore((s) => s.deleteSheet);
  const duplicateSheet = useAppStore((s) => s.duplicateSheet);
  const moveSheetTo = useAppStore((s) => s.moveSheetTo);
  const pendingDeleteSheetId = useAppStore((s) => s.pendingDeleteSheetId);
  const setPendingDeleteSheetId = useAppStore((s) => s.setPendingDeleteSheetId);
  const pendingBulkClose = useAppStore((s) => s.pendingBulkClose);
  const setPendingBulkClose = useAppStore((s) => s.setPendingBulkClose);
  const closeOtherSheets = useAppStore((s) => s.closeOtherSheets);
  const closeSheetsToRight = useAppStore((s) => s.closeSheetsToRight);
  // 帮助/关于弹窗（PRD §8.3 键盘操作，2026-08-30）：入 store 便于快捷键弹窗抑制。
  const helpOpen = useAppStore((s) => s.helpModalOpen);
  const setHelpOpen = useAppStore((s) => s.setHelpModalOpen);
  // Sheet 名重命名编辑态（组件/UI 层状态，不入全局 store）：页签头与侧边栏各自独立，
  // 互不驱动对方渲染；任一位置开始编辑时取消另一位置的编辑态，保证同一时刻至多一个。
  const [tabRenamingSheetId, setTabRenamingSheetId] = useState<SheetId | null>(
    null,
  );
  const [sidebarRenamingSheetId, setSidebarRenamingSheetId] =
    useState<SheetId | null>(null);
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
  // 侧边栏分组（ADR-041）容器：antd Menu 无法通过 items 配置直接给 <li> 设 draggable，
  // 提交后在真实 DOM 上补齐（多个分组 Menu 统一经容器查找），保证表项可真实拖拽排序。
  const sidebarListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sidebarListRef.current
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

  // 活动表 Slave Address / TCP Unit ID -> 会话：切换表/修改当前表值，或连接建立时，
  // 后续请求使用新值（2026-08-25：TCP Unit ID 会话内动态修改——连接后按活动表值覆盖
  // profile.unitId 初始值，与「每表独立」语义一致）。
  useEffect(() => {
    if (host === null || host === undefined) return;
    host.setSlaveAddress(activeSheetSlaveAddress);
  }, [host, activeSheetSlaveAddress, connectionState]);

  // 主题同步到 <html data-mamep-theme>：index.css 的 --mamep-* 暗色令牌依赖该属性，
  // 与 antd ConfigProvider 的暗色算法一起切换（组件内不得散落主题判断）。
  useEffect(() => {
    document.documentElement.dataset.mamepTheme = theme;
    return () => {
      delete document.documentElement.dataset.mamepTheme;
    };
  }, [theme]);

  // 主题主色同步到 --mamep-brand-primary / --mamep-focus-ring（ADR-042）：
  // 消除 index.css 的第二份硬编码品牌色副本——CSS 变量经 document root 内联覆盖
  // （内联样式优先于 :root / [data-mamep-theme] 规则）；CSS 保留默认值兜底。
  // 2026-09-03：插件色只提供单一明亮主色（种子），暗色下 antd 算法会派生出不同主色，
  // 这里取「当前模式派生后的真实主色」写入变量，与 antd 实际渲染保持一致
  // （getDesignToken 只读计算，不喂回 ConfigProvider，避免二次派生）。
  useEffect(() => {
    const seed = effectiveThemeConfig?.token?.colorPrimary;
    if (typeof seed !== "string" || seed.length === 0) return;
    const applied = deriveAppliedPrimary(seed, theme === "dark");
    document.documentElement.style.setProperty(
      "--mamep-brand-primary",
      applied,
    );
    document.documentElement.style.setProperty("--mamep-focus-ring", applied);
  }, [effectiveThemeConfig, theme]);

  // 活动表 Address Transform（ADR-042 表级 Address Adjust）→ 会话：
  // 切换表/修改当前表配置时同步（host 端会话经 session-set-address-transform RPC）。
  const activeSheetAddressTransform = useAppStore(
    (s) =>
      s.workspace.sheets.find(
        (sh) => sh.sheetId === (s.activeSheetId ?? s.workspace.activeSheetId),
      )?.addressTransform ?? null,
  );
  useEffect(() => {
    if (host === null || host === undefined) return;
    host.setAddressTransform(activeSheetAddressTransform);
  }, [host, activeSheetAddressTransform, connectionState]);

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

  // 当前活动表：仅在「打开」的表中寻找（关闭的表不在页签栏，也不应成为活动表）。
  const currentSheet = useMemo(
    () =>
      sheetMeta.find(
        (sheet) => sheet.sheetId === activeSheetId && sheet.open,
      ) ?? sheetMeta.find((sheet) => sheet.open),
    [sheetMeta, activeSheetId],
  );

  const connected = connectionState === "connected";

  // Header 直连 codec 协议（ADR-041）：与连接设置弹窗同源（活动表类型 → 协议）。
  const directSheetProtocol = protocolForSheetType(
    currentSheet?.type ?? "holding-register",
    tableTypeContributions,
    host?.capabilities.protocolExtensions ?? [],
  );
  // Header 直连防重复触发（发起即置位，落定清位；与连接忙态守卫配合）。
  const directConnectingRef = useRef(false);

  /** Header 直连：与弹窗 onSubmit 同路径执行；失败回退弹窗展示错误（决策 4/5）。 */
  const directConnect = async (
    profile: RtuConnectionProfile | TcpConnectionProfile,
  ): Promise<void> => {
    if (
      host === null ||
      host === undefined ||
      directConnectingRef.current
    ) {
      return;
    }
    directConnectingRef.current = true;
    try {
      const result = await runConnect(host, {
        protocol: profile.protocol,
        profile,
        sheetProtocol: directSheetProtocol,
        handle: selectedSerialHandle,
        isMock: host.isMockMode,
      });
      if (!result.ok) {
        setConnectError(
          `${t(result.error.userMessageKey)} (${result.error.technicalMessage})`,
        );
        setConnectionModalOpen(true);
      }
    } finally {
      directConnectingRef.current = false;
    }
  };

  const handleConnectToggle = (): void => {
    if (connected) {
      void host?.disconnect();
      return;
    }
    if (host === null || host === undefined) return;
    // 忙态（连接中/断开中/重连等）不重复发起。
    if (
      connectionState === "connecting" ||
      connectionState === "disconnecting" ||
      connectionState === "reconnecting" ||
      connectionState === "reconnect-waiting"
    ) {
      return;
    }
    const profile = connectionProfile ?? createDefaultRtuProfile();
    // 关键字段已就绪（RTU 已选 Port / TCP 已填 IP）→ 直连；否则回退弹窗引导填写。
    if (canDirectConnect(host, profile, selectedSerialHandle)) {
      void directConnect(profile);
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

  const startTabRename = (sheetId: SheetId): void => {
    // 互斥：从页签头开始编辑时取消侧边栏既有编辑态。
    setSidebarRenamingSheetId(null);
    setTabRenamingSheetId(sheetId);
  };
  const startSidebarRename = (sheetId: SheetId): void => {
    // 互斥：从侧边栏开始编辑时取消页签头既有编辑态。
    setTabRenamingSheetId(null);
    setSidebarRenamingSheetId(sheetId);
  };

  const handleRenameSheet = (sheetId: SheetId, source: RenameSource): void => {
    setActiveSheetId(sheetId);
    if (source === "tab") {
      startTabRename(sheetId);
    } else {
      startSidebarRename(sheetId);
    }
  };

  const handleDeleteSheet = (sheetId: SheetId): void => {
    setPendingDeleteSheetId(sheetId);
  };

  const confirmDeleteSheet = (): void => {
    if (pendingDeleteSheetId !== null) {
      deleteSheet(pendingDeleteSheetId);
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
    source: RenameSource,
  ): NonNullable<MenuProps["items"]> =>
    buildSheetMenuItems(t, sheetId, index, sheetMeta.length, {
      onRename: (id) => handleRenameSheet(id, source),
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

  // ---- 侧边栏分组（ADR-041 决策②）----
  // 单个表项的 Menu item（含拖拽属性、右键/更多菜单、重命名）。
  const sheetMenuItem = (
    sheet: { sheetId: SheetId; name: string; open: boolean },
    index: number,
  ): NonNullable<MenuProps["items"]>[number] => ({
    key: sheet.sheetId,
    "data-sheet-id": sheet.sheetId,
    "data-sheet-index": index,
    // rc-menu 会给 inline 顶层 item 内联 padding-left: inlineIndent(24px)，
    // 内联样式优先于 CSS，需在 item style 里覆盖回 6px 以保持原视觉。
    style: { paddingInline: 6 },
    className:
      sheet.sheetId === currentSheet?.sheetId
        ? "sheet-item sheet-item--active"
        : sheet.open
          ? "sheet-item"
          : "sheet-item sheet-item--closed",
    label: (
      <Dropdown
        trigger={["contextMenu"]}
        menu={{
          items: sheetMenu(sheet.sheetId, index, "sidebar"),
        }}
      >
        <span className="sheet-item__label-wrap">
          {sidebarRenamingSheetId === sheet.sheetId ? (
            <SheetNameEditor
              className="sheet-item__input"
              name={sheet.name}
              autoFocus
              onCommit={(name) => {
                renameSheet(sheet.sheetId, name);
                setSidebarRenamingSheetId(null);
              }}
              onCancel={() => setSidebarRenamingSheetId(null)}
            />
          ) : (
            <span className="sheet-item__name">{sheet.name}</span>
          )}
          <Dropdown
            menu={{
              items: sheetMenu(sheet.sheetId, index, "sidebar"),
            }}
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
  });

  // 单个分组的 Menu（组内表项拖拽排序；组与组之间因分属不同 Menu 不可跨组拖拽，
  // 与「不同类型表之间不可随意复制粘贴」（决策⑥）一致）。
  const renderGroupMenu = (
    groupSheets: Array<{
      sheetId: SheetId;
      name: string;
      open: boolean;
      index: number;
    }>,
  ) => (
    <Menu
      className="sheet-sidebar__list sheet-sidebar__menu"
      mode="inline"
      inlineCollapsed={false}
      selectable
      selectedKeys={currentSheet !== undefined ? [currentSheet.sheetId] : []}
      onClick={({ key, domEvent }) => {
        // Dropdown 弹层（右键/更多菜单项）在 React 树上是 Menu item 的后代，
        // 点击弹层项会经 React 树冒泡到条目 onClick；但那是菜单动作（如 Duplicate）
        // 而非“切换表”意图，忽略以免把 active 切回源表。
        const target = domEvent.target as HTMLElement;
        if (target.closest(".ant-dropdown") !== null) return;
        // 已关闭的表：先重新打开再激活；已打开的表：仅切换。
        openSheet(key as SheetId);
      }}
      onDragStart={(event) => {
        const li = (event.target as HTMLElement).closest<HTMLLIElement>(
          "li[data-sheet-index]",
        );
        if (li?.dataset.sheetIndex !== undefined) {
          dragIndex.current = Number(li.dataset.sheetIndex);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const li = (event.target as HTMLElement).closest<HTMLLIElement>(
          "li[data-sheet-index]",
        );
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
      items={groupSheets.map((sheet) => sheetMenuItem(sheet, sheet.index))}
    />
  );

  return (
    <ConfigProvider theme={effectiveThemeConfig}>
      <AntApp>
        <Layout style={{ height: "100vh" }}>
          <Layout.Header className="mamep-header">
            <div className="mamep-header__brand">
              {/* 品牌图标：内联 SVG 组件（颜色随主题：浅=黑、暗=白，见 assets/AppIcon.tsx） */}
              <Avatar
                shape="square"
                size={22}
                icon={<AppIcon />}
                className="mamep-header__brand-icon"
              />
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
                {/* data-conn-state：纯展示钩子，供 CSS 按连接态着色状态胶囊（不改任何行为/契约） */}
                <span
                  className="status-badge"
                  data-conn-state={connectionState}
                >
                  <span
                    className="status-badge__dot"
                    style={{
                      backgroundColor: STATE_DOT_COLOR[connectionState],
                    }}
                  />
                  <span>{t(`state.${connectionState}`)}</span>
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
              {/* 折叠窄条下的新建表按钮（原「＋」在分组头内，折叠时仅保留此按钮） */}
              <Tooltip title={t("sidebar.newTable")}>
                <Button
                  type="text"
                  size="small"
                  className="sheet-sidebar__collapsed-add"
                  aria-label={t("sidebar.newTable")}
                  icon={<PlusOutlined />}
                  onClick={() => addSheet()}
                />
              </Tooltip>
              {/* 分区标题保留（新建入口已移入各分组头右侧 +，ADR-041 决策②） */}
              <div className="sheet-sidebar__section">
                <span className="sheet-sidebar__section-title">
                  {t("sidebar.registerTables")}
                </span>
              </div>
              <div ref={sidebarListRef} className="sheet-sidebar__groups">
                <Collapse
                  ghost
                  className="sheet-sidebar__groups-collapse"
                  activeKey={sheetGroupActiveKeys}
                  onChange={(keys) => {
                    const expanded = new Set(
                      Array.isArray(keys) ? keys : [keys],
                    );
                    setCollapsedGroups(
                      new Set(
                        sheetGroups
                          .filter((group) => !expanded.has(group.key))
                          .map((group) => group.key),
                      ),
                    );
                  }}
                  items={sheetGroups.map((group) => ({
                    key: group.key,
                    label: (
                      <span
                        className="sheet-sidebar__group-head"
                        data-sheet-group={group.key}
                      >
                        <span className="sheet-sidebar__group-title">
                          {t(group.titleKey)}
                        </span>
                        <Tooltip title={t("sidebar.newTable")}>
                          <Button
                            type="text"
                            size="small"
                            className="sheet-sidebar__group-action"
                            // 核心组保持「New Register Table」（既有 e2e 定位依赖）；
                            // 插件组用组标题作 aria-label（语义 = 在该组新建对应类型表）。
                            aria-label={
                              group.sheetType === "holding-register"
                                ? t("sidebar.newTable")
                                : t(group.titleKey)
                            }
                            icon={<PlusOutlined />}
                            onClick={(event) => {
                              event.stopPropagation();
                              addSheet(group.sheetType);
                            }}
                          />
                        </Tooltip>
                      </span>
                    ),
                    children: renderGroupMenu(
                      sheetMeta
                        .map((sheet, index) => ({ ...sheet, index }))
                        .filter((sheet) => sheet.type === group.sheetType),
                    ),
                  }))}
                />
              </div>
              <div className="sheet-sidebar__footer">
                {t(
                  host?.platform === "electron"
                    ? "sidebar.footerClient"
                    : host?.platform === "vscode"
                      ? "sidebar.footerExtension"
                      : "sidebar.footerBrowser",
                  { version: host?.appVersion ?? "" },
                )}
              </div>
            </Layout.Sider>
            <Layout.Content className="mamep-body">
              {/* 浏览器兼容性提示（PRD §8.3 / §15.7）：不支持 Web Serial / 非安全上下文时展示 */}
              <BrowserCompatibilityBanner
                compatibility={host?.browserCompatibility ?? null}
                isMock={host?.isMockMode ?? false}
              />
              {/* 工作区恢复提示（ADR-049）：从备份恢复 / 恢复失败重建为空时展示 */}
              <RecoveryBanner recovery={workspaceRecovery} />
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
                        hideAdd
                        activeKey={currentSheet.sheetId}
                        onChange={(key) => setActiveSheetId(key as SheetId)}
                        onEdit={(targetKey) => {
                          // 页签「×」= 非破坏性关闭（表仍保留在侧边栏，可从侧边栏重新打开）。
                          // hideAdd 后不存在 add 动作，此处仅处理 remove。
                          if (typeof targetKey === "string") {
                            closeSheet(targetKey as SheetId);
                          }
                        }}
                        items={sheetMeta
                          .map((sheet, index) => ({ sheet, index }))
                          .filter(({ sheet }) => sheet.open)
                          .map(({ sheet, index }) => ({
                            key: sheet.sheetId,
                            label: (
                              <Dropdown
                                trigger={["contextMenu"]}
                                menu={{
                                  items: sheetMenu(sheet.sheetId, index, "tab"),
                                }}
                              >
                                {tabRenamingSheetId === sheet.sheetId ? (
                                  <SheetNameEditor
                                    className="sheet-tab__input"
                                    name={sheet.name}
                                    onCommit={(name) => {
                                      renameSheet(sheet.sheetId, name);
                                      setTabRenamingSheetId(null);
                                    }}
                                    onCancel={() => setTabRenamingSheetId(null)}
                                  />
                                ) : (
                                  <span
                                    className="sheet-tab__label"
                                    onDoubleClick={() =>
                                      startTabRename(sheet.sheetId)
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
                    ) : (
                      <div className="register-table-empty">
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t("table.noOpenSheets")}
                        >
                          <Typography.Text type="secondary">
                            {t("table.noOpenSheetsHint")}
                          </Typography.Text>
                        </Empty>
                      </div>
                    )}
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
        <WorkspaceImportModal />
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
              <Typography.Text>{t("settings.themeColor")}</Typography.Text>
              <Select
                size="small"
                style={{ marginLeft: 8, minWidth: 160 }}
                aria-label={t("settings.themeColor")}
                value={themePrimary ?? DEFAULT_THEME_COLOR_ID}
                onChange={(value) =>
                  setThemePrimary(
                    value === DEFAULT_THEME_COLOR_ID ? null : value,
                  )
                }
                options={[
                  {
                    value: DEFAULT_THEME_COLOR_ID,
                    label: t("settings.themeColorDefault"),
                  },
                  ...themeColorOptions.map((option) => ({
                    value: option.id,
                    label: themeColorOptionLabel(
                      themeColorTitle(option, i18n.language, t),
                      option.colorPrimary,
                    ),
                  })),
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
            <div>
              <WorkspaceFileActions />
            </div>
            {settingsContributions.length > 0 && (
              <div className="plugin-settings" data-testid="plugin-settings">
                {settingsContributions.map((contribution) => (
                  <div key={contribution.payload.id}>
                    <Divider titlePlacement="left" plain>
                      {t(contribution.payload.titleKey)}
                    </Divider>
                    <Typography.Text type="secondary">
                      {t("plugins.settingsPlaceholder")}
                    </Typography.Text>
                  </div>
                ))}
              </div>
            )}
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

        <HelpDrawer
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          documentationContributions={documentationContributions}
        />
        <AppShortcutLayer onOpenHelp={() => setHelpOpen(true)} />
      </AntApp>
    </ConfigProvider>
  );
}
