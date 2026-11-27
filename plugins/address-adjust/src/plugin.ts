/**
 * Address Adjust 插件：表级地址变换（sent address = user address − 1）。
 *
 * 本插件为**用户手动安装**的单文件插件——
 * 单文件 entry 导出 `manifest` + `activate(ctx)`，由平台侧同进程加载器加载（安装时用户需在
 * 确认框中显式授权「同进程执行」）；`activate` 经 `ctx.registries.addressTransform` 注册变换
 * （apply/validate 是函数，不能进 manifest 的 contributes payload）。
 * 稳定 ID：插件 id "builtin-address-adjust"、transformId
 * "builtin.address-adjust"（工作区数据无需迁移）。
 */
import {
  PLUGIN_API_VERSION,
  type PluginContext,
  type PluginManifest,
} from "@mamep2026/plugin-api";
import { ADDRESS_ADJUST_TRANSFORM } from "./address-adjust-transform";

export const ADDRESS_ADJUST_PLUGIN_ID = "builtin-address-adjust";

export const addressAdjustManifest: PluginManifest = {
  id: ADDRESS_ADJUST_PLUGIN_ID,
  name: "Address Adjust",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  executionRequirements: {
    version: 1,
    requiredExecution: "same-process",
    reason: "Registers a synchronous address transform.",
  },
  description:
    "Built-in table-level Address Adjust: sent address = user address - 1.",
  author: "Mamep2026 Team",
  platform: { web: true, node: true },
  requiredCapabilities: [],
  permissions: [],
  contributes: {
    addressTransform: {
      id: "builtin.address-adjust",
      protocol: "rtu",
      titleKey: "table.addressAdjust",
      defaultConfig: { enabled: false },
    },
  },
};

/**
 * 单文件 entry 导出：安装时同进程加载器 import 本模块并调用
 * `activate`（manifest 嵌入 entry，安装流程从 entry 提取）。
 */
export const manifest: PluginManifest = addressAdjustManifest;

export function activate(ctx: PluginContext): void {
  const result = ctx.registries.addressTransform.register(
    ADDRESS_ADJUST_TRANSFORM,
  );
  if (!result.ok) {
    // 注册失败（如重复注册）抛错 → 生命周期 failed + 贡献禁用（错误隔离）。
    throw new Error(
      `failed to register address transform: ${result.error.code}`,
    );
  }
}
