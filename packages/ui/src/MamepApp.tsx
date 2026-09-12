import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import type { MenuProps } from "antd";
import {
  App as AntApp,
  Avatar,
  Button,
  ConfigProvider,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Layout,
  Menu,
  Modal,
  Splitter,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import { AppIcon } from "./assets/AppIcon";
import { usePluginContributions } from "./plugin/use-contributions";
import {
  deriveAppliedPrimary,
  findThemeColorOption,
  themeConfigForColorOption,
  type ThemeContribution,
} from "./plugin/theme-contributions";
import {
  protocolForSheetType,
  type TableTypeContribution,
} from "./plugin/plugin-registries";
import {
  ApiOutlined,
  AppstoreOutlined,
  DatabaseOutlined,
  DisconnectOutlined,
  FundOutlined,
  LeftOutlined,
  MenuOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  RightOutlined,
  SettingOutlined,
  ThunderboltOutlined,
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
import { connectionButtonSpec } from "./connection-button";
import { useIsMobileLayout } from "./layout/breakpoints";
import { closeTopOverlay, useOverlayClose } from "./overlay-close";
import { buildTheme } from "./theme";
import { useAppStore } from "./app-store";
import { canDirectConnect, runConnect } from "./connection-actions";
import { BottomPanel } from "./components/BottomPanel";
import { AppShortcutLayer } from "./components/AppShortcutLayer";
import { AppStartupPlaceholder } from "./components/AppStartupPlaceholder";
import { BrowserCompatibilityBanner } from "./components/BrowserCompatibilityBanner";
import { ConnectionSettingsModal } from "./components/ConnectionSettingsModal";
import { RecoveryBanner } from "./components/RecoveryBanner";
import type { DocumentationContribution } from "./components/documentation-markdown";
import { RegisterTable } from "./components/RegisterTable";
import { SheetNameEditor } from "./components/SheetNameEditor";
import { buildSheetMenuItems } from "./components/SheetMenu";
import { useOpenedOnce } from "./opened-once";

/**
 * 代码分割（2026-09-11 ToDoList「构建产物代码分割」）：仅按需打开的弹窗/抽屉改为
 * `React.lazy` 动态 import——antd 重组件与帮助正文等只在首次使用时下载，首个 chunk
 * 显著减小（与 vite.config.ts 的 vendor 分包配合）。
 *
 * 注意：**每个懒组件必须各自包一层 `<Suspense>`**——若共用同一 boundary，任一组件
 * 挂起时会把该 boundary 下的其余兄弟节点一并卸载（弹窗互相消失）。挂载门控见
 * `useOpenedOnce`（首次打开才挂载，此后常驻以保留 antd 关闭动画）。
 *
 * Settings 于 2026-09-12 由 Modal 改为右侧 Drawer（`SettingsDrawer`）；仍是懒加载 +
 * `useOpenedOnce` 门控，store 字段名（`settingsModalOpen`）保持不变。插件管理（原独立
 * `PluginManagerModal` 弹窗）已于 2026-09-12 并入 Settings 的「Plugins」页签，独立的
 * 懒加载映射与挂载门控随之移除。
 *
 * `ConnectionSettingsModal` **保持静态导入**：非 mock（浏览器/Electron/VSCode）启动后
 * 工作区加载完成即自动打开，属首屏路径——懒加载只会多一次异步跳变（实测会让「启动弹窗」
 * 晚于 e2e 的等待窗口出现）。
 */
const HelpDrawer = lazy(() =>
  import("./components/HelpDrawer").then((m) => ({ default: m.HelpDrawer })),
);
const WorkspaceImportModal = lazy(() =>
  import("./components/WorkspaceImportModal").then((m) => ({
    default: m.WorkspaceImportModal,
  })),
);
const TraceWindow = lazy(() =>
  import("./components/TraceWindow").then((m) => ({ default: m.TraceWindow })),
);
const SettingsDrawer = lazy(() =>
  import("./components/SettingsDrawer").then((m) => ({
    default: m.SettingsDrawer,
  })),
);

/** 折叠时底部面板仅保留标签栏的高度（px）。 */
const COLLAPSED_BOTTOM_PANEL_HEIGHT = 40;

/** Sheet 名重命名入口来源：页签头（tab）或侧边栏（sidebar），决定编辑态落在哪一处。 */
type RenameSource = "tab" | "sidebar";

/** 侧边栏分组折叠态图标（ADR-041 分组）：按表类型区分，插件/未知组回退通用图标。 */
function sidebarGroupIcon(sheetType: SheetType): ReactNode {
  // 分组图标为装饰性（组标题已表达分组语义）：aria-hidden 净化 a11y 名；
  // 同时把 aria-label 置空，避免其自带图标名（如 database）被
  // getByLabel("Data") 等子串匹配误命中（Playwright getByLabel 按原始 aria-label
  // 匹配、不理会 aria-hidden，2026-09-08 修复）。
  switch (sheetType) {
    case "holding-register":
      return <DatabaseOutlined aria-label="" aria-hidden />;
    case "coil":
      return <ThunderboltOutlined aria-label="" aria-hidden />;
    case "discrete-input":
      return <ReadOutlined aria-label="" aria-hidden />;
    case "input-register":
      return <FundOutlined aria-label="" aria-hidden />;
    default:
      return <AppstoreOutlined aria-label="" aria-hidden />;
  }
}

export function MamepApp(): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((s) => s.host);
  // Host 装配状态（2026-09-13 启动骨架）：宿主实现按运行时平台动态加载期间显示占位。
  const hostStatus = useAppStore((s) => s.hostStatus);
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
  const connectionProfile = useAppStore(
    (s) => s.workspace.connectionProfiles[0],
  );
  const selectedSerialHandle = useAppStore((s) => s.selectedSerialHandle);
  const setConnectError = useAppStore((s) => s.setConnectError);
  const settingsOpen = useAppStore((s) => s.settingsModalOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsModalOpen);
  const theme = useAppStore((s) => s.theme);
  // 所选主题色预设（ADR-047）：null=内置 Ant Design 默认蓝；插件色=`<pluginId>:<colorId>`；随工作区持久化。
  const themePrimary = useAppStore((s) => s.themePrimary);
  // 宿主完整主题（VSCode ui-theme 装配，ADR-027）；null=回退 buildTheme 两态。
  const themeConfig = useAppStore((s) => s.themeConfig);
  // 插件主题贡献（2026-09-02，ADR-047）：此处仅用于解析所选预设（选项列表由 SettingsDrawer
  // 自行读取）；**不再自动应用**（ADR-042 插件层最高优先已移除）。
  const themeContributions = usePluginContributions<ThemeContribution>(
    host,
    "theme",
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
  // 文档贡献（ADR-043 E-5）：Help 弹窗渲染插件寄存器手册等。
  // （settings 贡献消费方已随 Settings 抽出到 SettingsDrawer，2026-09-11 代码分割。）
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
  // 分组折叠状态（ADR-041 决策②）：受控 openKeys + 记忆用户手动折叠的组。
  // 不用 defaultOpenKeys——插件贡献晚于 Menu 挂载加载时，新组会默认折叠、
  // 用户看不到「67H 组」入口；这里对未手动折叠的组恒展开（新组加入即展开）。
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sheetGroupOpenKeys = sheetGroups
    .filter((group) => !collapsedGroups.has(group.key))
    .map((group) => group.key);
  const handleGroupOpenChange = (keys: string[]): void => {
    // 折叠态下 antd 会因 Sider 折叠把内联 openKeys 重置为空并触发 onOpenChange([])，
    // 该变化非用户意图，不得据此把「分组折叠记忆」写成全部折叠；仅展开态的真实开合才回写。
    if (sidebarCollapsed) return;
    const openSet = new Set(keys);
    setCollapsedGroups(
      new Set(
        sheetGroups
          .filter((group) => !openSet.has(group.key))
          .map((group) => group.key),
      ),
    );
  };
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
  const sidebarWidth = useAppStore((s) => s.workspace.panelLayout.sidebarWidth);
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
  // 懒加载弹窗/抽屉的挂载门控（代码分割，2026-09-11）：首次打开才挂载该组件（chunk 按需
  // 下载），此后常驻以保留 antd 关闭动画。弹窗自身的开合仍由其内部读 store 的 open 控制。
  // （ConnectionSettingsModal 例外：启动即自动打开、属首屏路径，故静态导入、不门控。）
  const workspaceImportOpen = useAppStore(
    (s) => s.workspaceImportDraft !== null,
  );
  const workspaceImportMounted = useOpenedOnce(workspaceImportOpen);
  const settingsMounted = useOpenedOnce(settingsOpen);
  const helpMounted = useOpenedOnce(helpOpen);
  // Sheet 名重命名编辑态（组件/UI 层状态，不入全局 store）：页签头与侧边栏各自独立，
  // 互不驱动对方渲染；任一位置开始编辑时取消另一位置的编辑态，保证同一时刻至多一个。
  const [tabRenamingSheetId, setTabRenamingSheetId] = useState<SheetId | null>(
    null,
  );
  const [sidebarRenamingSheetId, setSidebarRenamingSheetId] =
    useState<SheetId | null>(null);
  // 移动布局（ADR-050 Phase 3）：< 1024px 时侧栏→左抽屉、底部面板→底部抽屉；
  // 同一阈值也决定顶栏次要操作的收纳（Phase 3 前为 1100px，现统一为 1023px，避免两套阈值打架）。
  const isMobileLayout = useIsMobileLayout();
  const narrow = isMobileLayout;
  // 移动端两个抽屉的开合（会话内状态，不入持久化）：返回键优先关它们（见 overlay-close）。
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  useOverlayClose(mobileSidebarOpen, () => setMobileSidebarOpen(false));
  useOverlayClose(mobilePanelOpen, () => setMobilePanelOpen(false));
  // Splitter 受控 size 拖拽过程缓冲：onResize 更新本地，onResizeEnd 才持久化到 panelLayout（避免高频写 store）。
  const [dragPanelHeight, setDragPanelHeight] = useState<number | null>(null);
  // 侧边栏宽度拖拽缓冲：与底部面板同模式，onResize 更新本地、onResizeEnd 才写 store。
  const [dragSidebarWidth, setDragSidebarWidth] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  const dragGroup = useRef<string | null>(null);
  // 侧边栏分组（ADR-041）容器：antd Menu 无法通过 items 配置直接给 <li> 设 draggable，
  // 提交后在真实 DOM 上补齐（多个分组 Menu 统一经容器查找），保证表项可真实拖拽排序。
  const sidebarListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sidebarListRef.current
      ?.querySelectorAll<HTMLLIElement>("li[data-sheet-id]")
      .forEach((el) => {
        // 正在重命名的表项不可拖拽：编辑输入框渲染在该 li 内，若 li 保持 draggable，
        // 用户在输入框上按住+拖动会被当作拖拽表项而非文本选择（2026-09-08 修复）。
        // 其余表项保持可拖拽排序；本 effect 每次渲染后执行，随 sidebarRenamingSheetId 更新。
        el.draggable = el.dataset.sheetId !== sidebarRenamingSheetId;
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

  // 屏幕常亮（KeepAwake，ADR-050 Phase 3）：只要存在持续轮询或追踪就保持屏幕不休眠。
  // 仅 Android 实现（其余平台不实现该方法 → 可选链空操作）；值变化时才调用（幂等）。
  const hasContinuousWork = useAppStore((s) =>
    s.workspace.sheets.some((sheet) =>
      sheet.rows.some((row) => row.pollingEnabled || row.traceEnabled),
    ),
  );
  useEffect(() => {
    host?.setKeepScreenOn?.(hasContinuousWork);
  }, [host, hasContinuousWork]);

  // 硬件返回键（Android，ADR-050 Phase 3）：先关最上层覆盖层（移动端抽屉等，经 overlay-close 栈），
  // 无覆盖层时不消费 → 宿主兑底最小化应用（不退出进程）。浏览器/桌面无此能力 → 返回 null。
  useEffect(() => {
    const unsubscribe = host?.onHardwareBack?.(() => closeTopOverlay()) ?? null;
    return () => {
      unsubscribe?.();
    };
  }, [host]);

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
  // 连接多功能按钮规格（2026-09-06 连接 UI 整合）：状态点 + 文字/图标随连接态切换；窄窗口收起文字。
  const connSpec = connectionButtonSpec(connectionState, narrow);

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
    if (host === null || host === undefined || directConnectingRef.current) {
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
    // 忙态（连接中/断开中/选择设备/重连等）不重复发起；failed/interrupted 不守 → 作为重连入口。
    if (
      connectionState === "selecting-device" ||
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
  // 单个表项的 Menu item（含拖拽属性；折叠态简化为仅切换的纯文本项，展开态保留右键/更多/重命名）。
  const sheetMenuItem = (
    sheet: { sheetId: SheetId; name: string; open: boolean },
    index: number,
    groupKey: string,
  ): NonNullable<MenuProps["items"]>[number] => ({
    key: sheet.sheetId,
    "data-sheet-id": sheet.sheetId,
    "data-sheet-index": index,
    "data-sheet-group": groupKey,
    // rc-menu 会给 inline 顶层 item 内联 padding-left: inlineIndent(24px)，
    // 内联样式优先于 CSS，需在 item style 里覆盖回 6px 以保持原视觉。
    style: { paddingInline: 6 },
    className:
      sheet.sheetId === currentSheet?.sheetId
        ? "sheet-item sheet-item--active"
        : sheet.open
          ? "sheet-item"
          : "sheet-item sheet-item--closed",
    // 折叠态（窄条弹层）：仅切换表；不渲染更名输入框 / 右键 / More 菜单。
    label: sidebarCollapsed ? (
      <span className="sheet-item__name">{sheet.name}</span>
    ) : (
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

  // 侧边栏分组菜单 items（ADR-041 决策②）：单 Menu + 每分组一个 SubMenu。
  // 折叠态凭 SiderContext 自动收缩为图标并悬停弹出子项；展开态内联展示，组头可折叠、
  // 「＋」新建、组内拖拽（跨组禁拖，决策⑥——经 data-sheet-group 同组守卫）。
  const sidebarMenuItems: NonNullable<MenuProps["items"]> = sheetGroups.map(
    (group) => {
      const groupSheets = sheetMeta
        .map((sheet, index) => ({ ...sheet, index }))
        .filter((sheet) => sheet.type === group.sheetType);
      return {
        key: group.key,
        icon: sidebarGroupIcon(group.sheetType),
        popupClassName: "sheet-sidebar__popup",
        label: (
          <span
            className="sheet-sidebar__group-head"
            data-sheet-group={group.key}
          >
            {/* 点击分组名折叠/展开（悬浮提示）；「+」为唯一右侧操作（stopPropagation 不触发折叠）。 */}
            <Tooltip title={t("sidebar.toggleGroup")}>
              <span className="sheet-sidebar__group-title">
                {t(group.titleKey)}
              </span>
            </Tooltip>
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
        children: groupSheets.map((sheet) =>
          sheetMenuItem(sheet, sheet.index, group.key),
        ),
      };
    },
  );

  // 启动骨架（2026-09-13）：Host 按运行时平台动态加载（含失败兜底）完成前显示占位——
  // 仍包 ConfigProvider/AntApp，保证主题（含 VSCode 完整令牌/暗色）与 antd 上下文一致，
  // 避免深色主题下白屏闪烁。`failed` 状态不占位：应用以「无 Host」保持可操作。
  // 注意：必须位于全部 hook 调用之后（上方 hook 均无条件执行）。
  if (hostStatus === "assembling") {
    return (
      <ConfigProvider theme={effectiveThemeConfig}>
        <AntApp>
          <AppStartupPlaceholder />
        </AntApp>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={effectiveThemeConfig}>
      <AntApp>
        <Layout style={{ height: "100vh" }}>
          <Layout.Header className="mamep-header">
            {/* 移动布局：表列表入口（左抽屉）；桌面由常驻侧栏承担同一职责。 */}
            {isMobileLayout && (
              <Button
                size="small"
                type="text"
                className="mamep-header__menu"
                aria-label={t("mobile.openTables")}
                title={t("mobile.openTables")}
                icon={<MenuOutlined />}
                onClick={() => setMobileSidebarOpen(true)}
              />
            )}
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
              {host !== null && host !== undefined && host.isMockMode && (
                <span className="mamep-header__protocol">
                  {t("topbar.mock")}
                </span>
              )}
            </div>
            <Divider
              vertical
              style={{ height: 20, marginInline: 2, flex: "none" }}
            />
            {/* 连接区：单一多功能按钮（状态显示 + Connect/Disconnect/重连 合一）——
                状态点并入按钮、按钮文字随连接状态切换；窄窗口收起文字仅留状态点+图标（不隐藏连接状态）。
                data-conn-state：纯展示钩子，供 CSS 按连接态着色状态点（不改任何行为/契约）。 */}
            <div className="connection-cluster">
              <Button
                size="small"
                className="connection-cluster__button"
                type={connSpec.type}
                {...(connSpec.color ? { color: connSpec.color } : {})}
                {...(connSpec.variant ? { variant: connSpec.variant } : {})}
                danger={connSpec.danger}
                onClick={handleConnectToggle}
                aria-label={t(connSpec.ariaLabelKey)}
                title={t(connSpec.titleKey)}
                data-conn-state={connectionState}
              >
                <span className="connection-cluster__content">
                  <span
                    className={`conn-btn__dot${connSpec.pulsing ? " conn-btn__dot--pulse" : ""}`}
                    style={{ backgroundColor: connSpec.dotColor }}
                  />
                  {connSpec.hideLabel ? (
                    connSpec.icon === "disconnect" ? (
                      <DisconnectOutlined />
                    ) : (
                      <ApiOutlined />
                    )
                  ) : (
                    <span>{t(connSpec.labelKey)}</span>
                  )}
                </span>
              </Button>
            </div>
            <span className="mamep-header__spacer" />
            <div className="mamep-header__group">
              {/* Connection 入口始终可见（不收进 More），置于 Settings/Help 之前 */}
              <Button
                size="small"
                icon={<ApiOutlined />}
                aria-label={t("topbar.connectionSettings")}
                onClick={() => setConnectionModalOpen(true)}
              >
                {isMobileLayout ? undefined : t("topbar.connectionSettings")}
              </Button>
              {/* 移动布局：底部面板入口（底部抽屉）；桌面由常驻底部面板承担。 */}
              {isMobileLayout && (
                <Button
                  size="small"
                  icon={<MessageOutlined />}
                  aria-label={t("mobile.openPanel")}
                  title={t("mobile.openPanel")}
                  onClick={() => setMobilePanelOpen(true)}
                />
              )}
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
          <Splitter
            orientation="horizontal"
            className="mamep-main"
            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
            classNames={{ dragger: "sidebar-panel__resize" }}
            onResize={(sizes) => {
              const w = sizes[0];
              if (w !== undefined) setDragSidebarWidth(Math.round(w));
            }}
            onResizeEnd={(sizes) => {
              const w = sizes[0];
              if (w !== undefined) {
                setPanelLayout({ sidebarWidth: Math.round(w) });
                setDragSidebarWidth(null);
              }
            }}
          >
            {!isMobileLayout && (
              <Splitter.Panel
                className={`sheet-sidebar ant-layout-sider${sidebarCollapsed ? " ant-layout-sider-collapsed" : ""}`}
                size={
                  sidebarCollapsed ? 36 : (dragSidebarWidth ?? sidebarWidth)
                }
                resizable={!sidebarCollapsed}
                {...(sidebarCollapsed ? {} : { min: 120, max: "40%" })}
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
                {/* 分区标题保留（新建入口已移入各分组头右侧 +，ADR-041 决策②） */}
                <div className="sheet-sidebar__section">
                  <span className="sheet-sidebar__section-title">
                    {t("sidebar.registerTables")}
                  </span>
                </div>
                <div ref={sidebarListRef} className="sheet-sidebar__groups">
                  <Menu
                    className="sheet-sidebar__list sheet-sidebar__menu sheet-sidebar__sidebar-menu"
                    mode="inline"
                    inlineCollapsed={sidebarCollapsed}
                    selectable
                    selectedKeys={
                      currentSheet !== undefined ? [currentSheet.sheetId] : []
                    }
                    {...(sidebarCollapsed
                      ? {}
                      : { openKeys: sheetGroupOpenKeys })}
                    onOpenChange={handleGroupOpenChange}
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
                      const li = (
                        event.target as HTMLElement
                      ).closest<HTMLLIElement>("li[data-sheet-index]");
                      if (li?.dataset.sheetIndex !== undefined) {
                        dragIndex.current = Number(li.dataset.sheetIndex);
                        dragGroup.current = li.dataset.sheetGroup ?? null;
                      }
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const li = (
                        event.target as HTMLElement
                      ).closest<HTMLLIElement>("li[data-sheet-index]");
                      const fromIndex = dragIndex.current;
                      const fromGroup = dragGroup.current;
                      dragIndex.current = null;
                      dragGroup.current = null;
                      if (li?.dataset.sheetIndex === undefined) return;
                      if (fromIndex === null) return;
                      // 跨组禁拖（ADR-041 决策⑥）：源/目标分组不同则忽略。
                      if (li.dataset.sheetGroup !== fromGroup) return;
                      const toIndex = Number(li.dataset.sheetIndex);
                      if (fromIndex === toIndex) return;
                      const source = sheetMeta[fromIndex];
                      if (source !== undefined) {
                        moveSheetTo(source.sheetId, toIndex);
                      }
                    }}
                    items={sidebarMenuItems}
                  />
                </div>
                <div className="sheet-sidebar__footer">
                  {t(
                    host?.platform === "electron"
                      ? "sidebar.footerClient"
                      : host?.platform === "vscode"
                        ? "sidebar.footerExtension"
                        : host?.platform === "android"
                          ? "sidebar.footerAndroid"
                          : "sidebar.footerBrowser",
                    { version: host?.appVersion ?? "" },
                  )}
                </div>
              </Splitter.Panel>
            )}
            <Splitter.Panel>
              <div className="mamep-body">
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
                                    items: sheetMenu(
                                      sheet.sheetId,
                                      index,
                                      "tab",
                                    ),
                                  }}
                                >
                                  {tabRenamingSheetId === sheet.sheetId ? (
                                    <SheetNameEditor
                                      className="sheet-tab__input"
                                      name={sheet.name}
                                      autoFocus
                                      onCommit={(name) => {
                                        renameSheet(sheet.sheetId, name);
                                        setTabRenamingSheetId(null);
                                      }}
                                      onCancel={() =>
                                        setTabRenamingSheetId(null)
                                      }
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
                              children: (
                                <RegisterTable sheetId={sheet.sheetId} />
                              ),
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
                  {!isMobileLayout && (
                    <Splitter.Panel
                      size={
                        bottomPanelCollapsed
                          ? COLLAPSED_BOTTOM_PANEL_HEIGHT
                          : (dragPanelHeight ?? bottomPanelHeight)
                      }
                      resizable={!bottomPanelCollapsed}
                      {...(bottomPanelCollapsed
                        ? {}
                        : { min: 120, max: "60%" })}
                    >
                      <BottomPanel />
                    </Splitter.Panel>
                  )}
                </Splitter>
              </div>
            </Splitter.Panel>
          </Splitter>
        </Layout>

        <ConnectionSettingsModal />
        {workspaceImportMounted && (
          <Suspense fallback={null}>
            <WorkspaceImportModal />
          </Suspense>
        )}

        {/* 移动端抽屉（ADR-050 Phase 3）：侧栏表列表 + 底部面板。
            开合为会话内状态（不入持久化）；返回键优先关它们（overlay-close 栈）。 */}
        <Drawer
          placement="left"
          open={isMobileLayout && mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
          size={280}
          className="mamep-mobile-drawer mamep-mobile-drawer--sidebar"
          styles={{ body: { padding: 0 } }}
        >
          <div className="sheet-sidebar sheet-sidebar--drawer">
            <div className="sheet-sidebar__section">
              <span className="sheet-sidebar__section-title">
                {t("sidebar.registerTables")}
              </span>
            </div>
            <div className="sheet-sidebar__groups">
              <Menu
                className="sheet-sidebar__list sheet-sidebar__menu sheet-sidebar__sidebar-menu"
                mode="inline"
                selectable
                selectedKeys={
                  currentSheet !== undefined ? [currentSheet.sheetId] : []
                }
                openKeys={sheetGroupOpenKeys}
                onOpenChange={handleGroupOpenChange}
                onClick={({ key, domEvent }) => {
                  const target = domEvent.target as HTMLElement;
                  if (target.closest(".ant-dropdown") !== null) return;
                  openSheet(key as SheetId);
                  // 选中表后自动收起抽屉（移动端没有常驻侧栏，避免遮挡表格）。
                  setMobileSidebarOpen(false);
                }}
                items={sidebarMenuItems}
              />
            </div>
            <div className="sheet-sidebar__footer">
              {t(
                host?.platform === "electron"
                  ? "sidebar.footerClient"
                  : host?.platform === "vscode"
                    ? "sidebar.footerExtension"
                    : host?.platform === "android"
                      ? "sidebar.footerAndroid"
                      : "sidebar.footerBrowser",
                { version: host?.appVersion ?? "" },
              )}
            </div>
          </div>
        </Drawer>
        <Drawer
          placement="bottom"
          open={isMobileLayout && mobilePanelOpen}
          onClose={() => setMobilePanelOpen(false)}
          size="60vh"
          className="mamep-mobile-drawer mamep-mobile-drawer--panel"
          styles={{ body: { padding: 0 } }}
        >
          <BottomPanel variant="drawer" />
        </Drawer>
        {traceWindowKeys.map((rowId) => (
          <Suspense key={rowId} fallback={null}>
            <TraceWindow rowId={rowId as RowId} />
          </Suspense>
        ))}

        {settingsMounted && (
          <Suspense fallback={null}>
            <SettingsDrawer host={host} />
          </Suspense>
        )}

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

        {helpMounted && (
          <Suspense fallback={null}>
            <HelpDrawer
              open={helpOpen}
              onClose={() => setHelpOpen(false)}
              documentationContributions={documentationContributions}
            />
          </Suspense>
        )}
        <AppShortcutLayer onOpenHelp={() => setHelpOpen(true)} />
      </AntApp>
    </ConfigProvider>
  );
}
