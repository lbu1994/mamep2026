/**
 * Address Adjust 插件（2026-09-02，插件外部化：自 apps/web/src/App.tsx 内联移出，
 * 变换原定义于 packages/register-table/src/address.ts，一并移入本包）。
 * 保留现名（用户决策 2026-09-02）：插件 id "builtin-address-adjust" 与 transformId
 * "builtin.address-adjust" 不变（工作区数据零迁移，文档注明 builtin 仅为历史命名）。
 * 贡献点声明式数据（供工具栏/Plugin Manager 消费）；apply/validate 函数
 * 经 runtime.activate 注册进 AddressTransformRegistry（函数不可序列化，不能进 payload）。
 * 随应用分发，首次启动一次性安装（installed 来源 + 同进程 runtime）。
 */
import type { Result } from "@mamep2026/domain";
import {
  PLUGIN_API_VERSION,
  type AddressTransformRegistry,
  type PluginManifest,
  type PluginRegistry,
  type PluginRuntime,
} from "@mamep2026/plugin-api";
import { ADDRESS_ADJUST_TRANSFORM } from "./address-adjust-transform";

export const ADDRESS_ADJUST_PLUGIN_ID = "builtin-address-adjust";

export const addressAdjustManifest: PluginManifest = {
  id: ADDRESS_ADJUST_PLUGIN_ID,
  name: "Address Adjust",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  description:
    "Built-in table-level Address Adjust: sent address = user address - 1.",
  author: "Mamep2026 Team",
  platform: { web: true, node: true },
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
 * 构造 Address Adjust 插件运行时（installed 来源同进程 runtime）：
 * activate 时把 Address Adjust 变换注册进 AddressTransformRegistry（经装配链生效）。
 * （2026-09-02 插件外部化：装配层在首次安装与重启恢复时复用同一工厂。）
 */
export function createAddressAdjustRuntime(options: {
  transformRegistry: AddressTransformRegistry;
}): PluginRuntime {
  return {
    activate() {
      options.transformRegistry.register(ADDRESS_ADJUST_TRANSFORM);
    },
  };
}

/**
 * 注册 Address Adjust 插件（installed 来源，同进程 runtime）。
 */
export function registerAddressAdjustPlugin(
  registry: PluginRegistry,
  options: { transformRegistry: AddressTransformRegistry },
): Result<PluginManifest> {
  return registry.register(addressAdjustManifest, {
    source: "installed",
    runtime: createAddressAdjustRuntime(options),
  });
}
