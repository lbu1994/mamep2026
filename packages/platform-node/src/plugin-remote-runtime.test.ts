/**
 * NodePluginRemoteRuntime 集成测试。
 * 真实 worker_threads 端到端：entry（data URL ESM）加载/激活/通信桥/停用/关闭。
 */
import { describe, expect, it, vi } from "vitest";
import { NodePluginRemoteRuntime } from "./plugin-remote-runtime";

/** 单文件 JS 插件 entry（ESM 导出 manifest/activate/deactivate）。 */
const ENTRY = `
export const manifest = {
  id: "node-exec",
  name: "Node Exec",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "Executes in a worker_thread.",
  platform: { web: false, node: true },
  permissions: ["communication"],
  contributes: {},
};
export async function activate(ctx) {
  globalThis.__readResult = await ctx.communication.readRegisters({ address: 0x100, quantity: 2 });
  globalThis.__writeResult = await ctx.communication.writeRegisters({ address: 0x200, values: [1, 2] });
}
export function deactivate() {
  globalThis.__deactivated = true;
}
`;

function makeApi() {
  return {
    readRegisters: vi.fn(async () => ({
      ok: true as const,
      value: [0xaa, 0xbb],
    })),
    writeRegisters: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
  };
}

function makeFactory(api: ReturnType<typeof makeApi>) {
  return () => api;
}

describe("NodePluginRemoteRuntime（ADR-044 Phase F-2）", () => {
  it("load：worker_threads 内 import entry 提取 manifest", async () => {
    const runtime = new NodePluginRemoteRuntime(ENTRY, makeFactory(makeApi()));
    const result = await runtime.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("node-exec");
      expect(result.value.platform.node).toBe(true);
    }
    await runtime.dispose();
  });

  it("activate：执行 entry activate；通信桥经注入 API 往返", async () => {
    const api = makeApi();
    const runtime = new NodePluginRemoteRuntime(ENTRY, makeFactory(api));
    expect((await runtime.load()).ok).toBe(true);

    await runtime.activate({
      pluginId: "node-exec",
      communication: api,
    });
    expect(api.readRegisters).toHaveBeenCalledWith({
      address: 0x100,
      quantity: 2,
    });
    expect(api.writeRegisters).toHaveBeenCalledWith({
      address: 0x200,
      values: [1, 2],
    });
    await runtime.dispose();
  });

  it("activate 失败（entry 抛错）→ reject（PLUGIN_HOOK_FAILED 隔离由 registry 承接）", async () => {
    const badEntry = `
      export const manifest = { id: "bad", name: "Bad", version: "1.0.0", apiVersion: "2.0", platform: { web: false, node: true }, permissions: [], contributes: {} };
      export function activate() { throw new Error("activate boom"); }
    `;
    const runtime = new NodePluginRemoteRuntime(
      badEntry,
      makeFactory(makeApi()),
    );
    expect((await runtime.load()).ok).toBe(true);
    await expect(
      runtime.activate({ pluginId: "bad", communication: makeApi() }),
    ).rejects.toThrow("activate boom");
    await runtime.dispose();
  });

  it("entry 缺 manifest → load 返回 PLUGIN_LOAD_FAILED", async () => {
    const badEntry = `export const x = 1;`;
    const runtime = new NodePluginRemoteRuntime(
      badEntry,
      makeFactory(makeApi()),
    );
    const result = await runtime.load();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_LOAD_FAILED");
  });

  it("deactivate + dispose：关闭线程", async () => {
    const runtime = new NodePluginRemoteRuntime(ENTRY, makeFactory(makeApi()));
    expect((await runtime.load()).ok).toBe(true);
    await runtime.activate({ pluginId: "node-exec", communication: makeApi() });
    await runtime.deactivate();
    await runtime.dispose();
    // dispose 后 load 报错。
    const again = await runtime.load();
    expect(again.ok).toBe(false);
  });
});
