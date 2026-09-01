/**
 * 插件工具栏动作的 Phase C 内置行为（ADR-041，决策③④）。
 * Phase A 的 toolbarAction 是声明式占位；Phase C 为安川插件的 ROM/RAM 确定指令
 * （enter-rom / enter-ram）提供真实执行：写 0 到 0900H/0910H，不回读、不触发轮询刷新。
 * 其余未知动作 id 无内置行为（返回 null），保持 Phase A 占位语义，待 Phase F 插件 runtime。
 * 纯函数式（依赖经 deps 注入），便于单测。
 */
import type {
  ApplicationMessage,
} from "@mamep2026/logging";
import {
  RawRegisterValue,
  RegisterAddress,
  type RegisterRow,
  type RowId,
} from "@mamep2026/domain";
import type { AppHost } from "./host";

/**
 * 插件工具栏动作 → 命令寄存器地址（Phase C 内置映射）。
 * 安川 GA500 手册（docs/安川MEMOBUS公开协议参考.md）：0900H=写入 EEPROM（ROM）确定指令，
 * 0910H=仅更新 RAM 确定指令；写入值 0 即触发。
 */
const COMMAND_REGISTER: Readonly<Record<string, number>> = {
  "yaskawa.enter-rom": 0x0900,
  "yaskawa.enter-ram": 0x0910,
};

/** 动作 id 是否内置命令写（Phase C 可执行集合）。 */
export function hasBuiltinCommandWrite(actionId: string): boolean {
  return actionId in COMMAND_REGISTER;
}

/** 构造确定指令写行（0900H/0910H，值 0）：经 host.writeRow 走当前会话（协议由活动表类型决定）。 */
export function buildCommandWriteRow(actionId: string): RegisterRow | null {
  const address = COMMAND_REGISTER[actionId];
  if (address === undefined) return null;
  // 受控工厂创建（docs/AGENTS.md §9.2、§16.1）：地址/值须经 create 校验。
  const addressResult = RegisterAddress.create(address);
  if (!addressResult.ok) return null;
  const valueResult = RawRegisterValue.create(0);
  if (!valueResult.ok) return null;
  const now = Date.now();
  return {
    rowId: `plugin-cmd-${actionId}` as RowId,
    order: 0,
    name: "",
    comment: "",
    addressDraft: address.toString(16).toUpperCase(),
    addressValue: addressResult.value,
    registerCount: 1,
    dataType: "unsigned",
    pollingEnabled: false,
    traceEnabled: false,
    cellText: "0",
    registerValues: [valueResult.value],
    registers: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface PluginToolbarActionDeps {
  appendMessage: (message: ApplicationMessage) => void;
}

/**
 * 执行 Phase C 内置工具栏动作（当前仅确定指令写）。
 * 前置：已连接（否则提示）；构造命令行 → writeRow（writeVerify off：不回读不刷新）。
 */
export async function runPluginToolbarAction(
  host: AppHost,
  actionId: string,
  deps: PluginToolbarActionDeps,
): Promise<void> {
  if (!hasBuiltinCommandWrite(actionId)) return;
  if (host.getConnectionState() !== "connected") {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "warning",
      messageKey: "errors.notConnected",
      params: {},
      detail: null,
    });
    return;
  }
  const row = buildCommandWriteRow(actionId);
  if (row === null) return;
  const result = await host.writeRow(row, {
    writeVerify: { mode: "off", delayMs: null },
  });
  if (result.ok) {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "info",
      messageKey: "messages.writeSucceeded",
      params: { address: row.addressDraft },
      detail: null,
    });
  } else {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "error",
      messageKey: "messages.writeFailed",
      params: { detail: result.error.code },
      detail: result.error.code,
    });
  }
}
