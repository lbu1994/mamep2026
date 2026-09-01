/**
 * 插件工具栏动作（Phase C 内置行为，ADR-041 决策③④）单测：
 * - 确定指令映射（enter-rom=0900H / enter-ram=0910H）与命令行构造；
 * - 执行前置：未连接提示、未知动作 no-op、写成功/失败消息；
 * - 写路径：writeVerify=off（不回读不刷新）。
 */
import { describe, expect, it, vi } from "vitest";
import { createMamepError, type RegisterRow } from "@mamep2026/domain";
import type { AppHost } from "./host";
import {
  buildCommandWriteRow,
  hasBuiltinCommandWrite,
  runPluginToolbarAction,
} from "./plugin-toolbar-actions";

function makeHost(overrides: {
  connectionState?: string;
  writeRowResult?: unknown;
}): {
  host: AppHost;
  writeRow: ReturnType<typeof vi.fn>;
  messages: Array<{ messageKey: string; level: string }>;
} {
  const messages: Array<{ messageKey: string; level: string }> = [];
  const writeRow = vi.fn(async () =>
    overrides.writeRowResult === undefined
      ? { ok: true as const, value: undefined }
      : overrides.writeRowResult,
  );
  const host = {
    getConnectionState: () => overrides.connectionState ?? "connected",
    writeRow,
  } as unknown as AppHost;
  return { host, writeRow, messages };
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

describe("hasBuiltinCommandWrite", () => {
  it("enter-rom / enter-ram 为内置确定指令", () => {
    expect(hasBuiltinCommandWrite("yaskawa.enter-rom")).toBe(true);
    expect(hasBuiltinCommandWrite("yaskawa.enter-ram")).toBe(true);
  });

  it("未知动作无内置行为", () => {
    expect(hasBuiltinCommandWrite("other.plugin-action")).toBe(false);
  });
});

describe("buildCommandWriteRow", () => {
  it("enter-rom → 0900H、enter-ram → 0910H，值 0，单寄存器", () => {
    const rom = buildCommandWriteRow("yaskawa.enter-rom");
    expect(rom?.addressValue?.value).toBe(0x0900);
    expect(rom?.registerValues?.map((v) => v.value)).toEqual([0]);
    expect(rom?.registerCount).toBe(1);
    expect(rom?.dataType).toBe("unsigned");

    const ram = buildCommandWriteRow("yaskawa.enter-ram");
    expect(ram?.addressValue?.value).toBe(0x0910);
    expect(ram?.registerValues?.map((v) => v.value)).toEqual([0]);
  });

  it("未知动作返回 null", () => {
    expect(buildCommandWriteRow("other.plugin-action")).toBeNull();
  });
});

describe("runPluginToolbarAction", () => {
  it("未连接：提示 notConnected，不写设备", async () => {
    const { host, writeRow, messages } = makeHost({ connectionState: "disconnected" });
    await runPluginToolbarAction(host, "yaskawa.enter-rom", appendDeps(messages));
    expect(writeRow).not.toHaveBeenCalled();
    expect(messages.at(-1)?.messageKey).toBe("errors.notConnected");
  });

  it("未知动作：no-op", async () => {
    const { host, writeRow, messages } = makeHost({});
    await runPluginToolbarAction(host, "other.plugin-action", appendDeps(messages));
    expect(writeRow).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("已连接 + enter-rom：写 0900H 值 0，writeVerify=off（不回读不刷新），成功提示", async () => {
    const { host, writeRow, messages } = makeHost({});
    await runPluginToolbarAction(host, "yaskawa.enter-rom", appendDeps(messages));
    expect(writeRow).toHaveBeenCalledTimes(1);
    const [row, options] = writeRow.mock.calls[0] as [RegisterRow, { writeVerify?: unknown }];
    expect(row.addressValue?.value).toBe(0x0900);
    expect(row.registerValues?.map((v) => v.value)).toEqual([0]);
    expect(options?.writeVerify).toEqual({ mode: "off", delayMs: null });
    expect(messages.at(-1)?.messageKey).toBe("messages.writeSucceeded");
  });

  it("写失败：提示 writeFailed 携带错误码", async () => {
    const { host, writeRow, messages } = makeHost({
      writeRowResult: {
        ok: false as const,
        error: createMamepError({
          code: "MODBUS_EXCEPTION",
          category: "modbus-exception",
          userMessageKey: "errors.modbusException",
          technicalMessage: "Slave returned exception code 3",
        }),
      },
    });
    await runPluginToolbarAction(host, "yaskawa.enter-ram", appendDeps(messages));
    expect(writeRow).toHaveBeenCalledTimes(1);
    expect(messages.at(-1)?.messageKey).toBe("messages.writeFailed");
    expect(messages.at(-1)?.level).toBe("error");
  });
});
