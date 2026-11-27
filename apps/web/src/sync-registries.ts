/**
 * 插件同步贡献注册面装配。
 *
 * 插件 `activate(ctx)` 经 `ctx.registries` 注册 codec / dataType / addressTransform
 * （同步纯函数不可 JSON 序列化，不能进 manifest 的 contributes payload）。
 * 本模块是**唯一的适配点**：把平台无关的注册表（communication.CodecRegistry、
 * data-conversion.DataTypeResolver、plugin-api.AddressTransformRegistry）适配为
 * plugin-api 的 `PluginHostSyncRegistries`；结构不一致时在此处编译期暴露（`pnpm typecheck`）。
 */
import type { CodecRegistry } from "@mamep2026/communication";
import type { DataTypeResolver } from "@mamep2026/data-conversion";
import type {
  AddressTransformRegistry,
  PluginHostSyncRegistries,
} from "@mamep2026/plugin-api";
import { createUnavailableSyncRegistries } from "@mamep2026/plugin-api";

/**
 * 构造插件同步注册面。
 * Codec registration requires a scope created by the plugin lifecycle owner.
 * Core registrations remain outside plugin scopes.
 */
export function createPluginSyncRegistries(options: {
  codecRegistry: CodecRegistry;
  dataTypeResolver: DataTypeResolver;
  addressTransformRegistry: AddressTransformRegistry;
}): PluginHostSyncRegistries {
  return {
    codec: createUnavailableSyncRegistries().codec,
    createCodecScope: (pluginId) => options.codecRegistry.createScope(pluginId),
    dataType: options.dataTypeResolver,
    addressTransform: options.addressTransformRegistry,
  };
}
