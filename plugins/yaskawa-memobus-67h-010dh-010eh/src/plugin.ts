/**
 * 安川 MEMOBUS 插件（ADR-041 插件 Phase C，决策 ①1A / ⑤；2026-09-02 插件外部化）。
 * 随应用分发（installed 来源 + 同进程 runtime）：manifest 声明式贡献（protocolExtension /
 * tableType / toolbarAction / command / documentation），runtime.activate 时把 MemobusCodec
 * 注册进会话 CodecRegistry；ROM/RAM 确定指令（enter-rom/enter-ram）执行面一并移入插件
 * （handleToolbarAction 经 PluginCommunicationApi 写 0 到 0900H/0910H，走统一调度器，
 * 厂商地址不再硬编码核心——docs/AGENTS.md §24.4）。
 * 厂商专用功能码（67/010D、67/010E）全部在本插件内，软件仅提供调用接口（决策 B）。
 */
import type { CodecRegistry } from "@mamep2026/communication";
import { ok, type Result } from "@mamep2026/domain";
import {
  PLUGIN_API_VERSION,
  type PluginContext,
  type PluginManifest,
  type PluginRegistry,
  type PluginRuntime,
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
        // 确认文案 i18n key（2026-09-02 插件外部化：确认弹窗文案由插件贡献声明）。
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
    // 寄存器手册（ADR-043 E-5）：documentation 贡献点，Help 弹窗轻量渲染。
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
 * 构造安川插件运行时（installed 来源同进程 runtime）：activate 时把 MemobusCodec 注册进
 * 会话 CodecRegistry（软件只提供调用接口）；handleToolbarAction 提供 ROM/RAM 确定指令执行
 * （2026-09-02 插件外部化：自 packages/ui plugin-toolbar-actions 移入，经通信面写 0900H/0910H）。
 * （装配层在首次安装与重启恢复时复用同一工厂。）
 */
export function createYaskawaRuntime(options: {
  codecRegistry: CodecRegistry;
}): PluginRuntime {
  return {
    activate() {
      options.codecRegistry.register(new MemobusCodec());
    },
    handleToolbarAction(actionId: string, ctx: PluginContext) {
      const address = YASKAWA_COMMAND_REGISTER[actionId];
      if (address === undefined) {
        return ok(undefined);
      }
      // 确定指令写：值 0、不回读不触发轮询刷新（Phase C 决策③④，语义由插件自身承担）。
      return ctx.communication.writeRegisters({ address, values: [0] });
    },
  };
}

/**
 * 注册安川插件（installed 来源 + 同进程 runtime，决策①1A）。
 */
export function registerYaskawaPlugin(
  registry: PluginRegistry,
  options: { codecRegistry: CodecRegistry },
): Result<PluginManifest> {
  return registry.register(yaskawaMemobusManifest, {
    source: "installed",
    runtime: createYaskawaRuntime(options),
  });
}
