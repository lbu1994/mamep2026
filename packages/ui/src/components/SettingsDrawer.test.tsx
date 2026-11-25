/**
 * Settings 抽屉单测（jsdom 插件管理并入）。
 * 覆盖：
 * - 页签结构：`General` / `Plugins` 两个页签，默认停在 `General`（既有设置项可见）；
 * - `Plugins` 页签内渲染插件管理区块（`PluginManagerSection`：插件列表 + Install Plugin）；
 * - 插件 settings 贡献分区归属 `Plugins` 页签，无贡献时不渲染。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import {
  createEmptyWorkspace,
  defaultConfig,
  ok,
  createMamepError,
  fail,
} from "@mamep2026/domain";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import type { AppHost } from "../host";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { FieldPerformanceSettings } from "../local-performance-settings";
import { SettingsDrawer } from "./SettingsDrawer";
import { makeHost as makeCompleteHost } from "../test/make-app-host";

/** 带贡献点注册表的 PluginRegistry（贡献聚合需要，与 App 装配一致）。 */
function makeRegistry(): PluginRegistry {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

/** 点击页签（按可见文本匹配，避免与页签内正文重名）。 */
function clickTab(name: string): void {
  const tab = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-tabs-tab"),
  ).find((el) => el.textContent?.trim() === name);
  expect(tab).toBeTruthy();
  fireEvent.click(tab as HTMLElement);
}

/** 注入 host 桩：能力矩阵 + 插件注册表（WorkspaceFileActions 仅在点击时才调用 host 方法）。 */
function makeHost(registry: PluginRegistry | null): AppHost {
  return {
    capabilities: {
      modbusRtu: true,
      modbusTcp: false,
      serialPorts: "browser-picker",
      filesystem: "limited",
      nodePlugins: false,
      webPlugins: true,
      logExport: "download",
      workspaceImport: "upload",
      workspaceExport: "download",
      pluginInstall: "upload",
      executablePlugins: false,
      hostPlugins: false,
      protocolExtensions: [],
      tableTypes: ["holding-register"],
    },
    pluginRegistry: registry,
    startPlugins: vi.fn(async () => undefined),
    restoreAllBundledPlugins: vi.fn(async () => undefined),
    resolveAddressTransform: vi.fn(() => null),
  } as unknown as AppHost;
}

function renderDrawer(
  registry: PluginRegistry | null,
  performanceSettings?: FieldPerformanceSettings,
): void {
  const host = makeHost(registry);
  useAppStore.setState({ host, settingsModalOpen: true });
  render(
    <AntApp>
      <SettingsDrawer host={host} performanceSettings={performanceSettings} />
    </AntApp>,
  );
}

function performanceSettings(): FieldPerformanceSettings {
  return {
    enabled: false,
    cacheMode: "cold",
    zoomPercent: 100,
    networkProfile: "local",
    sessionCount: 2,
    setEnabled: vi.fn(),
    setCacheMode: vi.fn(),
    setZoomPercent: vi.fn(),
    setNetworkProfile: vi.fn(),
    exportReport: vi.fn(),
    clearSessions: vi.fn(),
  };
}

describe("SettingsDrawer workspace reset", () => {
  beforeEach(() => {
    initI18n();
    const store = useAppStore.getState();
    store.setWorkspace(createEmptyWorkspace());
    store.addSheet("vendor:registers");
    store.addSheet();
    store.undo();
    useAppStore.setState({
      settingsModalOpen: true,
      loaded: true,
      messages: [],
    });
  });

  it("publishes four empty core types once and clears history after reset succeeds", async () => {
    const { host } = makeCompleteHost();
    const fresh = createEmptyWorkspace();
    host.resetWorkspace = vi.fn(async () => ok(fresh));
    const previousIds = useAppStore
      .getState()
      .workspace.sheets.map((sheet) => sheet.sheetId);
    render(
      <AntApp>
        <SettingsDrawer host={host} />
      </AntApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Workspace" }));
    expect(host.resetWorkspace).not.toHaveBeenCalled();
    const updates: number[] = [];
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.workspace !== previous.workspace)
        updates.push(state.workspace.sheets.length);
    });
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Reset$/ }));
      await waitFor(() =>
        expect(useAppStore.getState().messages.at(-1)?.messageKey).toBe(
          "messages.workspaceReset",
        ),
      );
    } finally {
      unsubscribe();
    }
    const state = useAppStore.getState();
    expect(host.resetWorkspace).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([4]);
    expect(state.workspace.sheets.map((sheet) => sheet.type)).toEqual([
      "holding-register",
      "coil",
      "discrete-input",
      "input-register",
    ]);
    expect(state.workspace.sheets.map((sheet) => sheet.name)).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "COILS Sheet 1",
      "DISCRETE INPUTS Sheet 1",
      "INPUT REGISTERS Sheet 1",
    ]);
    for (const sheet of state.workspace.sheets) {
      expect(previousIds).not.toContain(sheet.sheetId);
      expect(sheet.rows).toHaveLength(
        defaultConfig.registerTable.defaultRowCount,
      );
      expect(
        sheet.rows.every(
          (row) =>
            row.name === "" &&
            row.cellText === "" &&
            !row.pollingEnabled &&
            !row.traceEnabled,
        ),
      ).toBe(true);
    }
    expect(state.workspace.activeSheetId).toBe(fresh.activeSheetId);
    expect(state.activeSheetId).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.loaded).toBe(true);
    expect(host.connect).not.toHaveBeenCalled();
    expect(host.connectTcp).not.toHaveBeenCalled();
  });

  it("preserves the workspace and history when the host rejects reset", async () => {
    const { host } = makeCompleteHost();
    host.resetWorkspace = vi.fn(async () =>
      fail(
        createMamepError({
          code: "WORKSPACE_RESET_FAILED",
          category: "persistence",
          userMessageKey: "messages.resetFailed",
          technicalMessage: "Reset failed.",
        }),
      ),
    );
    const before = useAppStore.getState();
    render(
      <AntApp>
        <SettingsDrawer host={host} />
      </AntApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Workspace" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Reset$/ }));
    await waitFor(() =>
      expect(useAppStore.getState().messages.at(-1)?.messageKey).toBe(
        "messages.resetFailed",
      ),
    );
    const after = useAppStore.getState();
    expect(after.workspace).toBe(before.workspace);
    expect(after.activeSheetId).toBe(before.activeSheetId);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
  });
});

describe("SettingsDrawer（2026-09-12 插件管理并入）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      settingsModalOpen: false,
      workspace: useAppStore.getState().workspace,
    });
  });

  it.each([
    ["en-US", "Language"],
    ["zh-CN", "语言"],
  ] as const)(
    "labels the language selector correctly in %s",
    (language, label) => {
      initI18n(language);
      renderDrawer(null);
      const selector = screen.getByRole("combobox", { name: label });
      expect(
        selector.closest('[data-testid="settings-language-select"]'),
      ).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByText("Mamep2026", { exact: true })).toBeNull();
    },
  );

  it("渲染 General / Plugins 两个页签，默认停在 General", () => {
    renderDrawer(null);
    expect(screen.getByRole("tab", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Plugins" })).toBeTruthy();
    // 默认页签内容（既有设置项）：主题 / 主题色 / 语言 / 重置工作区 / 工作区导入导出。
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Accent color")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Reset Workspace/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Export Workspace/i }),
    ).toBeTruthy();
    // 未切页签前插件管理区块不渲染（antd Tabs 面板按需挂载）。
    expect(screen.queryByTestId("plugin-manager")).toBeNull();
  });

  it("切到 Plugins 页签显示插件管理区块（插件列表 + Install Plugin）", async () => {
    const registry = makeRegistry();
    registry.register({
      id: "example-panel",
      name: "Example Panel",
      version: "1.0.0",
      apiVersion: "2.0",
      description: "A built-in UI-safe example plugin.",
      author: "Mamep2026 Team",
      platform: { web: true, node: false },
      permissions: ["ui-contribution"],
      contributes: { panels: [] },
    });
    renderDrawer(registry);

    clickTab("Plugins");
    expect(await screen.findByTestId("plugin-manager")).toBeTruthy();
    expect(screen.getByText("Example Panel")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Install Plugin/i }),
    ).toBeTruthy();
  });

  it("插件 settings 贡献分区渲染在 Plugins 页签", async () => {
    const registry = makeRegistry();
    registry.register({
      id: "with-settings",
      name: "With Settings",
      version: "1.0.0",
      apiVersion: "2.0",
      description: "Contributes a settings section.",
      platform: { web: true, node: false },
      permissions: ["ui-contribution"],
      contributes: {
        settings: { id: "with-settings.section", titleKey: "plugins.author" },
      },
    });
    renderDrawer(registry);

    clickTab("Plugins");
    const section = await screen.findByTestId("plugin-settings");
    // 贡献标题经 i18n 解析 + 占位说明（声明式标题）。
    expect(section.textContent).toContain("Author");
    expect(section.textContent).toContain(
      "Plugin settings will be provided by the plugin runtime.",
    );
  });

  it("无 settings 贡献时不渲染插件 settings 分区", async () => {
    renderDrawer(makeRegistry());
    clickTab("Plugins");
    expect(await screen.findByTestId("plugin-manager")).toBeTruthy();
    expect(screen.queryByTestId("plugin-settings")).toBeNull();
  });

  it("仅在浏览器组合根注入时显示本地性能采样，并可切换与导出", () => {
    const settings = performanceSettings();
    renderDrawer(null, settings);

    const section = screen.getByTestId("local-performance-settings");
    expect(section.textContent).toContain("Local performance sampling");
    expect(section.textContent).toContain("never uploads");
    expect(section.textContent).toContain("Local / loopback");

    fireEvent.click(
      screen.getByRole("switch", { name: "Collect performance data" }),
    );
    expect(settings.setEnabled).toHaveBeenCalledTimes(1);
    expect(vi.mocked(settings.setEnabled).mock.calls[0]?.[0]).toBe(true);

    fireEvent.click(screen.getByText("Warm"));
    expect(settings.setCacheMode).toHaveBeenCalledWith("warm");

    fireEvent.click(
      screen.getByRole("button", { name: "Export local report" }),
    );
    expect(settings.exportReport).toHaveBeenCalledTimes(1);
  });

  it("未注入本地性能采样契约时不渲染采集开关", () => {
    renderDrawer(null);
    expect(screen.queryByTestId("local-performance-settings")).toBeNull();
  });
});
