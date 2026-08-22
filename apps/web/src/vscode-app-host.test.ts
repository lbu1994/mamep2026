/**
 * VscodeAppHost 单测（VSCode 端骨架，2026-08-23）：能力矩阵如实声明（RTU/TCP/串口/文件
 * 均未支持）、主题初始化与 color-theme-changed 事件映射共享 store、剪贴板透传 VSCode 桥、
 * 工作区经注入仓储委托 inner（BrowserAppHost）、连接不虚报成功。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type {
  MamepHostEvent,
  VscodeHostApi,
  VscodeHostDebugState,
} from "@mamep2026/platform-api";
import { vscodeCapabilities } from "@mamep2026/platform-api";
import { InMemoryWorkspaceRepository } from "@mamep2026/test-kit";
import { useAppStore } from "@mamep2026/ui";
import { VscodeAppHost } from "./vscode-app-host";

function createFakeBridge(): {
  bridge: VscodeHostApi;
  emit: (event: MamepHostEvent) => void;
  copyCalls: string[];
} {
  const listeners = new Set<(event: MamepHostEvent) => void>();
  const copyCalls: string[] = [];
  const bridge: VscodeHostApi = {
    platform: "vscode",
    getCapabilities: vi.fn(
      async (): Promise<Result<PlatformCapabilities>> => ({
        ok: true,
        value: vscodeCapabilities,
      }),
    ),
    getAppVersion: vi.fn(async (): Promise<Result<string>> => ({
      ok: true,
      value: "0.0.0-test",
    })),
    copyTextToClipboard: vi.fn(async (text: string): Promise<Result<void>> => {
      copyCalls.push(text);
      return { ok: true, value: undefined };
    }),
    readTextFromClipboard: vi.fn(
      async (): Promise<Result<string | null>> => ({ ok: true, value: null }),
    ),
    selectSerialPort: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    getColorTheme: vi.fn(
      async (): Promise<Result<"light" | "dark">> => ({
        ok: true,
        value: "dark",
      }),
    ),
    onEvent: vi.fn((listener: (event: MamepHostEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getDebugState: vi.fn(
      async (): Promise<Result<VscodeHostDebugState | null>> => ({
        ok: true,
        value: null,
      }),
    ),
  };
  return {
    bridge,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    copyCalls,
  };
}

function makeHost(bridge: VscodeHostApi): VscodeAppHost {
  return new VscodeAppHost(bridge, {
    repository: new InMemoryWorkspaceRepository(),
  });
}

describe("VscodeAppHost", () => {
  beforeEach(() => {
    // 重置共享 store 主题，避免跨测试污染。
    useAppStore.getState().setTheme("light");
  });

  it("能力矩阵如实声明（骨架：RTU/TCP/串口/文件均未支持）", () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    expect(host.capabilities).toBe(vscodeCapabilities);
    expect(host.capabilities.modbusRtu).toBe(false);
    expect(host.capabilities.modbusTcp).toBe(false);
    expect(host.capabilities.serialPorts).toBe("unsupported");
    expect(host.capabilities.filesystem).toBe("unsupported");
    expect(host.isMockMode).toBe(false);
  });

  it("构造时经 get-color-theme 初始化共享 store 主题", async () => {
    const { bridge } = createFakeBridge();
    makeHost(bridge);
    await vi.waitFor(() => {
      expect(useAppStore.getState().theme).toBe("dark");
    });
    expect(bridge.getColorTheme).toHaveBeenCalled();
  });

  it("color-theme-changed 事件更新共享 store 主题", async () => {
    const { bridge, emit } = createFakeBridge();
    makeHost(bridge);
    // 先等构造期 get-color-theme 完成（默认 dark），再验证事件路径。
    await vi.waitFor(() => {
      expect(useAppStore.getState().theme).toBe("dark");
    });
    emit({ kind: "color-theme-changed", payload: { theme: "light" } });
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("剪贴板透传 VSCode 桥", async () => {
    const { bridge, copyCalls } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.copyTextToClipboard("hello");
    expect(result.ok).toBe(true);
    expect(copyCalls).toEqual(["hello"]);
  });

  it("工作区经注入仓储委托 inner（loadWorkspace 走通）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.loadWorkspace();
    expect(result.ok).toBe(true);
  });

  it("连接不虚报成功（骨架未实现串口，能力缺失如实失败）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultRtuProfile();
    const connect = await host.connect(profile, null);
    expect(connect.ok).toBe(false);
  });
});
