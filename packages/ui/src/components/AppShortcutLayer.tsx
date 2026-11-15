/**
 * App 级快捷键装配层（PRD §8.3 P1「更完整的键盘操作」）。
 * 渲染在 MamepApp 的 <AntApp> 之内（App.useApp() message 可用，供导入/导出提示）。
 * 动作经 store/宿主直达；帮助弹窗经 props 回调（helpModalOpen 已入 store 供弹窗抑制）。
 * 同时渲染浏览器端导入所需的隐藏 <input type="file">（workspaceImport === "upload"）。
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../app-store";
import {
  useGlobalShortcuts,
  type GlobalShortcutActions,
} from "../keyboard/useGlobalShortcuts";
import { useWorkspaceTransfer } from "../workspace-transfer";

interface AppShortcutLayerProps {
  /** 打开帮助弹窗（MamepApp 经 store.helpModalOpen 控制，这里只是触发回调）。 */
  onOpenHelp: () => void;
}

export function AppShortcutLayer({
  onOpenHelp,
}: AppShortcutLayerProps): React.ReactNode {
  const host = useAppStore((s) => s.host);
  const connectionState = useAppStore((s) => s.connectionState);
  const setConnectionModalOpen = useAppStore((s) => s.setConnectionModalOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsModalOpen);
  const setTheme = useAppStore((s) => s.setTheme);
  const theme = useAppStore((s) => s.theme);
  const addSheet = useAppStore((s) => s.addSheet);
  const closeSheet = useAppStore((s) => s.closeSheet);
  const setActiveSheetId = useAppStore((s) => s.setActiveSheetId);
  const setPanelLayout = useAppStore((s) => s.setPanelLayout);
  const activeSheetId = useAppStore(
    (s) => s.activeSheetId ?? s.workspace.activeSheetId,
  );
  const openSheetIds = useAppStore(
    useShallow((s) =>
      s.workspace.sheets.filter((sh) => sh.open).map((sh) => sh.sheetId),
    ),
  );
  const {
    handleExportWorkspace,
    handleImportWorkspace,
    handleImportFileChange,
    importFileInputRef,
  } = useWorkspaceTransfer();

  const actions = useMemo<GlobalShortcutActions>(() => {
    /** 在「打开的表」顺序中循环切换活动表（Ctrl+[ / Ctrl+]）。 */
    const cycleSheet = (delta: 1 | -1): void => {
      if (openSheetIds.length === 0 || activeSheetId === null) return;
      const currentIndex = openSheetIds.indexOf(activeSheetId);
      const next =
        openSheetIds[
          (currentIndex + delta + openSheetIds.length) % openSheetIds.length
        ];
      if (next !== undefined) {
        setActiveSheetId(next);
      }
    };
    return {
      openSettings: () => setSettingsOpen(true),
      toggleConnect: () => {
        if (connectionState === "connected") {
          void host?.disconnect();
        } else {
          setConnectionModalOpen(true);
        }
      },
      openHelp: onOpenHelp,
      openHelpQuestion: onOpenHelp,
      prevSheet: () => cycleSheet(-1),
      nextSheet: () => cycleSheet(1),
      newSheet: () => addSheet(),
      closeSheet: () => {
        // 仅关闭「当前打开」的表（非破坏性：表仍保留在侧边栏，可重新打开）。
        if (activeSheetId !== null && openSheetIds.includes(activeSheetId)) {
          closeSheet(activeSheetId);
        }
      },
      exportWorkspace: handleExportWorkspace,
      importWorkspace: handleImportWorkspace,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
      focusCommLog: () =>
        setPanelLayout({
          activeBottomTab: "commlog",
          bottomPanelCollapsed: false,
        }),
    };
  }, [
    openSheetIds,
    activeSheetId,
    connectionState,
    host,
    setSettingsOpen,
    setConnectionModalOpen,
    onOpenHelp,
    addSheet,
    closeSheet,
    setActiveSheetId,
    setTheme,
    theme,
    setPanelLayout,
    handleExportWorkspace,
    handleImportWorkspace,
  ]);

  useGlobalShortcuts(actions);

  return (
    <input
      ref={importFileInputRef}
      type="file"
      accept=".json,application/json"
      style={{ display: "none" }}
      onChange={handleImportFileChange}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
