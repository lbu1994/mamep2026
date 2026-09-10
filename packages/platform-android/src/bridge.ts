/**
 * 传输桥接口（ADR-050 §5）：`packages/platform-android` 与原生插件之间的最小面。
 *
 * 真实实现见 `./capacitor-bridge.ts`（`@capacitor/core`，独立子路径导出，避免非 Android 构建被迫加载）；
 * 单测注入 `./testing/fake-transport-bridge.ts`（沿用 platform-node 的 `SerialPortLike` 注入先例）。
 */
import type {
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
}
