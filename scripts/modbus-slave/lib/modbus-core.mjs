#!/usr/bin/env node
/**
 * Modbus 从站共享核心（RTU / TCP 从站单一事实源）。
 *
 * 提取自 scripts/modbus-slave/modbus-rtu-slave.mjs 的协议/规则/日志部分，供
 * modbus-rtu-slave.mjs 与 modbus-tcp-slave.mjs 共同复用，避免规则漂移：
 * - 功能码 / 异常码常量与 CRC16（算法与 packages/protocol-modbus 一致，唯一权威）；
 * - DEFAULT_RULES：7 个默认地址区间（与 DEFAULT_MOCK_RULES 一一对应）；
 * - 规则归一化（normalizeBehavior/normalizeRules）、顺序匹配（matchRule）；
 * - 寄存器解析（parseRegisters）；
 * - 响应投递（sendWithBehavior）：normal / 全局 responseDelayMs / 扩展行为
 *   `delayed-response`（按区间延迟响应）与 `split-response`（响应拆段发送，
 *   模拟半包/粘包）。扩展行为为真实从站配置使用，不在 DEFAULT_MOCK_RULES 内。
 *
 * 说明：本模块为独立 .mjs（protocol-modbus 包 exports 指向 TS 源，无法直接导入），
 * 算法与常量以 packages/protocol-modbus/src/crc16.ts、rtu-frame.ts 为权威，修改须同步。
 */

// ---------------------------------------------------------------------------
// 常量（与 packages/protocol-modbus/src/rtu-frame.ts 一致，唯一权威）
// ---------------------------------------------------------------------------
export const FUNCTION_READ_HOLDING = 0x03;
export const FUNCTION_WRITE_MULTIPLE = 0x10;

export const EXCEPTION_ILLEGAL_FUNCTION = 0x01;
export const EXCEPTION_ILLEGAL_DATA_ADDRESS = 0x02;
export const EXCEPTION_ILLEGAL_DATA_VALUE = 0x03;

export const EXCEPTION_NAMES = {
  0x01: "非法功能",
  0x02: "非法数据地址",
  0x03: "非法数据值",
};

// ---------------------------------------------------------------------------
// CRC-16/Modbus（多项式 0xA001，初始 0xFFFF，低字节在前）
// 算法与 packages/protocol-modbus/src/crc16.ts 一致。
// ---------------------------------------------------------------------------
export function crc16Modbus(bytes, start = 0, end = bytes.length) {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

/** 将 CRC 附加到帧尾（低字节在前）。 */
export function appendCrc(body) {
  const crc = crc16Modbus(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body, 0);
  frame[body.length] = crc & 0xff;
  frame[body.length + 1] = (crc >> 8) & 0xff;
  return frame;
}

/** 十六进制显示："01 03 00 00 00 01 84 0A"。 */
export function toHex(bytes) {
  return Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0").toUpperCase(),
  ).join(" ");
}

// ---------------------------------------------------------------------------
// 日志（分级 + 帧十六进制开关）
// ---------------------------------------------------------------------------
export const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = "info", logFrames = true) {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  return {
    frames: logFrames === true,
    debug: (...args) => {
      if (threshold <= LOG_LEVELS.debug) console.log(...args);
    },
    info: (...args) => {
      if (threshold <= LOG_LEVELS.info) console.log(...args);
    },
    warn: (...args) => {
      if (threshold <= LOG_LEVELS.warn) console.warn(...args);
    },
    error: (...args) => {
      if (threshold <= LOG_LEVELS.error) console.error(...args);
    },
  };
}

// ---------------------------------------------------------------------------
// 默认地址区间规则（与 DEFAULT_MOCK_RULES 一一对应）
// ---------------------------------------------------------------------------
/**
 * - 0x0000–0x000f 正常区：读/写均成功
 * - 0x0100–0x010f 只读区：读成功，写回异常 0x02
 * - 0x0200–0x020f 只写区：写成功，读回异常 0x02
 * - 0x0300–0x030f 寄存器不存在：读/写均回异常 0x02
 * - 0x0400–0x040f 非法数据值：读成功；写值须 ≤ 0x7FFF，超出回异常 0x03
 * - 0x0500–0x050f 不支持功能：读/写均回异常 0x01
 * - 0x0600–0x060f 设备无响应：读/写均不回任何帧
 */
export const DEFAULT_RULES = [
  {
    start: 0x0000,
    end: 0x000f,
    read: { kind: "normal" },
    write: { kind: "normal" },
  },
  {
    start: 0x0100,
    end: 0x010f,
    read: { kind: "normal" },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
  },
  {
    start: 0x0200,
    end: 0x020f,
    read: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
    write: { kind: "normal" },
  },
  {
    start: 0x0300,
    end: 0x030f,
    read: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
  },
  {
    start: 0x0400,
    end: 0x040f,
    read: { kind: "normal" },
    write: { kind: "write-value-gate", maxValue: 0x7fff },
  },
  {
    start: 0x0500,
    end: 0x050f,
    read: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_FUNCTION },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_FUNCTION },
  },
  {
    start: 0x0600,
    end: 0x060f,
    read: { kind: "no-response" },
    write: { kind: "no-response" },
  },
];

/**
 * 归一化配置中的行为描述（read/write 字段）：
 *   "normal"                            → { kind: "normal" }
 *   "no-response"                       → { kind: "no-response" }
 *   { "exception": <code> }             → { kind: "exception", exceptionCode }
 *   { "writeValueGate": n }             → { kind: "write-value-gate", maxValue }
 *   { "delayedResponse": ms }           → { kind: "delayed-response", delayMs }（扩展）
 *   { "splitResponse": { chunkSize, chunkDelayMs } }
 *                                        → { kind: "split-response", ... }（扩展）
 */
export function normalizeBehavior(value, fieldName) {
  if (typeof value === "string") {
    if (value === "normal") return { kind: "normal" };
    if (value === "no-response") return { kind: "no-response" };
    throw new Error(
      `${fieldName} 行为 "${value}" 无效（应为 "normal" / "no-response" / { "exception": n } / { "writeValueGate": n } / { "delayedResponse": ms } / { "splitResponse": {...} }）`,
    );
  }
  if (value && typeof value === "object") {
    if (typeof value.exception === "number") {
      return { kind: "exception", exceptionCode: value.exception };
    }
    if (typeof value.writeValueGate === "number") {
      return { kind: "write-value-gate", maxValue: value.writeValueGate };
    }
    if (typeof value.delayedResponse === "number") {
      return { kind: "delayed-response", delayMs: value.delayedResponse };
    }
    if (value.splitResponse && typeof value.splitResponse === "object") {
      const { chunkSize, chunkDelayMs = 0 } = value.splitResponse;
      if (typeof chunkSize !== "number" || chunkSize < 1 || chunkSize > 256) {
        throw new Error(
          `${fieldName} splitResponse.chunkSize 无效（应为 1..256 的数字）`,
        );
      }
      if (typeof chunkDelayMs !== "number" || chunkDelayMs < 0) {
        throw new Error(
          `${fieldName} splitResponse.chunkDelayMs 无效（应为 ≥0 的数字）`,
        );
      }
      return { kind: "split-response", chunkSize, chunkDelayMs };
    }
  }
  throw new Error(
    `${fieldName} 行为无效（应为 "normal" / "no-response" / { "exception": n } / { "writeValueGate": n } / { "delayedResponse": ms } / { "splitResponse": {...} }）`,
  );
}

export function normalizeRules(rules) {
  if (rules === undefined) return DEFAULT_RULES;
  if (!Array.isArray(rules)) throw new Error("配置 rules 必须是数组");
  return rules.map((rule, index) => {
    if (
      !rule ||
      typeof rule.start !== "number" ||
      typeof rule.end !== "number"
    ) {
      throw new Error(`rules[${index}] 缺少 start/end 数值字段`);
    }
    return {
      start: rule.start & 0xffff,
      end: rule.end & 0xffff,
      read: normalizeBehavior(rule.read ?? "normal", `rules[${index}].read`),
      write: normalizeBehavior(
        rule.write ?? "normal",
        `rules[${index}].write`,
      ),
    };
  });
}

/** 命中地址所在规则（顺序匹配，第一条命中生效）；未命中返回 null（回退正常行为）。 */
export function matchRule(rules, address) {
  for (const rule of rules) {
    if (address >= rule.start && address <= rule.end) return rule;
  }
  return null;
}

/**
 * 解析配置的 registers：{"<十进制地址>": <值>} → Map<number, number>（& 0xffff）。
 * 缺省返回空 Map。
 */
export function parseRegisters(registers) {
  const map = new Map();
  if (registers && typeof registers === "object") {
    for (const [key, value] of Object.entries(registers)) {
      const address = Number.parseInt(key, 10) & 0xffff;
      map.set(address, Number(value) & 0xffff);
    }
  }
  return map;
}

/**
 * 按行为投递响应帧（扩展行为支持拆段/延迟）。
 *
 * @param {function(Uint8Array): void} write 实际写一帧（或一段）到传输的回调
 * @param {Uint8Array} frame 完整响应帧（RTU 含 CRC；TCP 为 MBAP 帧）
 * @param {object} [behavior] 命中规则的行为（缺省 normal）
 * @param {{ baseDelayMs?: number }} [options] 全局响应延迟（normal 时生效）
 */
export function sendWithBehavior(write, frame, behavior = { kind: "normal" }, { baseDelayMs = 0 } = {}) {
  if (behavior.kind === "delayed-response") {
    setTimeout(() => write(frame), behavior.delayMs);
    return;
  }
  if (behavior.kind === "split-response") {
    const { chunkSize, chunkDelayMs } = behavior;
    for (let i = 0; i < frame.length; i += chunkSize) {
      const chunk = frame.subarray(i, i + chunkSize);
      const offset = i / chunkSize;
      setTimeout(() => write(chunk), offset * chunkDelayMs);
    }
    return;
  }
  if (baseDelayMs > 0) {
    setTimeout(() => write(frame), baseDelayMs);
    return;
  }
  write(frame);
}

/** 构造异常响应体（不含 CRC/长度，追加由各传输层完成）：RTU 用 appendCrc，TCP 用 MBAP 包装。 */
export function exceptionBody(slaveOrUnitId, functionCode, exceptionCode) {
  return Uint8Array.from([slaveOrUnitId, functionCode | 0x80, exceptionCode]);
}
