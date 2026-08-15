import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PluginRegistry } from "@mamep2026/plugin-api";
import type { AppHost } from "../host";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { PluginManagerModal } from "./PluginManagerModal";

function renderModal(): ReturnType<typeof render> {
  return render(<PluginManagerModal />);
}

/** 注入一个仅带 pluginRegistry 的最小 host 桩，并打开插件管理弹窗。 */
function setHostWithPlugin(registry: PluginRegistry): void {
  useAppStore.setState({
    host: { pluginRegistry: registry } as unknown as AppHost,
    pluginModalOpen: true,
  });
}

describe("PluginManagerModal", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: useAppStore.getState().workspace,
      pluginModalOpen: false,
    });
  });

  it("shows the empty state when no plugins are registered", () => {
    setHostWithPlugin(new PluginRegistry());
    renderModal();
    expect(screen.getByText("No built-in plugins registered.")).toBeTruthy();
  });

  it("renders author, platform capability and permission labels", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "example-panel",
      name: "Example Panel",
      version: "1.0.0",
      description: "A built-in UI-safe example plugin.",
      author: "Mamep2026 Team",
      platform: { web: true, node: false },
      permissions: ["ui.panel"],
      contributions: { panels: [] },
    });
    setHostWithPlugin(registry);
    renderModal();

    expect(screen.getByText("Author: Mamep2026 Team")).toBeTruthy();
    // 平台能力：Web/Node 双 Tag。
    expect(screen.getByText("Web", { exact: true })).toBeTruthy();
    expect(screen.getByText("Node", { exact: true })).toBeTruthy();
    // 权限：ui.panel → 人类可读标签。
    expect(screen.getByText("UI Panel")).toBeTruthy();
  });

  it("degrades gracefully when author and permissions are absent", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "minimal",
      name: "Minimal",
      version: "0.1.0",
      description: "No author, no permissions.",
      platform: { web: true, node: false },
      permissions: [],
      contributions: { panels: [] },
    });
    setHostWithPlugin(registry);
    renderModal();

    // 作者缺失 → 占位符「—」。
    expect(screen.getByText("Author: —")).toBeTruthy();
    // 权限为空 → 不渲染权限区。
    expect(screen.queryByText(/Permissions/)).toBeNull();
    // 平台 Tag 仍渲染。
    expect(screen.getByText("Web", { exact: true })).toBeTruthy();
  });
});
