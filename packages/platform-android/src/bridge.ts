/**
 * 传输桥接口（ADR-050 §5）：`packages/platform-android` 与原生插件之间的最小面。
 *
 * 真实实现见 `./capacitor-bridge.ts`（`@capacitor/core`，独立子路径导出，避免非 Android 构建被迫加载）；
 * 单测注入 `./testing/fake-transport-bridge.ts`（沿用 platform-node 的 `SerialPortLike` 注入先例）。
 */
import type {
  BridgeKeepScreenOnParams,
  BridgeOpenSerialParams,
  BridgeOpenTcpParams,
  BridgeWriteParams,
  MamepTransportEvent,
} from "./bridge-contract";

export interface BridgeListenerHandle {
  remove(): Promise<void>;
}

/** 桥事件载荷按事件名区分（非法形状由实现层用 Zod 拒绝）。 */
export interface BridgeEventHandlerMap {
  data: (payload: unknown) => void;
  closed: (payload: unknown) => void;
  error: (payload: unknown) => void;
}

export interface MamepTransportBridge {
  /**
   * 枚举 USB 串口（Phase 2）。返回**原始回包**（unknown），由消费侧 `parseBridgePayload` 校验；
   * 这样“未知形状一律拒绝”的姿态在传输/Host 层统一实现，桥实现无需重复校验。
   */
  listSerialPorts(): Promise<unknown>;
  /** 打开 TCP 连接（原生侧 socket + 读线程）。 */
  openTcp(params: BridgeOpenTcpParams): Promise<void>;
  /** 打开 USB 串口（原生侧 USB Host + 读线程；参数含校验后的串口链路参数）。 */
  openSerial(params: BridgeOpenSerialParams): Promise<void>;
  /** 写字节（base64）。resolve 仅表示已提交给原生传输，不代表对端响应。 */
  write(params: BridgeWriteParams): Promise<void>;
  /** 关闭当前活动传输；幂等。 */
  close(): Promise<void>;
  addListener<E extends MamepTransportEvent>(
    event: E,
    handler: BridgeEventHandlerMap[E],
  ): Promise<BridgeListenerHandle>;
  /**
   * 屏幕常亮开关（KeepAwake，ADR-050 Phase 3）：与活动传输**无关**，
   * 而是由「是否存在持续轮询/追踪」驱动；幂等。
   */
  setKeepScreenOn(params: BridgeKeepScreenOnParams): Promise<void>;
}

/**
 * 应用生命周期桥（`@capacitor/app`，ADR-050 Phase 3）。
 *
 * 真实实现见 `./capacitor-app.ts`（独立子路径导出，非 Android 构建不加载 `@capacitor/app`）；
 * 与 `MamepTransportBridge` 分开是因为它服务的是 UI 生命周期（返回键/前后台），
 * 与通信传输无关，也可独立注入（见 `AndroidAppHostOptions.appLifecycle`）。
 */
export interface AndroidAppLifecycleBridge {
  /**
   * 订阅硬件返回键。
   *
   * `handler` 返回 `true` 表示已消费（不再执行默认行为）；返回 `false` 时桥调用
   * `minimizeApp()`（Android 惯例：根页面按返回键退到后台而非退出进程）。
   * 返回取消订阅函数（异步解析：桥不可用时 reject）。
   */
  onBackButton(handler: () => boolean): Promise<() => void>;
  /** 订阅前后台状态变化（`isActive=false` 表示进入后台）。返回取消订阅函数。 */
  onAppStateChange(handler: (isActive: boolean) => void): Promise<() => void>;
  /** 最小化应用到后台（Android 专属）。 */
  minimizeApp(): Promise<void>;
}
