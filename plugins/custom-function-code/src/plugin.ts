/**
 * 自定义功能码示例插件（ADR-043 E-4）。
 *
 * 演示插件开发范本（source:"builtin" 同进程）：
 * - `protocolExtension`：声明协议 "custom-function-code"；
 * - `tableType`：声明 "holding-register" 表类型映射到该协议（侧边栏分组）；
 * - `toolbarAction`：演示工具栏动作（声明式，Phase A 无 handler）；
 * - `dataType`：演示 ADR-043 E-3 插件数据类型（运行时经 resolver.register 注入，
 *   展示单寄存器插件类型的解析/格式化）。
 */
import type { CodecRegistry } from "@mamep2026/communication";
import type { DataTypeResolver } from "@mamep2026/data-conversion";
import type { Result } from "@mamep2026/domain";
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginRegistry,
} from "@mamep2026/plugin-api";
import { CustomFunctionCodec } from "./codec";

export const CUSTOM_FUNCTION_PLUGIN_ID = "custom-function-code";
export const CUSTOM_FUNCTION_PROTOCOL_ID = "custom-function-code";
/** 插件表类型：<pluginId>:<tableTypeId>（tableTypeId 复用核心 holding-register）。 */
export const CUSTOM_FUNCTION_TABLE_TYPE =
  "custom-function-code:holding-register";
/** 示例插件数据类型 id（ADR-043 E-3：单寄存器插件类型，值 × 10 显示）。 */
export const CUSTOM_PLUGIN_DATA_TYPE = "custom-function-code:scaled";

export const customFunctionManifest: PluginManifest = {
  id: CUSTOM_FUNCTION_PLUGIN_ID,
  name: "Custom Function Code",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
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
 * 注册示例插件（内置同进程）：activate 时把 CustomFunctionCodec 注册进 CodecRegistry，
 * 并把插件 dataType 的解析/格式化注册进 DataTypeResolver（ADR-043 E-3）。
 */
export function registerCustomFunctionPlugin(
  registry: PluginRegistry,
  options: { codecRegistry: CodecRegistry; dataTypeResolver: DataTypeResolver },
): Result<PluginManifest> {
  return registry.register(customFunctionManifest, {
    source: "builtin",
    runtime: {
      activate() {
        options.codecRegistry.register(new CustomFunctionCodec());
        options.dataTypeResolver.register(CUSTOM_PLUGIN_DATA_TYPE, {
          // 值语义：单元格文本 = 原始值 / 10（一位小数，无符号）。
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
            const value =
              Number(match[1] ?? "0") * 10 + Number(match[2] ?? "0");
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
        });
      },
    },
  });
}
