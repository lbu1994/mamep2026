#!/usr/bin/env node
/**
 * Modbus 从站共享核心（RTU / TCP 从站单一事实源）。
 *
 * 提取自 scripts/modbus-slave/modbus-rtu-slave.mjs 的协议/规则/日志部分，供
 * modbus-rtu-slave.mjs 与 modbus-tcp-slave.mjs 共同复用，避免规则漂移：
 * - 功能码 / 异常码常量与 CRC16（算法与 packages/protocol-modbus 一致，唯一权威）；
 * - DEFAULT_RULES：8 个默认地址区间（与 DEFAULT_MOCK_RULES 一一对应）；
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
export const FUNCTION_READ_COILS = 0x01;
export const FUNCTION_READ_DISCRETE_INPUTS = 0x02;
export const FUNCTION_READ_HOLDING = 0x03;
export const FUNCTION_READ_INPUT_REGISTERS = 0x04;
export const FUNCTION_WRITE_MULTIPLE_COILS = 0x0f;
export const FUNCTION_WRITE_MULTIPLE = 0x10;
/** 自定义功能码（ADR-043 E-4 示例插件）：0x65 读 / 0x66 写连续寄存器。 */
export const CUSTOM_READ_FUNCTION = 0x65;
export const CUSTOM_WRITE_FUNCTION = 0x66;

/** FC01/FC02 单次请求最大读取位（Modbus 规范 2000）。 */
export const MAX_READ_BITS_QUANTITY = 2000;
/** FC0F 单次请求最大写入线圈数（Modbus 规范 1968）。 */
export const MAX_WRITE_COILS_QUANTITY = 1968;
/** FC04/FC03 单次请求最大读取寄存器数（ADR-030）。 */
export const MAX_READ_QUANTITY = 125;

// ---------------------------------------------------------------------------
// 表类型（ADR-043 E-1：基础表与保持寄存器地址空间可重叠）
// ---------------------------------------------------------------------------
export const TABLE_TYPE_HOLDING = "holding";
export const TABLE_TYPE_COIL = "coil";
export const TABLE_TYPE_DISCRETE_INPUT = "discrete-input";
export const TABLE_TYPE_INPUT_REGISTER = "input-register";
/** 合法表类型集合（normalizeRules 校验用）。 */
export const TABLE_TYPES = new Set([
  TABLE_TYPE_HOLDING,
  TABLE_TYPE_COIL,
  TABLE_TYPE_DISCRETE_INPUT,
  TABLE_TYPE_INPUT_REGISTER,
]);

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
 * - 0x0800–0x080f 多寄存器区（must-multi）：单读/单写回异常 0x02，多读/多写正常
 *   （模拟真实设备「某些寄存器必须连续读写」，ADR-030）
 * - 0x0900–0x090f 写忽略区：读/写均成功回执，但写入不实际落盘（读回仍为旧值）
 * - 基础表（ADR-043 E-1，含 tableType，地址空间与保持寄存器 0x0000–0x000f 重叠）：
 *   coil（FC01 读 / FC0F 写正常）、discrete-input（FC02 只读，写回异常 0x02）、
 *   input-register（FC04 只读，写回异常 0x02）。
 *   与 DEFAULT_MOCK_BASIC_TABLE_SCENARIOS 一一对应。
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
  {
    // ADR-030：单读/单写回异常 0x02；多读/多写正常（必须连续读写）。
    start: 0x0800,
    end: 0x080f,
    read: { kind: "normal" },
    write: { kind: "normal" },
    mustMulti: true,
  },
  {
    start: 0x0900,
    end: 0x090f,
    read: { kind: "normal" },
    write: { kind: "write-ignore" },
  },
  // 基础表（ADR-043 E-1）：地址空间与保持寄存器 0x0000–0x000f 重叠，靠 tableType 区分。
  {
    tableType: TABLE_TYPE_COIL,
    start: 0x0000,
    end: 0x000f,
    read: { kind: "normal" },
    write: { kind: "normal" },
  },
  {
    tableType: TABLE_TYPE_DISCRETE_INPUT,
    start: 0x0000,
    end: 0x000f,
    read: { kind: "normal" },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
  },
  {
    tableType: TABLE_TYPE_INPUT_REGISTER,
    start: 0x0000,
    end: 0x000f,
    read: { kind: "normal" },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
  },
];

/**
 * 归一化配置中的行为描述（read/write 字段）：
 *   "normal"                            → { kind: "normal" }
 *   "no-response"                       → { kind: "no-response" }
 *   "write-ignore"                      → { kind: "write-ignore" }
 *   { "exception": <code> }             → { kind: "exception", exceptionCode }
 *   { "writeValueGate": n }             → { kind: "write-value-gate", maxValue }
 *   { "writeIgnore": true }             → { kind: "write-ignore" }
 *   { "delayedResponse": ms }           → { kind: "delayed-response", delayMs }（扩展）
 *   { "splitResponse": { chunkSize, chunkDelayMs } }
 *                                        → { kind: "split-response", ... }（扩展）
 */
export function normalizeBehavior(value, fieldName) {
  if (typeof value === "string") {
    if (value === "normal") return { kind: "normal" };
    if (value === "no-response") return { kind: "no-response" };
    if (value === "write-ignore") return { kind: "write-ignore" };
    throw new Error(
      `${fieldName} 行为 "${value}" 无效（应为 "normal" / "no-response" / "write-ignore" / { "exception": n } / { "writeValueGate": n } / { "writeIgnore": true } / { "delayedResponse": ms } / { "splitResponse": {...} }）`,
    );
  }
  if (value && typeof value === "object") {
    if (typeof value.exception === "number") {
      return { kind: "exception", exceptionCode: value.exception };
    }
    if (typeof value.writeValueGate === "number") {
      return { kind: "write-value-gate", maxValue: value.writeValueGate };
    }
    if (value.writeIgnore === true) {
      return { kind: "write-ignore" };
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
    `${fieldName} 行为无效（应为 "normal" / "no-response" / "write-ignore" / { "exception": n } / { "writeValueGate": n } / { "writeIgnore": true } / { "delayedResponse": ms } / { "splitResponse": {...} }）`,
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
    if (rule.tableType !== undefined && !TABLE_TYPES.has(rule.tableType)) {
      throw new Error(
        `rules[${index}].tableType 无效（应为 ${[...TABLE_TYPES].join("/")}）`,
      );
    }
    return {
      start: rule.start & 0xffff,
      end: rule.end & 0xffff,
      read: normalizeBehavior(rule.read ?? "normal", `rules[${index}].read`),
      write: normalizeBehavior(
        rule.write ?? "normal",
        `rules[${index}].write`,
      ),
      // ADR-030：must-multi 区（单读/单写异常，多读/多写正常）。
      ...(rule.mustMulti === true ? { mustMulti: true } : {}),
      // ADR-043 E-1：表类型专用规则（基础表与保持寄存器地址空间可重叠）。
      ...(rule.tableType !== undefined ? { tableType: rule.tableType } : {}),
    };
  });
}

/**
 * 命中地址所在规则（顺序匹配，第一条命中生效）；未命中返回 null（回退正常行为）。
 * 表类型专用规则优先于通用规则（ADR-043 E-1：基础表与保持寄存器地址空间可重叠）。
 */
export function matchRule(rules, address, tableType = TABLE_TYPE_HOLDING) {
  // 先匹配该表类型专用规则。
  for (const rule of rules) {
    if (
      rule.tableType === tableType &&
      address >= rule.start &&
      address <= rule.end
    ) {
      return rule;
    }
  }
  // 再回退通用规则（未声明 tableType）。
  for (const rule of rules) {
    if (
      rule.tableType === undefined &&
      address >= rule.start &&
      address <= rule.end
    ) {
      return rule;
    }
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

// ---------------------------------------------------------------------------
// ASCII 字符串区（2026-09-14）
// ---------------------------------------------------------------------------
/**
 * 从站内置 ASCII 字符串样例区（保持寄存器）：
 * - 地址 0x0010–0x001F 共 16 个连续寄存器 = 32 个字符；
 * - 该区间**不命中任何规则** → 按「规则外回退正常行为」读写均正常（无需新增规则）；
 * - 编码语义与应用的 String 数据类型完全一致（ADR-030）：ASCII、每寄存器 2 字符、
 *   高字节在前、不足补空格（权威：packages/data-conversion/src/multi-register.ts 的
 *   decodeAscii / parseCompositeString）；
 * - 用途：验证「连续寄存器可读出正常 ASCII 字符串」。真实端口 e2e 经 UI（范围行 + Type=String）
 *   断言；两份从站配置（modbus-slave.config.json / modbus-tcp-slave.config.json）的 registers
 *   初值须与本常量保持一致（JSON 无法引用常量，改动须同步，见 scripts/modbus-slave/README.md）。
 */
export const ASCII_STRING_REGION = {
  start: 0x0010,
  registerCount: 16,
  text: "MAMEP2026 MODBUS ASCII STRING OK",
};

/** ASCII 文本 → 寄存器值数组（高字节在前；奇数长度补空格；非 ASCII 抛错）。 */
export function asciiToRegisters(text) {
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0xff) {
      throw new Error(
        `ASCII 字符串区不支持非 ASCII 字符: ${JSON.stringify(ch)}`,
      );
    }
  }
  const values = [];
  for (let i = 0; i < text.length; i += 2) {
    const hi = text.charCodeAt(i);
    const lo = i + 1 < text.length ? text.charCodeAt(i + 1) : 0x20;
    values.push(((hi & 0xff) << 8) | (lo & 0xff));
  }
  return values;
}

/** 寄存器值数组 → ASCII 文本（与 data-conversion 的 decodeAscii 同语义）。 */
export function registersToAscii(values) {
  let out = "";
  for (const value of values) {
    out += String.fromCharCode((value >> 8) & 0xff, value & 0xff);
  }
  return out;
}

/** 字符串区寄存器值数组（配置校验 / 自测种子用）。 */
export function asciiStringRegisters() {
  return asciiToRegisters(ASCII_STRING_REGION.text);
}

/**
 * 字符串区「读响应」的 PDU 部分 hex（`<fc> <byteCount> <data…>`，不含从站地址/unitId）——
 * 自测断言用；RTU 侧调用方在结果前拼从站地址。
 */
export function asciiStringReadPduHex(values = asciiStringRegisters()) {
  const data = values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]);
  return [FUNCTION_READ_HOLDING, data.length, ...data]
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

/**
 * 位打包读辅助（FC01/FC02，ADR-043 E-1）：逐位取 map 值（非 0 视为 1），LSB 在前。
 * @param {Map<number, number>} map 位值存储（coil/离散输入）
 * @param {number} address 起始地址
 * @param {number} quantity 读取位数
 * @returns {Uint8Array} 位打包数据（byteCount = ceil(quantity/8)）
 */
export function packRawBits(map, address, quantity) {
  const byteCount = Math.ceil(quantity / 8);
  const data = new Uint8Array(byteCount);
  for (let i = 0; i < quantity; i += 1) {
    const value = map.get((address + i) & 0xffff) ?? 0;
    if (value !== 0) {
      const index = i >> 3;
      data[index] = (data[index] ?? 0) | (1 << (i & 7));
    }
  }
  return data;
}

/**
 * 位打包写辅助（FC0F，ADR-043 E-1）：values 为 0/1，byteCount=ceil(n/8)，字节内 LSB 在前。
 * @param {Uint8Array} data 请求中的位打包数据（由调用方定位）
 * @param {number} startOffset data 中位数据偏移（RTU=7 / TCP=8）
 * @param {number} byteCount 请求携带的 byteCount
 * @param {number} quantity 写入位数
 * @returns {number[]} 每位的 0/1 数组
 */
export function unpackRawBits(data, startOffset, byteCount, quantity) {
  const values = [];
  for (let i = 0; i < quantity; i += 1) {
    const byteIndex = i >> 3;
    const bitIndex = i & 7;
    const byte = byteIndex < byteCount ? (data[startOffset + byteIndex] ?? 0) : 0;
    values.push((byte >> bitIndex) & 1);
  }
  return values;
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
