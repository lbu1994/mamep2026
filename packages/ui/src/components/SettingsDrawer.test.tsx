/**
 * Settings 抽屉单测（jsdom，2026-09-12 插件管理并入）。
 * 覆盖：
 * - 页签结构：`General` / `Plugins` 两个页签，默认停在 `General`（既有设置项可见）；
 * - `Plugins` 页签内渲染插件管理区块（`PluginManagerSection`：插件列表 + Install Plugin）；
 * - 插件 settings 贡献分区（ADR-039）归属 `Plugins` 页签，无贡献时不渲染。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import type { AppHost } from "../host";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { SettingsDrawer } from "./SettingsDrawer";

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

function renderDrawer(registry: PluginRegistry | null): void {
  const host = makeHost(registry);
  useAppStore.setState({ host, settingsModalOpen: true });
  render(
    <AntApp>
      <SettingsDrawer host={host} />
    </AntApp>,
  );
}

describe("SettingsDrawer（2026-09-12 插件管理并入）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      settingsModalOpen: false,
      workspace: useAppStore.getState().workspace,
    });
  });

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

  it("切到 Plugins 页签显示插件管理区块（插件列表 + Install Plugin）", () => {
    const registry = makeRegistry();
    registry.register({
      id: "example-panel",
      name: "Example Panel",
      version: "1.0.0",
      apiVersion: "1.0",
      description: "A built-in UI-safe example plugin.",
      author: "Mamep2026 Team",
      platform: { web: true, node: false },
      permissions: ["ui-contribution"],
      contributes: { panels: [] },
    });
    renderDrawer(registry);

    clickTab("Plugins");
    expect(screen.getByTestId("plugin-manager")).toBeTruthy();
    expect(screen.getByText("Example Panel")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Install Plugin/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Restore bundled/i }),
    ).toBeTruthy();
  });

  it("插件 settings 贡献分区渲染在 Plugins 页签", () => {
    const registry = makeRegistry();
    registry.register({
      id: "with-settings",
      name: "With Settings",
      version: "1.0.0",
      apiVersion: "1.0",
      description: "Contributes a settings section.",
      platform: { web: true, node: false },
      permissions: ["ui-contribution"],
      contributes: {
        settings: { id: "with-settings.section", titleKey: "plugins.author" },
      },
    });
    renderDrawer(registry);

    clickTab("Plugins");
    const section = screen.getByTestId("plugin-settings");
    // 贡献标题经 i18n 解析 + 占位说明（Phase A 声明式标题）。
    expect(section.textContent).toContain("Author");
    expect(section.textContent).toContain(
      "Plugin settings will be provided by the plugin runtime.",
    );
  });

  it("无 settings 贡献时不渲染插件 settings 分区", () => {
    renderDrawer(makeRegistry());
    clickTab("Plugins");
    expect(screen.getByTestId("plugin-manager")).toBeTruthy();
    expect(screen.queryByTestId("plugin-settings")).toBeNull();
  });
});
