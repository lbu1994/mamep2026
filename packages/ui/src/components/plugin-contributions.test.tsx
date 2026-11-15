/**
 * panels 贡献点消费方单测（jsdom）。
 * 覆盖：插件自带翻译 `title` 优先；无 `title` 时回退应用 i18n `titleKey`；
 * 面板占位内容渲染；`host` 为空时不渲染。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PLUGIN_API_VERSION,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import type { AppHost } from "../host";
import { initI18n } from "../i18n";
import { PluginPanels } from "./plugin-contributions";

/** 带贡献点注册表的 PluginRegistry（贡献聚合需要，与 App 装配一致）。 */
function makeRegistry(): PluginRegistry {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

/** 最小 AppHost 桩（PluginPanels 只读 pluginRegistry）。 */
function makeHost(registry: PluginRegistry | null): AppHost {
  return { pluginRegistry: registry } as unknown as AppHost;
}

function registerExamplePanel(
  registry: PluginRegistry,
  panels: unknown[],
): void {
  registry.register({
    id: "example-panel",
    name: "Example Panel",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    description: "Declarative panel example.",
    author: "Mamep2026 Team",
    platform: { web: true, node: false },
    requiredCapabilities: [],
    permissions: ["ui-contribution"],
    contributes: { panels },
  });
}

describe("PluginPanels（panels 贡献点消费方，2026-09-12）", () => {
  beforeEach(() => {
    initI18n();
  });

  it("渲染插件自带翻译的标题 + 占位内容", () => {
    const registry = makeRegistry();
    registerExamplePanel(registry, [
      {
        id: "overview",
        titleKey: "plugins.examplePanelTitle",
        title: { "en-US": "From plugin", "zh-CN": "来自插件" },
      },
    ]);

    render(
      <AntApp>
        <PluginPanels host={makeHost(registry)} />
      </AntApp>,
    );

    expect(screen.getByTestId("plugin-panels")).toBeTruthy();
    // 插件自带翻译优先于应用 i18n 的 titleKey（方案 A）。
    expect(screen.getByText("From plugin")).toBeTruthy();
    expect(screen.queryByText("Example Panel")).toBeNull();
    expect(
      screen.getByText(
        "Plugin panel content will be provided by the plugin runtime.",
      ),
    ).toBeTruthy();
  });

  it("无 title 时回退应用 i18n 的 titleKey", () => {
    const registry = makeRegistry();
    registerExamplePanel(registry, [
      { id: "no-title", titleKey: "plugins.examplePanelTitle" },
    ]);

    render(
      <AntApp>
        <PluginPanels host={makeHost(registry)} />
      </AntApp>,
    );

    // titleKey 命中应用 i18n（en-US 兜底文案）。
    expect(screen.getByText("Example Panel")).toBeTruthy();
  });

  it("host 为空时返回 null（不渲染面板容器）", () => {
    const { container } = render(
      <AntApp>
        <PluginPanels host={null} />
      </AntApp>,
    );
    expect(container.querySelector('[data-testid="plugin-panels"]')).toBeNull();
  });
});
