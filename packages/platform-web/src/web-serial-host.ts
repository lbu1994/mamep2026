/**
 * 浏览器平台 Host（docs/TECH_DESIGN.md §6.1）。
 * Web Serial 授权选择、串口传输打开、能力矩阵、浏览器时钟。
 */
import type { Result, RtuConnectionProfile } from "@mamep2026/domain";
import { createMamepError } from "@mamep2026/domain";
import {
  browserCapabilities,
  type PlatformCapabilities,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { Clock, TransportPort } from "@mamep2026/communication";
import type { PlatformHost, SerialDeviceHandle } from "@mamep2026/platform-api";
import { browserClock } from "./real-clock";
import type { Serial, SerialPort, SerialPortInfo } from "./web-serial";
import { WebSerialTransport } from "./web-serial-transport";

export interface WebSerialHandle extends SerialDeviceHandle {
  port: SerialPort;
}

/** 由 SerialPort.getInfo() 派生显示标签（USB vendor:product 十六进制）。 */
export function usbDeviceLabel(info: SerialPortInfo): string {
  return `USB ${info.usbVendorId?.toString(16) ?? "unknown"}:${info.usbProductId?.toString(16) ?? "unknown"}`;
}

export interface BrowserHostOptions {
  serial?: Serial | undefined;
  clock?: Clock | undefined;
  capabilities?: PlatformCapabilities | undefined;
}

export class BrowserPlatformHost implements PlatformHost {
  readonly capabilities: PlatformCapabilities;
  readonly clock: Clock;
  private readonly serial: Serial | undefined;

  constructor(options: BrowserHostOptions = {}) {
    this.capabilities = options.capabilities ?? browserCapabilities;
    this.clock = options.clock ?? browserClock;
    this.serial = options.serial;
  }

  get supportsWebSerial(): boolean {
    return this.serial !== undefined;
  }

  async requestSerialPort(): Promise<Result<SerialDeviceHandle | null>> {
    const serial = this.serial;
    if (serial === undefined) {
      return fail(
        createMamepError({
          code: "WEB_SERIAL_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.webSerialUnsupported",
          technicalMessage: "Web Serial API is not supported in this browser",
        }),
      );
    }
    try {
      const port = await serial.requestPort();
      const label = usbDeviceLabel(port.getInfo());
      return ok({ id: label, label, port } satisfies WebSerialHandle);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotFoundError") {
        // 用户取消选择：正常返回 null。
        return ok(null);
      }
      return fail(
        createMamepError({
          code: "SERIAL_REQUEST_FAILED",
          category: "permission",
          userMessageKey: "errors.serialRequestFailed",
          technicalMessage:
            cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
      );
    }
  }

  async openSerialTransport(
    handle: SerialDeviceHandle,
    profile: RtuConnectionProfile,
  ): Promise<Result<TransportPort>> {
    const serialHandle = handle as WebSerialHandle;
    const transport = new WebSerialTransport(serialHandle.port, profile);
    return ok(transport);
  }
}
