/**
 * 安川 MEMOBUS 插件（**用户手动安装**的单文件插件）。
 * manifest 声明式贡献（protocolExtension / tableType / toolbarAction / command / documentation）；
 * 单文件 entry 导出 `manifest` + `activate(ctx)` + `handleToolbarAction(actionId, ctx)`，由平台侧
 * 同进程加载器加载（安装时用户需在确认框中显式授权「同进程执行」）：
 * - `activate` 经 `ctx.registries.codec` 注册 MemobusCodec；
 * - `handleToolbarAction` 提供 ROM/RAM 确定指令执行面（经 PluginCommunicationApi 写 0 到
 *   0900H/0910H，走统一调度器，厂商地址不硬编码核心——docs/AGENTS.md §24.4）。
 * 厂商专用功能码（67/010D、67/010E）全部在本插件内，软件仅提供调用接口（决策 B）。
 */
import { ok, type Result } from "@mamep2026/domain";
import {
  PLUGIN_API_VERSION,
  type PluginContext,
  type PluginManifest,
} from "@mamep2026/plugin-api";
import { MemobusCodec } from "./memobus-codec";

export const YASKAWA_MEMOBUS_PLUGIN_ID = "yaskawa-memobus-67h-010dh-010eh";
export const YASKAWA_MEMOBUS_PROTOCOL_ID = "yaskawa-memobus-67h-010dh-010eh";
/** 安川表类型（sheet.type）：<pluginId>:<tableTypeId>（tableTypeId 复用核心 holding-register）。 */
export const YASKAWA_MEMOBUS_TABLE_TYPE =
  "yaskawa-memobus-67h-010dh-010eh:holding-register";
/** ROM/RAM 确定指令寄存器（安川 GA500 手册）：0900H=写入 EEPROM（ROM），0910H=仅更新 RAM；写入值 0 触发。 */
export const YASKAWA_COMMAND_REGISTER: Readonly<Record<string, number>> = {
  "yaskawa.enter-rom": 0x0900,
  "yaskawa.enter-ram": 0x0910,
};

export const yaskawaMemobusManifest: PluginManifest = {
  id: YASKAWA_MEMOBUS_PLUGIN_ID,
  name: "Yaskawa MEMOBUS",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  description:
    "Yaskawa MEMOBUS non-continuous read/write (67H 010DH/010EH) example protocol extension plugin.",
  author: "Mamep2026 Team",
  license: "MIT",
  platform: { web: true, node: true },
  requiredCapabilities: ["modbus-rtu"],
  permissions: ["communication", "device-write", "ui-contribution"],
  contributes: {
    protocolExtension: {
      protocolId: YASKAWA_MEMOBUS_PROTOCOL_ID,
      titleKey: "plugins.yaskawaMemobusTitle",
    },
    tableType: {
      id: "holding-register",
      protocolId: YASKAWA_MEMOBUS_PROTOCOL_ID,
      titleKey: "plugins.yaskawaTableTypeTitle",
    },
    toolbarAction: [
      {
        id: "yaskawa.enter-rom",
        titleKey: "table.enterRom",
        icon: "SaveOutlined",
        scope: "table-toolbar",
        targetTableType: "holding-register",
        requiresConfirm: true,
        // 确认文案 i18n key（插件外部化：确认弹窗文案由插件贡献声明）。
        confirmKey: "table.enterRomConfirm",
      },
      {
        id: "yaskawa.enter-ram",
        titleKey: "table.enterRam",
        icon: "SaveOutlined",
        scope: "table-toolbar",
        targetTableType: "holding-register",
        requiresConfirm: true,
        confirmKey: "table.enterRamConfirm",
      },
    ],
    command: [
      { id: "yaskawa.enter-rom", titleKey: "table.enterRom" },
      { id: "yaskawa.enter-ram", titleKey: "table.enterRam" },
    ],
    // 寄存器手册：documentation 贡献点，Help 弹窗轻量渲染。
    documentation: {
      id: "yaskawa.register-manual",
      titleKey: "plugins.yaskawaManualTitle",
      markdown: [
        "# Yaskawa MEMOBUS 67H/010DH/010EH",
        "",
        "非连续读写：一次请求可读写任意不连续的保持寄存器（本表仍按连续行模型使用）。",
        "",
        "## 功能码",
        "",
        "- `67H 010DH`：非连续读（数量 1~120）",
        "- `67H 010EH`：非连续写（数量 1~60）",
        "",
        "## 读请求帧",
        "",
        "```",
        "从站 + 67H + 01H + 0DH + 个数(2) + 寄存器编号×N + CRC-16",
        "```",
        "",
        "## 写请求帧",
        "",
        "```",
        "从站 + 67H + 01H + 0EH + 个数(2) + 字节数(2) + (编号+数据)×N + CRC-16",
        "```",
        "",
        "## 异常响应",
        "",
        "从站 + `E7H` + 错误代码 + CRC-16。常见错误码：`02` 非法数据地址、`03` 数量超限（读 >120 / 写 >60）。",
        "",
        "## 说明",
        "",
        "本插件仅为协议扩展示例，寄存器地址分配请查阅对应驱动器的 MEMOBUS 手册。",
      ].join("\n"),
    },
  },
};

/**
 * 单文件 entry 导出：安装时同进程加载器 import 本模块，从 entry
 * 提取 manifest 并调用 `activate`；工具栏动作由 entry 的 `handleToolbarAction` 处理。
 */
export const manifest: PluginManifest = yaskawaMemobusManifest;

export function activate(ctx: PluginContext): void {
  ctx.registries.codec.register(new MemobusCodec());
}

/** ROM/RAM 确定指令（决策③④：值 0、不回读、不触发轮询刷新）。 */
export function handleToolbarAction(
  actionId: string,
  ctx: PluginContext,
): Result<void> | Promise<Result<void>> | void {
  const address = YASKAWA_COMMAND_REGISTER[actionId];
  if (address === undefined) {
    return ok(undefined);
  }
  return ctx.communication.writeRegisters({ address, values: [0] });
}
