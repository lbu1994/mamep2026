/**
 * Web Serial 传输适配器（docs/TECH_DESIGN.md §9.2）。
 * 只处理打开/关闭/字节读写与事件；不理解 Modbus 或寄存器表。
 * 浏览器错误映射为结构化错误；关闭幂等并释放 Reader/Writer 锁。
 */
import type {
  MamepError,
  Result,
  RtuConnectionProfile,
} from "@mamep2026/domain";
import { createMamepError } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import { validatePlatformSerialParameters } from "@mamep2026/platform-api";
import type { SerialPort } from "./web-serial";

export class WebSerialTransport implements TransportPort {
  readonly kind = "web-serial" as const;
  private openFlag = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly port: SerialPort;
  private readonly profile: RtuConnectionProfile;

  constructor(port: SerialPort, profile: RtuConnectionProfile) {
    this.port = port;
    this.profile = profile;
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onError(listener: (error: MamepError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async open(): Promise<Result<void>> {
    const validation = validatePlatformSerialParameters(
      this.profile,
      "browser",
    );
    if (!validation.ok) {
      return fail(
        createMamepError({
          code: "SERIAL_PARAMETER_UNSUPPORTED",
          category: "connection",
          userMessageKey: "errors.serialParameterUnsupported",
          technicalMessage: validation.reason,
        }),
      );
    }
    try {
      await this.port.open({
        baudRate: this.profile.baudRate,
        dataBits: this.profile.dataBits,
        stopBits: this.profile.stopBits,
        parity: this.profile.parity,
        bufferSize: 255,
        flowControl:
          this.profile.flowControl === "rts-cts" ? "hardware" : "none",
      });
      this.openFlag = true;
      this.startPump();
      return ok(undefined);
    } catch (cause) {
      return fail(mapSerialError(cause));
    }
  }

  async close(): Promise<Result<void>> {
    this.openFlag = false;
    try {
      await this.reader?.cancel().catch(() => undefined);
      this.reader = null;
      await this.port.close();
    } catch (cause) {
      // 关闭失败不视为致命：已释放本地引用。
      const error = mapSerialError(cause);
      this.emitClose();
      return fail(error);
    }
    this.emitClose();
    return ok(undefined);
  }

  async write(bytes: Uint8Array): Promise<Result<void>> {
    if (!this.openFlag) {
      return fail(
        createMamepError({
          code: "TRANSPORT_NOT_OPEN",
          category: "transport",
          userMessageKey: "errors.transportNotOpen",
          technicalMessage: "serial port is not open",
        }),
      );
    }
    const writer = this.port.writable?.getWriter();
    if (writer === undefined) {
      return fail(
        createMamepError({
          code: "TRANSPORT_WRITE_FAILED",
          category: "transport",
          retryable: true,
          userMessageKey: "errors.transportWriteFailed",
          technicalMessage: "serial port has no writable stream",
        }),
      );
    }
    try {
      await writer.write(bytes);
      return ok(undefined);
    } catch (cause) {
      return fail(mapSerialError(cause));
    } finally {
      writer.releaseLock();
    }
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  private startPump(): void {
    const readable = this.port.readable;
    if (readable === null) return;
    this.reader = readable.getReader();
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await this.reader!.read();
      } catch (cause) {
        if (this.openFlag) {
          const error = mapSerialError(cause);
          for (const listener of this.errorListeners) listener(error);
        }
        this.emitClose();
        return;
      }
      if (result.done) {
        this.emitClose();
        return;
      }
      if (result.value.length > 0) {
        for (const listener of this.dataListeners) listener(result.value);
      }
    }
  }

  private emitClose(): void {
    this.openFlag = false;
    for (const listener of this.closeListeners) listener();
  }
}

export function mapSerialError(cause: unknown): MamepError {
  const name = cause instanceof DOMException ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);

  if (name === "NotFoundError") {
    return createMamepError({
      code: "SERIAL_DEVICE_DISCONNECTED",
      category: "connection",
      retryable: false,
      userMessageKey: "errors.serialDeviceDisconnected",
      technicalMessage: `serial device not found: ${message}`,
      cause,
    });
  }
  if (name === "InvalidStateError") {
    return createMamepError({
      code: "SERIAL_PORT_IN_USE",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.serialPortInUse",
      technicalMessage: `serial port already in use: ${message}`,
      cause,
    });
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return createMamepError({
      code: "SERIAL_PERMISSION_DENIED",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.serialPermissionDenied",
      technicalMessage: `serial permission denied: ${message}`,
      cause,
    });
  }
  return createMamepError({
    code: "SERIAL_ERROR",
    category: "transport",
    retryable: true,
    userMessageKey: "errors.serialError",
    technicalMessage: message,
    cause,
  });
}
