/**
 * 插件工具栏动作执行（2026-09-02 插件外部化）单测：
 * 执行经 PluginRegistry.invokeToolbarAction 委托插件同进程 runtime；
 * 前置：未连接提示；成功/失败消息；无路径硬编码厂商地址（已移入插件）。
 */
import { describe, expect, it, vi } from "vitest";
import { createMamepError } from "@mamep2026/domain";
import type { AppHost } from "./host";
import { runPluginToolbarAction } from "./plugin-toolbar-actions";

function makeHost(overrides: {
  connectionState?: string;
  invokeResult?: unknown;
}): {
  host: AppHost;
  invokeToolbarAction: ReturnType<typeof vi.fn>;
  messages: Array<{ messageKey: string; level: string }>;
} {
  const messages: Array<{ messageKey: string; level: string }> = [];
  const invokeToolbarAction = vi.fn(async () =>
    overrides.invokeResult === undefined
      ? { ok: true as const, value: undefined }
      : overrides.invokeResult,
  );
  const host = {
    getConnectionState: () => overrides.connectionState ?? "connected",
    pluginRegistry: { invokeToolbarAction },
  } as unknown as AppHost;
  return { host, invokeToolbarAction, messages };
}

function appendDeps(messages: Array<{ messageKey: string; level: string }>) {
  return {
    appendMessage: (message: {
      messageKey: string;
      level: string;
    }): void => {
      messages.push({ messageKey: message.messageKey, level: message.level });
    },
  };
}

describe("runPluginToolbarAction（2026-09-02 插件外部化）", () => {
  it("未连接：提示 notConnected，不调用插件", async () => {
    const { host, invokeToolbarAction, messages } = makeHost({
      connectionState: "disconnected",
    });
    await runPluginToolbarAction(
      host,
      "yaskawa-memobus-67h-010dh-010eh",
      "yaskawa.enter-rom",
      appendDeps(messages),
    );
    expect(invokeToolbarAction).not.toHaveBeenCalled();
    expect(messages.at(-1)?.messageKey).toBe("errors.notConnected");
  });

  it("已连接：委托 registry.invokeToolbarAction（pluginId + actionId），成功提示", async () => {
    const { host, invokeToolbarAction, messages } = makeHost({});
    await runPluginToolbarAction(
      host,
      "yaskawa-memobus-67h-010dh-010eh",
      "yaskawa.enter-rom",
      appendDeps(messages),
    );
    expect(invokeToolbarAction).toHaveBeenCalledWith(
      "yaskawa-memobus-67h-010dh-010eh",
      "yaskawa.enter-rom",
    );
    expect(messages.at(-1)?.messageKey).toBe("plugins.actionSucceeded");
  });

  it("插件执行失败：提示 writeFailed 携带错误码", async () => {
    const { host, messages } = makeHost({
      invokeResult: {
        ok: false as const,
        error: createMamepError({
          code: "MODBUS_EXCEPTION",
          category: "modbus-exception",
          userMessageKey: "errors.modbusException",
          technicalMessage: "Slave returned exception code 3",
        }),
      },
    });
    await runPluginToolbarAction(
      host,
      "yaskawa-memobus-67h-010dh-010eh",
      "yaskawa.enter-ram",
      appendDeps(messages),
    );
    expect(messages.at(-1)?.messageKey).toBe("messages.writeFailed");
    expect(messages.at(-1)?.level).toBe("error");
  });
});
