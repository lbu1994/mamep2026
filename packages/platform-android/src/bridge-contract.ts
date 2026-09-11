/**
 * Android 桥契约（ADR-050 §5、§6）。
 *
 * 与 HostMessage v1（packages/platform-api）同安全姿态：**版本化方法白名单 + 入参/回包 Zod 校验**。
 * 原生侧只做「打开 / 写字节 / 来字节 / 关闭」，绝不理解 Modbus 语义；字节以 base64 字符串传递
 * （Capacitor `JSObject` 为 JSON 语义，不支持 ArrayBuffer）。
 *
 * 非法回包一律拒绝（不静默降级），错误码 `BRIDGE_PAYLOAD_INVALID`。
 */
import { z } from "zod";
import { createMamepError, fail, type MamepError, type Result } from "@mamep2026/domain";

/** 桥方法白名单（新增方法必须同时在此登记，便于评审与测试守住面）。 */
export const MAMEP_TRANSPORT_METHODS = [
  "listSerialPorts",
  "openSerial",
  "openTcp",
  "write",
  "close",
  "setKeepScreenOn",
] as const;

/** 桥事件白名单。 */
export const MAMEP_TRANSPORT_EVENTS = ["data", "closed", "error"] as const;

export type MamepTransportMethod = (typeof MAMEP_TRANSPORT_METHODS)[number];
export type MamepTransportEvent = (typeof MAMEP_TRANSPORT_EVENTS)[number];

/** openTcp 入参（由 TcpConnectionProfile 映射；host/port 原样透传，不在桥层解析）。 */
export const bridgeOpenTcpParamsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  connectTimeoutMs: z.number().int().positive(),
});
export type BridgeOpenTcpParams = z.infer<typeof bridgeOpenTcpParamsSchema>;

/** write 入参：base64 编码的字节。 */
export const bridgeWriteParamsSchema = z.object({
  data: z.string().min(1),
});
export type BridgeWriteParams = z.infer<typeof bridgeWriteParamsSchema>;

/**
 * listSerialPorts 回包（USB 串口枚举，Phase 2）。
 * `deviceName` 是原生侧的唯一标识（如 `/dev/bus/usb/001/002`，重新插拔会变），
 * `label` 仅用于展示（驱动/厂商名 + 端口号）。
 */
export const bridgeSerialPortSchema = z.object({
  deviceName: z.string().min(1),
  label: z.string(),
  vendorId: z.number().int().nonnegative().optional(),
  productId: z.number().int().nonnegative().optional(),
  serialNumber: z.string().optional(),
});
export type BridgeSerialPort = z.infer<typeof bridgeSerialPortSchema>;

export const bridgeListSerialPortsResultSchema = z.object({
  ports: z.array(bridgeSerialPortSchema),
});
export type BridgeListSerialPortsResult = z.infer<
  typeof bridgeListSerialPortsResultSchema
>;

/**
 * openSerial 入参（USB-RS485，Phase 2）。
 * 链路参数直接来自 `RtuConnectionProfile`（无映射歧义）；`deviceName` 由 handle.id 透传。
 */
export const bridgeOpenSerialParamsSchema = z.object({
  deviceName: z.string().min(1),
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(7), z.literal(8)]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  parity: z.enum(["none", "even", "odd"]),
  flowControl: z.enum(["off", "rts-cts", "xon-xoff"]),
});
export type BridgeOpenSerialParams = z.infer<
  typeof bridgeOpenSerialParamsSchema
>;

/** setKeepScreenOn 入参（ADR-050 Phase 3 KeepAwake）：持续轮询/追踪期间保持屏幕常亮。 */
export const bridgeKeepScreenOnParamsSchema = z.object({
  enabled: z.boolean(),
});
export type BridgeKeepScreenOnParams = z.infer<
  typeof bridgeKeepScreenOnParamsSchema
>;

/** data 事件回包：原生侧整帧聚合后单次投递。 */
export const bridgeDataEventSchema = z.object({
  data: z.string(),
  bytes: z.number().int().nonnegative().optional(),
});
export type BridgeDataEventPayload = z.infer<typeof bridgeDataEventSchema>;

/** closed 事件回包（远端断开 / 本地关闭 / 读线程退出）。 */
export const bridgeClosedEventSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

/** error 事件回包（读/写/系统级错误）。 */
export const bridgeErrorEventSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type BridgeErrorEventPayload = z.infer<typeof bridgeErrorEventSchema>;

/** 桥契约违规（回包形状非法）：内部错误，不向用户暴露原始形状。 */
export function bridgeContractViolation(
  technicalMessage: string,
  cause?: unknown,
): MamepError {
  return createMamepError({
    code: "BRIDGE_PAYLOAD_INVALID",
    category: "internal",
    retryable: false,
    userMessageKey: "errors.bridgePayloadInvalid",
    technicalMessage,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** 校验回包（失败→BRIDGE_PAYLOAD_INVALID；不静默降级）。 */
export function parseBridgePayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  context: string,
): Result<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return fail(
      bridgeContractViolation(
        `${context}: unexpected bridge payload ${JSON.stringify(payload)?.slice(0, 200)}`,
      ),
    );
  }
  return { ok: true, value: parsed.data };
}

/** 校验出参（发送前守住契约，避免把非法参数送进原生）。 */
export function buildBridgeParams<T>(
  schema: z.ZodType<T>,
  params: unknown,
  context: string,
): Result<T> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return fail(
      bridgeContractViolation(
        `${context}: invalid bridge params (${parsed.error.issues
          .map((issue) => issue.path.join(".") || "(root)")
          .join(", ")})`,
      ),
    );
  }
  return { ok: true, value: parsed.data };
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 解码表：非法字符为 -1（避免依赖 atob/btoa，Node 与 WebView 行为一致）。 */
const BASE64_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

/** 字节 → base64（无填充以外的修饰，便于原生 Base64.decode 直接使用）。 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET.charAt((chunk >> 18) & 63);
    output += BASE64_ALPHABET.charAt((chunk >> 12) & 63);
    output += second === undefined ? "=" : BASE64_ALPHABET.charAt((chunk >> 6) & 63);
    output += third === undefined ? "=" : BASE64_ALPHABET.charAt(chunk & 63);
  }
  return output;
}

/** base64 → 字节；非法字符 / 长度非法一律失败（不静默丢弃）。 */
export function decodeBase64ToBytes(value: string): Result<Uint8Array> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: new Uint8Array(0) };
  }
  if (trimmed.length % 4 !== 0) {
    return fail(
      bridgeContractViolation(`base64 payload length ${trimmed.length} is not a multiple of 4`),
    );
  }
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((trimmed.length / 4) * 3 - padding);
  let offset = 0;
  for (let index = 0; index < trimmed.length; index += 4) {
    const values: number[] = [];
    for (let slot = 0; slot < 4; slot += 1) {
      const character = trimmed.charAt(index + slot);
      if (character === "=") {
        values.push(0);
        continue;
      }
      const decoded = BASE64_DECODE_TABLE[character.charCodeAt(0)] ?? -1;
      if (decoded < 0) {
        return fail(bridgeContractViolation(`illegal base64 character ${JSON.stringify(character)}`));
      }
      values.push(decoded);
    }
    const [a = 0, b = 0, c = 0, d = 0] = values;
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < output.length) output[offset] = (chunk >> 16) & 0xff;
    offset += 1;
    if (offset < output.length) output[offset] = (chunk >> 8) & 0xff;
    offset += 1;
    if (offset < output.length) output[offset] = chunk & 0xff;
    offset += 1;
  }
  return { ok: true, value: output };
}
