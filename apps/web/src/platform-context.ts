/**
 * 跨平台共享装配上下文（composition root）。
 *
 * 平台 Host 工厂（`host-factories/*`）所需的一切平台无关依赖在此一次性装配：codec / 数据类型 /
 * 地址变换注册表 + 插件同步贡献注册面 + 运行模式标记。平台专属部分（串口、桥、仓储实现）由各
 * 工厂自行决定，因此本模块**不引用任何平台专属依赖**（浏览器/桌面端/Android 共用）。
 */
import type { AddressTransform } from "@mamep2026/domain";
import {
  createCodecRegistry,
  registerBasicTablesCodecs,
  type CodecRegistry,
} from "@mamep2026/communication";
import {
  createDataTypeResolver,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";
import {
  createAddressTransformRegistry,
  type PluginHostSyncRegistries,
} from "@mamep2026/plugin-api";
import type { CompatibilityEnv, KeyValueStore } from "@mamep2026/platform-web";
// IndexedDB KV（浏览器 / Android 共用能力）：四端构建共用该模块，非平台专属依赖。
import { createIdbKeyValueStore } from "@mamep2026/platform-web";
import { createPluginSyncRegistries } from "./sync-registries";

export interface PlatformHostContext {
  /** codec 注册表：基础表 codec 已注册，插件经 `syncRegistries` 追加。 */
  codecRegistry: CodecRegistry;
  /** 数据类型解析器：装配后注入 UI store。 */
  dataTypeResolver: DataTypeResolver;
  /** 同步贡献注册面：插件 `activate(ctx)` 的唯一注入点。 */
  syncRegistries: PluginHostSyncRegistries;
  /** 地址变换解析：表级 Address Adjust 经此解析。 */
  resolveAddressTransform: (transformId: string) => AddressTransform | null;
  /** dev mock 传输（`?mockTransport=1`，仅 dev 生效；浏览器/Android 使用）。 */
  mockTransport: boolean;
  /** 浏览器兼容性检测输入（PRD §8.3 / §15.7；仅浏览器 Host 使用）。 */
  compatibilityEnv: CompatibilityEnv;
  /**
   * 浏览器 / Android 共用的 IndexedDB KV（不同 key：workspace / plugins）。
   * 惰性工厂：桌面端不需要，避免无谓实例化。
   */
  createIdbKeyValueStore: () => KeyValueStore;
}

export interface PlatformContextEnv {
  mockTransport: boolean;
  compatibilityEnv: CompatibilityEnv;
  /** KV 工厂（默认真实 IndexedDB；测试可注入内存实现）。 */
  createIdbKeyValueStore?: () => KeyValueStore;
}

/** 装配共享上下文（每次调用返回一整套独立注册表；StrictMode 双挂载下仅最新一份被使用）。 */
export function createPlatformHostContext(
  env: PlatformContextEnv,
): PlatformHostContext {
  // codec 注册表：插件 activate 经 ctx.registries 填充，connect 按活动表协议路由。
  const codecRegistry = createCodecRegistry();
  // 基础表 codec：coil/discrete-input/input-register，三端共享装配（核心能力）。
  registerBasicTablesCodecs(codecRegistry);
  // 地址变换注册表+ 数据类型解析器：插件 activate 经 ctx.registries
  // 注册（插件一律手动安装，核心不再内置任何插件）。
  const transformRegistry = createAddressTransformRegistry();
  const dataTypeResolver = createDataTypeResolver();
  const resolveAddressTransform = (transformId: string) =>
    transformRegistry.get(transformId) ?? null;
  const syncRegistries = createPluginSyncRegistries({
    codecRegistry,
    dataTypeResolver,
    addressTransformRegistry: transformRegistry,
  });
  return {
    codecRegistry,
    dataTypeResolver,
    syncRegistries,
    resolveAddressTransform,
    mockTransport: env.mockTransport,
    compatibilityEnv: env.compatibilityEnv,
    createIdbKeyValueStore:
      env.createIdbKeyValueStore ?? createIdbKeyValueStore,
  };
}
