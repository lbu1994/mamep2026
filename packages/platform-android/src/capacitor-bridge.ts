/**
 * Capacitor 桥实现（ADR-050 §5）：`@capacitor/core` 的 `registerPlugin` 包装。
 *
 * 单独子路径导出（`@mamep2026/platform-android/capacitor`）：只有 Android 装配才加载 `@capacitor/core`，
 * 浏览器 / Electron / VSCode 构建不引入该依赖。
 *
 * 说明：`registerPlugin` 只在工厂调用时执行（模块级无副作用）；插件未注册时调用会 reject，
 * 由传输层映射为结构化错误（`PLUGIN_UNAVAILABLE` → 能力错误）。
 */
import { registerPlugin } from "@capacitor/core";
import type {
  BridgeKeepScreenOnParams,
  BridgeOpenSerialParams,
  BridgeOpenTcpParams,
  BridgeWriteParams,
  MamepTransportEvent,
} from "./bridge-contract";
import type {
  BridgeEventHandlerMap,
  BridgeListenerHandle,
  MamepTransportBridge,
} from "./bridge";

/** Web 插件具备 / 原生注册的方法（与 apps/android 的 Kotlin 插件一一对应）。 */
interface MamepTransportPluginHandle {
  listSerialPorts(): Promise<unknown>;
  openTcp(params: BridgeOpenTcpParams): Promise<unknown>;
  openSerial(params: BridgeOpenSerialParams): Promise<unknown>;
  write(params: BridgeWriteParams): Promise<unknown>;
  close(): Promise<unknown>;
  setKeepScreenOn(params: BridgeKeepScreenOnParams): Promise<unknown>;
  addListener(
    event: MamepTransportEvent,
    handler: (payload: unknown) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

/** 插件名（apps/android 的 `@CapacitorPlugin(name = ...)` 必须一致）。 */
export const MAMEP_TRANSPORT_PLUGIN_NAME = "MamepTransport";

/** 创建真实桥（仅在 Android 装配中调用）。 */
export function createCapacitorTransportBridge(): MamepTransportBridge {
  const plugin = registerPlugin<MamepTransportPluginHandle>(
    MAMEP_TRANSPORT_PLUGIN_NAME,
  );

  return {
    async listSerialPorts(): Promise<unknown> {
      return plugin.listSerialPorts();
    },
    async openTcp(params: BridgeOpenTcpParams): Promise<void> {
      await plugin.openTcp(params);
    },
    async openSerial(params: BridgeOpenSerialParams): Promise<void> {
      await plugin.openSerial(params);
    },
    async write(params: BridgeWriteParams): Promise<void> {
      await plugin.write(params);
    },
    async close(): Promise<void> {
      await plugin.close();
    },
    async setKeepScreenOn(params: BridgeKeepScreenOnParams): Promise<void> {
      await plugin.setKeepScreenOn(params);
    },
    async addListener<E extends MamepTransportEvent>(
      event: E,
      handler: BridgeEventHandlerMap[E],
    ): Promise<BridgeListenerHandle> {
      const handle = await plugin.addListener(event, (payload) =>
        handler(payload as never),
      );
      return { remove: () => handle.remove() };
    },
  };
}
