/**
 * 串口库错误 → 统一错误模型（docs/TECH_DESIGN.md §34.3.17）。
 * 综合错误类型 / 错误码 / OS errno / 受控字符串匹配，不得只依赖完整错误字符串；
 * 无法识别的错误映射为通用串口错误，同时保留原始技术信息用于诊断。
 */
import { createMamepError, type MamepError } from "@mamep2026/domain";

interface ErrorLike {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly canceled?: unknown;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 打开失败兜底：SERIAL_OPEN_FAILED；读写关闭兜底：SERIAL_ERROR。 */
type FallbackKind = "open" | "io";

function toMamepError(cause: unknown, fallback: FallbackKind): MamepError {
  const name = readString((cause as ErrorLike | undefined)?.name);
  const code = readString((cause as ErrorLike | undefined)?.code);
  const message = cause instanceof Error ? cause.message : String(cause);
  const normalized = message.toLowerCase();

  // 设备拔出：serialport 断开错误（DisconnectedError，来自 @serialport/stream）。
  if (name === "DisconnectedError") {
    return createMamepError({
      code: "SERIAL_DEVICE_DISCONNECTED",
      category: "connection",
      retryable: false,
      userMessageKey: "errors.serialDeviceDisconnected",
      technicalMessage: message,
      cause,
    });
  }

  // 端口不存在（ENOENT / ENXIO 等）。
  if (code === "ENOENT" || code === "ENXIO" || code === "ENODEV") {
    return createMamepError({
      code: "SERIAL_NOT_FOUND",
      category: "connection",
      retryable: false,
      userMessageKey: "errors.serialNotFound",
      technicalMessage: `serial port not found: ${message}`,
      cause,
    });
  }

  // 权限不足。
  if (code === "EACCES" || code === "EPERM") {
    return createMamepError({
      code: "SERIAL_PERMISSION_DENIED",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.serialPermissionDenied",
      technicalMessage: `serial permission denied: ${message}`,
      cause,
    });
  }

  // 端口占用。
  if (code === "EBUSY" || code === "EAGAIN") {
    return createMamepError({
      code: "SERIAL_PORT_IN_USE",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.serialPortInUse",
      technicalMessage: `serial port already in use: ${message}`,
      cause,
    });
  }

  // 取消（库错误带 canceled 标记）。
  if ((cause as ErrorLike | undefined)?.canceled === true) {
    return createMamepError({
      code: "SERIAL_CANCELLED",
      category: "cancellation",
      retryable: false,
      userMessageKey: "errors.cancelled",
      technicalMessage: `serial operation cancelled: ${message}`,
      cause,
    });
  }

  // 受控字符串匹配（errno 缺失时的补充，不替代 errno 判断）。
  if (
    normalized.includes("access denied") ||
    normalized.includes("already open") ||
    normalized.includes("in use") ||
    normalized.includes("resource busy") ||
    normalized.includes("port is opening")
  ) {
    return createMamepError({
      code: "SERIAL_PORT_IN_USE",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.serialPortInUse",
      technicalMessage: message,
      cause,
    });
  }
  if (
    normalized.includes("no such file") ||
    normalized.includes("not found") ||
    normalized.includes("does not exist") ||
    normalized.includes("no such device")
  ) {
    return createMamepError({
      code: "SERIAL_NOT_FOUND",
      category: "connection",
      retryable: false,
      userMessageKey: "errors.serialNotFound",
      technicalMessage: message,
      cause,
    });
  }
  if (
    normalized.includes("unsupported") ||
    normalized.includes("not supported") ||
    normalized.includes("invalid baudrate") ||
    normalized.includes("not a valid baudrate") ||
    normalized.includes("invalid argument")
  ) {
    return createMamepError({
      code: "SERIAL_PARAMETER_UNSUPPORTED",
      category: "validation",
      retryable: false,
      userMessageKey: "errors.serialParameterUnsupported",
      technicalMessage: message,
      cause,
    });
  }

  // 兜底。
  if (fallback === "open") {
    return createMamepError({
      code: "SERIAL_OPEN_FAILED",
      category: "transport",
      retryable: true,
      userMessageKey: "errors.serialOpenFailed",
      technicalMessage: message,
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

/** 通用映射（读/写/关闭）。 */
export function mapSerialError(cause: unknown): MamepError {
  return toMamepError(cause, "io");
}

/** 打开专用映射（未知打开错误 → SERIAL_OPEN_FAILED）。 */
export function mapOpenError(cause: unknown): MamepError {
  return toMamepError(cause, "open");
}

/* ------------------------------------------------------------------ *
 * Node TCP（docs/TECH_DESIGN.md §34.3.17 模式；用户决策：unitId 0~255）
 * ------------------------------------------------------------------ */

/** 打开失败兜底：TCP_OPEN_FAILED；读写关闭兜底：TCP_CONNECTION_FAILED。 */
type TcpFallbackKind = "open" | "io";

function toTcpMamepError(
  cause: unknown,
  fallback: TcpFallbackKind,
): MamepError {
  const code = readString((cause as ErrorLike | undefined)?.code);
  const message = cause instanceof Error ? cause.message : String(cause);
  const normalized = message.toLowerCase();

  // 端口占用：本机地址已被占用（客户端 connect 罕见，但与串口占用语义对齐）。
  if (code === "EADDRINUSE") {
    return createMamepError({
      code: "TCP_PORT_IN_USE",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.tcpPortInUse",
      technicalMessage: `tcp port already in use: ${message}`,
      cause,
    });
  }

  // 连接失败：拒绝/不可达/未解析/超时/对端重置/管道断开。
  if (
    code === "ECONNREFUSED" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE"
  ) {
    return createMamepError({
      code: "TCP_CONNECTION_FAILED",
      category: "connection",
      retryable: true,
      userMessageKey: "errors.tcpConnectionFailed",
      technicalMessage: `tcp connection failed: ${message}`,
      cause,
    });
  }

  // 受控字符串匹配（errno 缺失时的补充，不替代 errno 判断）。
  if (
    normalized.includes("address already in use") ||
    normalized.includes("port already in use")
  ) {
    return createMamepError({
      code: "TCP_PORT_IN_USE",
      category: "permission",
      retryable: false,
      userMessageKey: "errors.tcpPortInUse",
      technicalMessage: message,
      cause,
    });
  }
  if (
    normalized.includes("connection refused") ||
    normalized.includes("no such host") ||
    normalized.includes("host unreachable") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("getaddrinfo")
  ) {
    return createMamepError({
      code: "TCP_CONNECTION_FAILED",
      category: "connection",
      retryable: true,
      userMessageKey: "errors.tcpConnectionFailed",
      technicalMessage: message,
      cause,
    });
  }

  // 兜底。
  if (fallback === "open") {
    return createMamepError({
      code: "TCP_OPEN_FAILED",
      category: "transport",
      retryable: true,
      userMessageKey: "errors.tcpOpenFailed",
      technicalMessage: message,
      cause,
    });
  }
  return createMamepError({
    code: "TCP_CONNECTION_FAILED",
    category: "connection",
    retryable: true,
    userMessageKey: "errors.tcpConnectionFailed",
    technicalMessage: message,
    cause,
  });
}

/** TCP 通用映射（读/写/关闭）。 */
export function mapTcpError(cause: unknown): MamepError {
  return toTcpMamepError(cause, "io");
}

/** TCP 打开专用映射（未知打开错误 → TCP_OPEN_FAILED）。 */
export function mapTcpOpenError(cause: unknown): MamepError {
  return toTcpMamepError(cause, "open");
}
