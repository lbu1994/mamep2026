/**
 * Android 原生错误码 → 统一错误模型（ADR-050 §6）。
 *
 * 原生侧（Kotlin 插件）只报稳定错误码 + 技术消息，映射规则集中在此：
 * 复用 `platform-node` 的 TCP / 串口错误码与 i18n key，避免同类问题在不同端出现两套错误码与文案。
 */
import { createMamepError, type MamepError } from "@mamep2026/domain";

/** 原生插件可能上报的错误码（与 apps/android 的 Kotlin 侧常量同源）。 */
export const ANDROID_NATIVE_ERROR_CODES = {
  connectFailed: "TCP_CONNECT_FAILED",
  openFailed: "TCP_OPEN_FAILED",
  notOpen: "NOT_OPEN",
  writeFailed: "WRITE_FAILED",
  remoteClosed: "REMOTE_CLOSED",
  connectionReset: "CONNECTION_RESET",
  pluginUnavailable: "PLUGIN_UNAVAILABLE",
  // USB 串口（Phase 2）
  usbPermissionDenied: "USB_PERMISSION_DENIED",
  usbDeviceNotFound: "USB_DEVICE_NOT_FOUND",
  usbDeviceBusy: "USB_DEVICE_BUSY",
  usbDriverUnsupported: "USB_DRIVER_UNSUPPORTED",
  usbParametersUnsupported: "USB_PARAMETERS_UNSUPPORTED",
  usbOpenFailed: "USB_OPEN_FAILED",
  usbDetached: "USB_DETACHED",
} as const;

export type AndroidNativeErrorCode =
  (typeof ANDROID_NATIVE_ERROR_CODES)[keyof typeof ANDROID_NATIVE_ERROR_CODES];

export interface NativeBridgeError {
  readonly code: string;
  readonly message: string;
}

/** 把原生错误映射为项目错误；未识别错误按上下文兜底（打开 vs 读写），不丢技术信息。 */
export function mapAndroidNativeError(
  error: NativeBridgeError,
  fallback: "open" | "io" | "serial-open" | "serial-io",
): MamepError {
  const { code, message } = error;
  const native = ANDROID_NATIVE_ERROR_CODES;

  if (code === native.notOpen) {
    return createMamepError({
      code: "TRANSPORT_NOT_OPEN",
      category: "transport",
      retryable: false,
      userMessageKey: "errors.transportNotOpen",
      technicalMessage: message,
    });
  }

  // ---- TCP（Phase 1）----
  if (
    code === native.connectFailed ||
    code === native.remoteClosed ||
    code === native.connectionReset
  ) {
    return createMamepError({
      code: "TCP_CONNECTION_FAILED",
      category: "connection",
      retryable: true,
      userMessageKey: "errors.tcpConnectionFailed",
      technicalMessage: `android tcp connection failed: ${message}`,
    });
  }

  if (code === native.openFailed) {
    return createMamepError({
      code: "TCP_OPEN_FAILED",
      category: "transport",
      retryable: true,
      userMessageKey: "errors.tcpOpenFailed",
      technicalMessage: `android tcp open failed: ${message}`,
    });
  }

  // ---- USB 串口（Phase 2）----
  if (code === native.usbPermissionDenied) {
    return createMamepError({
      code: "SERIAL_PERMISSION_DENIED",
      category: "permission",
      retryable: true,
      userMessageKey: "errors.serialPermissionDenied",
      technicalMessage: `android usb permission denied: ${message}`,
    });
  }

  if (code === native.usbDeviceBusy) {
    return createMamepError({
      code: "SERIAL_PORT_IN_USE",
      category: "connection",
      retryable: true,
      userMessageKey: "errors.serialPortInUse",
      technicalMessage: `android usb device is busy: ${message}`,
    });
  }

  if (code === native.usbDeviceNotFound) {
    return createMamepError({
      code: "SERIAL_NOT_FOUND",
      category: "connection",
      retryable: true,
      userMessageKey: "errors.serialNotFound",
      technicalMessage: `android usb device not found: ${message}`,
    });
  }

  if (code === native.usbDetached) {
    return createMamepError({
      code: "SERIAL_DEVICE_DISCONNECTED",
      category: "connection",
      retryable: true,
      userMessageKey: "errors.serialDeviceDisconnected",
      technicalMessage: `android usb device detached: ${message}`,
    });
  }

  if (code === native.usbDriverUnsupported) {
    return createMamepError({
      code: "SERIAL_DRIVER_UNSUPPORTED",
      category: "capability",
      retryable: false,
      userMessageKey: "errors.serialDriverUnsupported",
      technicalMessage: `android usb serial driver unsupported: ${message}`,
    });
  }

  if (code === native.usbParametersUnsupported) {
    return serialParameterUnsupportedError(message);
  }

  if (code === native.usbOpenFailed) {
    return serialOpenFailedError(message);
  }

  if (code === native.writeFailed) {
    if (fallback === "serial-io" || fallback === "serial-open") {
      return createMamepError({
        code: "SERIAL_WRITE_FAILED",
        category: "transport",
        retryable: true,
        userMessageKey: "errors.serialError",
        technicalMessage: `android serial write failed: ${message}`,
      });
    }
    return createMamepError({
      code: "TCP_CONNECTION_FAILED",
      category: "transport",
      retryable: true,
      userMessageKey: "errors.tcpConnectionFailed",
      technicalMessage: `android tcp write failed: ${message}`,
    });
  }

  if (code === native.pluginUnavailable) {
    return createMamepError({
      code: "TCP_UNSUPPORTED",
      category: "capability",
      retryable: false,
      userMessageKey: "errors.tcpUnsupported",
      technicalMessage: `android transport plugin unavailable: ${message}`,
    });
  }

  // 兜底：按上下文区分「TCP 打开 / TCP 读写 / 串口打开 / 串口读写」。
  if (fallback === "serial-open")
    return serialOpenFailedError(`${code}: ${message}`);
  if (fallback === "serial-io") {
    return createMamepError({
      code: "SERIAL_ERROR",
      category: "transport",
      retryable: true,
      userMessageKey: "errors.serialError",
      technicalMessage: `android serial error (${code}): ${message}`,
    });
  }
  if (fallback === "open") {
    return createMamepError({
      code: "TCP_OPEN_FAILED",
      category: "transport",
      retryable: true,
      userMessageKey: "errors.tcpOpenFailed",
      technicalMessage: `android tcp open failed (${code}): ${message}`,
    });
  }
  return createMamepError({
    code: "TCP_CONNECTION_FAILED",
    category: "connection",
    retryable: true,
    userMessageKey: "errors.tcpConnectionFailed",
    technicalMessage: `android tcp connection failed (${code}): ${message}`,
  });
}

/** 从未知抛出物提取错误码/消息（Capacitor 原生 reject 的形态：Error 带 code 或纯字符串）。 */
export function toNativeBridgeError(cause: unknown): NativeBridgeError {
  if (typeof cause === "string") {
    return { code: "UNKNOWN", message: cause };
  }
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return {
      code: typeof code === "string" && code.length > 0 ? code : "UNKNOWN",
      message: cause.message,
    };
  }
  const record = cause as { code?: unknown; message?: unknown } | null;
  const code = typeof record?.code === "string" ? record.code : "UNKNOWN";
  const message =
    typeof record?.message === "string" ? record.message : String(cause);
  return { code, message };
}

/** 能力错误：Android 串口枚举/打开不可用（能力矩阵如实声明时使用）。 */
export function serialUnsupportedError(technicalMessage: string): MamepError {
  return createMamepError({
    code: "SERIAL_UNSUPPORTED",
    category: "capability",
    retryable: false,
    userMessageKey: "errors.serialEnumerationUnsupported",
    technicalMessage,
  });
}

/** 串口链路参数不受支持（bnudRate/dataBits/stopBits/parity/flowControl）。 */
export function serialParameterUnsupportedError(reason: string): MamepError {
  return createMamepError({
    code: "SERIAL_PARAMETER_UNSUPPORTED",
    category: "validation",
    retryable: false,
    userMessageKey: "errors.serialParameterUnsupported",
    technicalMessage: `android serial parameters unsupported: ${reason}`,
  });
}

/** 打开串口失败（原生侧拒绝/异常）。 */
export function serialOpenFailedError(technicalMessage: string): MamepError {
  return createMamepError({
    code: "SERIAL_OPEN_FAILED",
    category: "transport",
    retryable: true,
    userMessageKey: "errors.serialOpenFailed",
    technicalMessage: `android serial open failed: ${technicalMessage}`,
  });
}
