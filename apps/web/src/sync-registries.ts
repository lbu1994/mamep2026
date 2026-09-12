/**
 * 插件同步贡献注册面装配（ADR-054，2026-09-12）。
 *
 * 插件 `activate(ctx)` 经 `ctx.registries` 注册 codec / dataType / addressTransform
 * （同步纯函数不可 JSON 序列化，不能进 manifest 的 contributes payload）。
 * 本模块是**唯一的适配点**：把平台无关的注册表（communication.CodecRegistry、
 * data-conversion.DataTypeResolver、plugin-api.AddressTransformRegistry）适配为
 * plugin-api 的 `PluginSyncRegistries`；结构不一致时在此处编译期暴露（`pnpm typecheck`）。
 */
import type { CodecRegistry } from "@mamep2026/communication";
import type { DataTypeResolver } from "@mamep2026/data-conversion";
import { ok } from "@mamep2026/domain";
import type {
  AddressTransformRegistry,
  PluginSyncRegistries,
} from "@mamep2026/plugin-api";

/**
 * 构造插件同步注册面。
 * codec 适配点：`CodecRegistry.register(codec): void` → 注册面要求 `Result<void>`
 * （注册表本身对同 id 覆盖不报错，故恒返回成功；重复注册由插件自身语义承担）。
 * dataType / addressTransform 与注册面结构一致，直接传入（漂移在此处报类型错误）。
 */
export function createPluginSyncRegistries(options: {
  codecRegistry: CodecRegistry;
  dataTypeResolver: DataTypeResolver;
  addressTransformRegistry: AddressTransformRegistry;
}): PluginSyncRegistries {
  return {
    codec: {
      register: (codec) => {
        options.codecRegistry.register(codec);
        return ok(undefined);
      },
      list: () => options.codecRegistry.list(),
    },
    dataType: options.dataTypeResolver,
    addressTransform: options.addressTransformRegistry,
  };
}
