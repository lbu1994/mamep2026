/**
 * loadNodePluginEntry 单测（ADR-055，2026-09-12）：宿主同进程加载单文件 JS 插件 entry。
 * 真实 `import(data:text/javascript;base64,...)`（与生产同路径）。
 */
import { describe, expect, it } from "vitest";
import {
  createUnavailableCommunicationApi,
  createUnavailableSyncRegistries,
} from "@mamep2026/plugin-api";

import { loadNodePluginEntry } from "./plugin-local-runtime";

const ENTRY = `
export const manifest = {
  id: "test-entry",
  name: "Test Entry",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "test",
  platform: { web: true, node: true },
  permissions: [],
  contributes: {},
};
export function activate(ctx) {
  globalThis.__nodeEntryActivated = (globalThis.__nodeEntryActivated || 0) + 1;
  globalThis.__nodeEntryManifest = manifest;
}
export function deactivate() {
  globalThis.__nodeEntryDeactivated = true;
}
export function handleToolbarAction(actionId) {
  globalThis.__nodeEntryAction = actionId;
}
`;

describe("loadNodePluginEntry（ADR-055）", () => {
  it("加载合法 entry：暴露 manifest 与 activate / deactivate / handleToolbarAction", async () => {
    const result = await loadNodePluginEntry(ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifest).toMatchObject({ id: "test-entry" });
    expect(typeof result.value.activate).toBe("function");
    expect(typeof result.value.deactivate).toBe("function");
    expect(typeof result.value.handleToolbarAction).toBe("function");
  });

  it("activate / deactivate / handleToolbarAction 绑定 entry 模块（可访问模块内状态）", async () => {
    const result = await loadNodePluginEntry(ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.__nodeEntryActivated = undefined;
    scope.__nodeEntryDeactivated = undefined;
    scope.__nodeEntryAction = undefined;

    await result.value.activate({
      pluginId: "test-entry",
      communication: createUnavailableCommunicationApi(),
      registries: createUnavailableSyncRegistries(),
    });
    result.value.deactivate?.();
    result.value.handleToolbarAction?.("do-it", {
      pluginId: "test-entry",
      communication: createUnavailableCommunicationApi(),
      registries: createUnavailableSyncRegistries(),
    });

    expect(scope.__nodeEntryActivated).toBe(1);
    expect(scope.__nodeEntryManifest).toMatchObject({ id: "test-entry" });
    expect(scope.__nodeEntryDeactivated).toBe(true);
    expect(scope.__nodeEntryAction).toBe("do-it");
  });

  it("缺 activate → PLUGIN_LOAD_FAILED（结构化收窄拒绝）", async () => {
    const result = await loadNodePluginEntry(
      `export const manifest = { id: "no-activate" };`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLUGIN_LOAD_FAILED");
    expect(result.error.userMessageKey).toBe("errors.pluginLoadFailed");
  });

  it("缺 manifest → PLUGIN_LOAD_FAILED", async () => {
    const result = await loadNodePluginEntry(`export function activate() {}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLUGIN_LOAD_FAILED");
  });

  it("语法错误 → PLUGIN_LOAD_FAILED（不抛出，错误隔离）", async () => {
    const result = await loadNodePluginEntry("export const manifest = {;");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PLUGIN_LOAD_FAILED");
    expect(result.error.technicalMessage.length).toBeGreaterThan(0);
  });
});
