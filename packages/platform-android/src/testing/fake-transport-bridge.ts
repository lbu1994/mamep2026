/**
 * 测试用假桥（ADR-050 §4；沿用 platform-node 的 `SerialPortLike` 注入先例）。
 * 记录调用、可注入失败、可驱动事件——单测无需 Android 环境即可覆盖传输语义。
 */
import type {
  BridgeKeepScreenOnParams,
  BridgeOpenSerialParams,
  BridgeOpenTcpParams,
  BridgeWriteParams,
  MamepTransportEvent,
} from "../bridge-contract";
import type {
  BridgeEventHandlerMap,
  BridgeListenerHandle,
  MamepTransportBridge,
} from "../bridge";
import { encodeBytesToBase64 } from "../bridge-contract";

export interface FakeBridgeError {
  code: string;
  message: string;
}

export class FakeTransportBridge implements MamepTransportBridge {
  /** openTcp 收到的参数（按调用顺序）。 */
  readonly openCalls: BridgeOpenTcpParams[] = [];
  /** openSerial 收到的参数（按调用顺序）。 */
  readonly serialOpenCalls: BridgeOpenSerialParams[] = [];
  /** write 收到的 base64 载荷（按调用顺序）。 */
  readonly writeCalls: string[] = [];
  /** setKeepScreenOn 调用序列（Phase 3 KeepAwake）。 */
  readonly keepScreenOnCalls: boolean[] = [];
  /** listSerialPorts 的回包（可注入非法形状以覆盖契约违规）。 */
  serialPortsResult: unknown = { ports: [] };
  listSerialPortsCount = 0;
  closeCount = 0;
  /** 下一次 openTcp / openSerial / listSerialPorts / write / close / addListener 抛出的错误（null = 成功）。 */
  openError: FakeBridgeError | null = null;
  serialOpenError: FakeBridgeError | null = null;
  listSerialPortsError: FakeBridgeError | null = null;
  writeError: FakeBridgeError | null = null;
  closeError: FakeBridgeError | null = null;
  addListenerError: FakeBridgeError | null = null;
  /** 记录被移除的监听器数量（断言 close 后不泄漏）。 */
  removedListeners = 0;

  private readonly handlers: {
    data: Array<(payload: unknown) => void>;
    closed: Array<(payload: unknown) => void>;
    error: Array<(payload: unknown) => void>;
  } = { data: [], closed: [], error: [] };

  async listSerialPorts(): Promise<unknown> {
    this.listSerialPortsCount += 1;
    if (this.listSerialPortsError !== null) throw toError(this.listSerialPortsError);
    return this.serialPortsResult;
  }

  async openTcp(params: BridgeOpenTcpParams): Promise<void> {
    if (this.openError !== null) throw toError(this.openError);
    this.openCalls.push(params);
  }

  async openSerial(params: BridgeOpenSerialParams): Promise<void> {
    if (this.serialOpenError !== null) throw toError(this.serialOpenError);
    this.serialOpenCalls.push(params);
  }

  async write(params: BridgeWriteParams): Promise<void> {
    if (this.writeError !== null) throw toError(this.writeError);
    this.writeCalls.push(params.data);
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    if (this.closeError !== null) throw toError(this.closeError);
  }

  async setKeepScreenOn(params: BridgeKeepScreenOnParams): Promise<void> {
    this.keepScreenOnCalls.push(params.enabled);
  }

  async addListener<E extends MamepTransportEvent>(
    event: E,
    handler: BridgeEventHandlerMap[E],
  ): Promise<BridgeListenerHandle> {
    if (this.addListenerError !== null) throw toError(this.addListenerError);
    const bucket = this.handlers[event] as Array<(payload: unknown) => void>;
    bucket.push(handler);
    return {
      remove: async () => {
        const index = bucket.indexOf(handler);
        if (index >= 0) {
          bucket.splice(index, 1);
          this.removedListeners += 1;
        }
      },
    };
  }

  /** 已注册监听器总数（断言重连后不累积）。 */
  get listenerCount(): number {
    return (
      this.handlers.data.length +
      this.handlers.closed.length +
      this.handlers.error.length
    );
  }

  /** 驱动 data 事件（正常形状）。 */
  emitData(bytes: Uint8Array): void {
    this.emitRawData({ data: encodeBytesToBase64(bytes), bytes: bytes.length });
  }

  /** 驱动 data 事件（任意形状，用于契约违规用例）。 */
  emitRawData(payload: unknown): void {
    for (const handler of [...this.handlers.data]) handler(payload);
  }

  emitClosed(payload: unknown = {}): void {
    for (const handler of [...this.handlers.closed]) handler(payload);
  }

  emitError(code: string, message: string): void {
    for (const handler of [...this.handlers.error]) handler({ code, message });
  }

  /** 驱动任意形状的 error 事件（契约违规用例）。 */
  emitRawError(payload: unknown): void {
    for (const handler of [...this.handlers.error]) handler(payload);
  }
}

function toError(error: FakeBridgeError): Error {
  const cause = new Error(error.message);
  (cause as { code?: string }).code = error.code;
  return cause;
}
