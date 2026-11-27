/**
 * 自定义功能码示例插件（**用户手动安装**的单文件插件）。
 *
 * 演示插件开发范本：
 * - `protocolExtension`：声明协议 "custom-function-code"；
 * - `tableType`：声明 "holding-register" 表类型映射到该协议（侧边栏分组）；
 * - `toolbarAction`：演示工具栏动作（声明式，无 handler → 界面置灰占位）；
 * - `dataType`：演示插件数据类型（activate 经 `ctx.registries` 注册
 *   codec 与解析/格式化函数）。
 * 单文件 entry 导出 `manifest` + `activate(ctx)`，由平台侧同进程加载器加载
 * （安装时用户需在确认框中显式授权「同进程执行」）。
 */
import {
  PLUGIN_API_VERSION,
  type PluginContext,
  type PluginDataTypeHandlers,
  type PluginManifest,
} from "@mamep2026/plugin-api";
import { CustomFunctionCodec } from "./codec";

export const CUSTOM_FUNCTION_PLUGIN_ID = "custom-function-code";
export const CUSTOM_FUNCTION_PROTOCOL_ID = "custom-function-code";
/** 插件表类型：<pluginId>:<tableTypeId>（tableTypeId 复用核心 holding-register）。 */
export const CUSTOM_FUNCTION_TABLE_TYPE =
  "custom-function-code:holding-register";
/** 示例插件数据类型 id（单寄存器插件类型，值 × 10 显示）。 */
export const CUSTOM_PLUGIN_DATA_TYPE = "custom-function-code:scaled";

export const customFunctionManifest: PluginManifest = {
  id: CUSTOM_FUNCTION_PLUGIN_ID,
  name: "Custom Function Code",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  executionRequirements: {
    version: 1,
    requiredExecution: "same-process",
    reason: "Registers a synchronous protocol codec and data type.",
  },
  description:
    "Example plugin demonstrating a custom Modbus RTU protocol (0x65 read / 0x66 write) plus a plugin data type (ADR-043 E-3/E-4).",
  author: "Mamep2026 Team",
  license: "MIT",
  platform: { web: true, node: true },
  requiredCapabilities: ["modbus-rtu"],
  permissions: ["communication", "device-write", "ui-contribution"],
  contributes: {
    protocolExtension: {
      protocolId: CUSTOM_FUNCTION_PROTOCOL_ID,
      titleKey: "plugins.customFunctionTitle",
    },
    tableType: {
      id: "holding-register",
      protocolId: CUSTOM_FUNCTION_PROTOCOL_ID,
      titleKey: "plugins.customFunctionTitle",
    },
    toolbarAction: [
      {
        id: "custom-function.zero",
        titleKey: "table.customZero",
        icon: "ClearOutlined",
        scope: "table-toolbar",
        targetTableType: "holding-register",
        requiresConfirm: true,
      },
    ],
    command: [{ id: "custom-function.zero", titleKey: "table.customZero" }],
    dataType: {
      id: CUSTOM_PLUGIN_DATA_TYPE,
      titleKey: "table.customScaled",
    },
  },
};

/**
 * 插件 dataType 处理函数：值语义 = 单元格文本为原始值 ÷ 10（一位小数，无符号）。
 */
const CUSTOM_PLUGIN_DATA_TYPE_HANDLERS: PluginDataTypeHandlers = {
  parse: (text) => {
    const match = /^(\d+)(?:\.(\d))?$/.exec(text.trim());
    if (match === null) {
      return {
        ok: false as const,
        error: {
          code: "DATA_INVALID_NUMBER",
          category: "validation" as const,
          severity: "error" as const,
          retryable: false,
          userMessageKey: "errors.dataInvalidNumber",
          technicalMessage: `invalid scaled input: ${text}`,
        },
      };
    }
    const value = Number(match[1] ?? "0") * 10 + Number(match[2] ?? "0");
    if (value > 65535) {
      return {
        ok: false as const,
        error: {
          code: "DATA_OUT_OF_RANGE",
          category: "validation" as const,
          severity: "error" as const,
          retryable: false,
          userMessageKey: "errors.dataOutOfRange",
          technicalMessage: `scaled value out of range: ${text}`,
        },
      };
    }
    return { ok: true as const, value };
  },
  format: (raw) => `${Math.trunc(raw / 10)}.${raw % 10}`,
};

/**
 * 单文件 entry 导出：安装时同进程加载器 import 本模块并调用
 * `activate`（manifest 嵌入 entry，安装流程从 entry 提取），经 `ctx.registries` 注册 codec
 * 与插件 dataType（函数不可序列化，不能进 manifest 的 contributes payload）。
 */
export const manifest: PluginManifest = customFunctionManifest;

export function activate(ctx: PluginContext): void {
  ctx.registries.codec.register(new CustomFunctionCodec());
  const registered = ctx.registries.dataType.register(
    CUSTOM_PLUGIN_DATA_TYPE,
    CUSTOM_PLUGIN_DATA_TYPE_HANDLERS,
  );
  if (!registered.ok) {
    throw new Error(`failed to register data type: ${registered.error.code}`);
  }
}
