/**
 * 插件生命周期骨架（docs/architecture/ports/plugin-api/插件契约.md §2、§4）。
 * 状态机 + 错误隔离：支持同进程 runtime（activate/deactivate）以及
 * PluginRemoteRuntime。第三方 entry 在隔离线程
 * （web Worker / Node worker_threads）执行，经 PluginCommunicationApi 代理桥与主线程通信。
 * activate 抛错 → PLUGIN_HOOK_FAILED → 禁用故障贡献点 → 核心保持可用。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import type { PluginCommunicationApi } from "./plugin-communication-api";
import type { PluginManifest } from "./manifest";
import type { AddressTransformRegistry } from "./address-transform";
import type { DataTypeRegistry } from "./data-type";

export type PluginLifecycleState =
  | "registered" // 已注册、无 runtime（纯清单贡献）
  | "active" // runtime.activate 成功
  | "deactivated" // 已禁用 / deactivate 已执行
  | "failed"; // activate/deactivate 抛错（贡献被禁用，插件仍可见于管理列表）

/** 内置/预装同进程插件运行时（最小执行面；第三方代码隔离见 PluginRemoteRuntime）。 */
export interface PluginRuntime {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  /** 释放运行时资源（可选；远程运行时关闭隔离线程用）。 */
  dispose?(): void | Promise<void>;
  /**
   * 工具栏动作处理器（插件外部化）：插件声明式 toolbarAction 贡献的执行面——
   * 经 ctx.communication（PluginCommunicationApi，走统一调度器）完成设备操作
   * （如安川 ROM/RAM 确定指令写 0900H/0910H）。未声明 = 动作不可用（UI 置灰）。
   */
  handleToolbarAction?(
    actionId: string,
    ctx: PluginContext,
  ): Result<void> | Promise<Result<void>> | void;
}

/**
 * 隔离线程插件运行时：第三方 entry 在隔离线程加载执行。
 * 平台实现：浏览器 = Web Worker（Blob URL）；Node（Electron 主进程 / VSCode Extension Host）
 * = worker_threads。load() 在隔离线程 import entry 并提取 manifest（序列化回主线程），
 * activate 在隔离线程执行插件 activate；唯一外部通道为 PluginCommunicationApi 代理桥。
 */
export interface PluginRemoteRuntime {
  /** 在隔离线程加载 entry 并提取 manifest（单文件 JS 的 manifest 在 entry 内）。 */
  load(): Promise<Result<PluginManifest>>;
  /** 在隔离线程执行插件 activate（失败 → PLUGIN_HOOK_FAILED 错误隔离）。 */
  activate(ctx: PluginContext): Promise<void>;
  /** 在隔离线程执行插件 deactivate（可选）。 */
  deactivate?(): Promise<void>;
  /** 关闭隔离线程并释放资源。 */
  dispose(): Promise<void>;
}

/**
 * 同进程插件 entry 模块形态：单文件 JS 插件的**同进程**加载结果
 * （`export const manifest` + `export function activate(ctx)` + 可选 `deactivate`）。
 * 加载器由平台侧提供（platform-web `loadWebPluginEntry` / platform-node `loadNodePluginEntry`）。
 */
export interface PluginLocalEntry {
  /** 插件清单（未校验；由 PluginRegistry.register 走 pluginManifestSchema）。 */
  manifest: unknown;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  /** 工具栏动作处理面（可选；实现同 PluginRuntime.handleToolbarAction）。 */
  handleToolbarAction?(
    actionId: string,
    ctx: PluginContext,
  ): Result<void> | Promise<Result<void>> | void;
}

/** 协议 codec 读请求（结构镜像 communication.CodecReadRequest）。 */
export interface PluginCodecReadRequest {
  slaveAddress: number;
  addresses: number[];
}

/** 协议 codec 写请求项（结构镜像 communication.CodecWriteEntry）。 */
export interface PluginCodecWriteEntry {
  address: number;
  value: number;
}

/** 协议 codec 写请求（结构镜像 communication.CodecWriteRequest）。 */
export interface PluginCodecWriteRequest {
  slaveAddress: number;
  entries: PluginCodecWriteEntry[];
}

/** 协议 codec 解码结果（结构镜像 communication.CodecDecodedResponse）。 */
export type PluginCodecDecodedResponse =
  | { kind: "read"; values: number[] }
  | { kind: "write" }
  | { kind: "exception"; exceptionCode: number };

/** 协议 codec 期望描述（结构镜像 communication.CodecExpect）。 */
export type PluginCodecExpect =
  | { protocolId: string; kind: "read"; request: PluginCodecReadRequest }
  | { protocolId: string; kind: "write"; request: PluginCodecWriteRequest };

/** 协议 codec 分帧解析器（结构镜像 communication.FrameParser）。 */
export interface PluginFrameParser {
  push(chunk: Uint8Array):
    | { done: false }
    | {
        done: true;
        outcome: Result<PluginCodecDecodedResponse>;
        frame: Uint8Array;
      };
}

/**
 * 插件提供的协议编解码器（结构镜像 communication.ProtocolCodec）。
 *
 * 分层说明：plugin-api 只依赖 domain，不依赖 communication，故此处**镜像声明**
 * 同构接口；结构相同即互相可赋值，漂移会在各插件调用点与 apps/web 组合根的赋值校验处
 * 于 `pnpm typecheck` 阶段暴露。
 */
export interface PluginProtocolCodec {
  /** 协议唯一 ID（即会话 codecId）。 */
  protocolId: string;
  maxRead?: number;
  maxWrite?: number;
  encodeRead(req: PluginCodecReadRequest): Uint8Array;
  encodeWrite(req: PluginCodecWriteRequest): Uint8Array;
  decodeResponse(
    frame: Uint8Array,
    expect: PluginCodecExpect,
  ): Result<PluginCodecDecodedResponse>;
  parserFactory(expect: PluginCodecExpect): PluginFrameParser;
  expectedLength(
    kind: "read" | "write",
    expect: PluginCodecExpect,
  ): { normal: number; exception: number };
  mapException?(exceptionCode: number): MamepError;
}

/**
 * 同步贡献注册面：插件经 `ctx.registries` 注册**同步纯函数**贡献
 * （协议 codec / 插件数据类型 / 地址变换）——函数不可 JSON 序列化，不能进 manifest 的
 * `contributes` payload，只能在 `activate` 时注册。宿主（应用装配层）把自身注册表适配为
 * 本接口注入。
 */
export interface PluginSyncRegistries {
  /** 协议 codec 注册面（宿主适配为 communication.CodecRegistry）。 */
  readonly codec: {
    register(codec: PluginProtocolCodec): Result<void>;
    list(): string[];
  };
  /** 插件数据类型注册面（结构同 DataTypeRegistry）。 */
  readonly dataType: DataTypeRegistry;
  /** 地址变换注册面。 */
  readonly addressTransform: AddressTransformRegistry;
}

/** 传给 activate/deactivate 的插件上下文。 */ export interface PluginContext {
  pluginId: string;
  /** 唯一通信面（不暴露 Transport / socket 句柄，经统一调度器）。 */
  communication: PluginCommunicationApi;
  /** 同步贡献注册面：activate 时注册 codec/dataType/addressTransform。 */
  registries: PluginSyncRegistries;
}

export const PLUGIN_LOAD_FAILED = "PLUGIN_LOAD_FAILED";
export const PLUGIN_HOOK_FAILED = "PLUGIN_HOOK_FAILED";

/**
 * 把同进程 entry 模块装配为注册表可用的运行时：
 * 同进程加载器（`loadWebPluginEntry` / `loadNodePluginEntry`）与装配层共用的胶水，
 * 把 `PluginLocalEntry` 的 `activate`/`deactivate`/`handleToolbarAction` 映射为 `PluginRuntime`。
 */
export function runtimeFromLocalEntry(entry: PluginLocalEntry): PluginRuntime {
  return {
    activate: (ctx) => entry.activate(ctx),
    ...(entry.deactivate !== undefined
      ? { deactivate: () => entry.deactivate?.() }
      : {}),
    ...(entry.handleToolbarAction !== undefined
      ? {
          handleToolbarAction: (actionId: string, ctx: PluginContext) =>
            entry.handleToolbarAction?.(actionId, ctx),
        }
      : {}),
  };
}
