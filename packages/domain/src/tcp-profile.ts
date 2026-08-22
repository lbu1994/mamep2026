/**
 * Modbus TCP 连接配置（docs/TECH_DESIGN.md §18.4、ADR-020 后续 Node TCP Adapter）。
 * - host 视为不透明字符串原样传递，不解析/不归一化 IP（§34.3.4 路径/主机名不解析原则）；
 * - unitId 为 MBAP 单元标识：0~255，默认 0（2026-08-23 确认）；0=广播（MVP 不实现广播写入）；
 * - autoReconnect 为 P1 能力（UI 灰显禁用，2026-08-23 确认），默认 false；
 * - interRequestDelayMs 为内部字段（请求间隔，兼作 WP 轮询间隔），不入表单。
 */
import { createMamepError, type MamepError } from "./errors";
import { fail, ok, type Result } from "./result";
import { defaultConfig } from "./config";
import type { ConnectionProfileId } from "./workspace-model";

export interface TcpConnectionProfile {
  id: ConnectionProfileId;
  name: string;
  protocol: "tcp";
  host: string;
  port: number;
  /** MBAP 单元标识：0~255，默认 0（0=广播，MVP 不实现广播写入）。 */
  unitId: number;
  /** 连接超时（ms）。 */
  connectTimeoutMs: number;
  /** 单次请求响应超时（ms）。 */
  requestTimeoutMs: number;
  /** 首次请求失败后的额外重试次数。 */
  retryCount: number;
  /** 自动重连：P1 能力（UI 灰显禁用，2026-08-23 确认），默认 false。 */
  autoReconnect: boolean;
  /** 请求间隔，兼作 WP 轮询间隔（内部字段，不入表单）。 */
  interRequestDelayMs: number;
}

function invalid(
  code: string,
  userMessageKey: string,
  technicalMessage: string,
): MamepError {
  return createMamepError({
    code,
    category: "validation",
    userMessageKey,
    technicalMessage,
  });
}

function isOptionalPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isOptionalNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** 校验并构造 TCP 连接配置；缺失的扩展字段使用默认值（沿用值对象校验风格）。 */
export function createTcpConnectionProfile(
  input: unknown,
): Result<TcpConnectionProfile> {
  if (typeof input !== "object" || input === null) {
    return fail(
      invalid(
        "TCP_HOST_INVALID",
        "errors.tcpHostInvalid",
        "tcp connection profile must be an object",
      ),
    );
  }
  const candidate = input as {
    id?: unknown;
    name?: unknown;
    host?: unknown;
    port?: unknown;
    unitId?: unknown;
    connectTimeoutMs?: unknown;
    requestTimeoutMs?: unknown;
    retryCount?: unknown;
    autoReconnect?: unknown;
    interRequestDelayMs?: unknown;
  };

  if (
    typeof candidate.host !== "string" ||
    candidate.host.trim().length === 0
  ) {
    return fail(
      invalid(
        "TCP_HOST_INVALID",
        "errors.tcpHostInvalid",
        `host must be a non-empty string, got ${String(candidate.host)}`,
      ),
    );
  }

  if (
    typeof candidate.port !== "number" ||
    !Number.isInteger(candidate.port) ||
    candidate.port < 1 ||
    candidate.port > 65535
  ) {
    return fail(
      invalid(
        "TCP_PORT_OUT_OF_RANGE",
        "errors.tcpPortOutOfRange",
        `port must be an integer within 1..65535, got ${String(candidate.port)}`,
      ),
    );
  }

  if (
    typeof candidate.unitId !== "number" ||
    !Number.isInteger(candidate.unitId) ||
    candidate.unitId < 0 ||
    candidate.unitId > 255
  ) {
    return fail(
      invalid(
        "TCP_UNIT_ID_OUT_OF_RANGE",
        "errors.tcpUnitIdOutOfRange",
        `unitId must be an integer within 0..255, got ${String(candidate.unitId)}`,
      ),
    );
  }

  const defaults = defaultConfig.tcp;
  return ok({
    id: (
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : ""
    ) as ConnectionProfileId,
    name:
      typeof candidate.name === "string" && candidate.name.length > 0
        ? candidate.name
        : "TCP",
    protocol: "tcp",
    host: candidate.host,
    port: candidate.port,
    unitId: candidate.unitId,
    connectTimeoutMs: isOptionalPositiveInt(candidate.connectTimeoutMs)
      ? candidate.connectTimeoutMs
      : defaults.connectTimeoutMs,
    requestTimeoutMs: isOptionalPositiveInt(candidate.requestTimeoutMs)
      ? candidate.requestTimeoutMs
      : defaults.requestTimeoutMs,
    retryCount: isOptionalNonNegativeInt(candidate.retryCount)
      ? candidate.retryCount
      : defaults.retryCount,
    autoReconnect:
      typeof candidate.autoReconnect === "boolean"
        ? candidate.autoReconnect
        : defaults.autoReconnect,
    interRequestDelayMs: isOptionalNonNegativeInt(candidate.interRequestDelayMs)
      ? candidate.interRequestDelayMs
      : defaults.interRequestDelayMs,
  });
}
