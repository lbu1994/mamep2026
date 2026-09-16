#!/usr/bin/env node
/**
 * 独立 Modbus TCP 从站（模拟设备）——监听本地回环 TCP 端口（默认 127.0.0.1:1502）。
 *
 * 用途：在没有真实 Modbus TCP 设备的开发环境，配合本地回环真实 net 端口，让
 * Mamep2026 桌面端（Electron / VSCode）走真实 TCP 协议栈完成调试闭环。
 *
 * 行为与仓库 dev Mock 模拟设备完全一致（唯一权威：scripts/modbus-slave/lib/
 * modbus-core.mjs 的 DEFAULT_RULES + packages/platform-web/src/mock-scenarios.ts
 * 的 DEFAULT_MOCK_RULES）：
 * - MBAP 分帧：按 Length 组帧（半包/粘包缓冲），Transaction ID 原样回显；
 * - FC03 读单个保持寄存器、FC0x10 写单个保持寄存器、异常响应、不支持功能码、
 *   地址区间规则（与 RTU 从站共用同一套规则，含扩展 delayed-response / split-response）；
 * - 健壮性：协议标识不匹配丢弃、unitId 不匹配忽略、Length 非法重同步。
 *
 * 默认 host/port/unitId 来自 config/connections.json 的 tcp-local-slave（唯一事实源，
 * ADR-023）；registers/rules 来自本脚本同目录 modbus-tcp-slave.config.json（不存在则
 * 用内建默认配置）。可用 --config / --host / --port 覆盖。
 *
 * 用法：
 *   node scripts/modbus-slave/modbus-tcp-slave.mjs                        # 默认读取 config/connections.json + 同目录 config
 *   node scripts/modbus-slave/modbus-tcp-slave.mjs --config <path.json>   # 自定义配置文件
 *   node scripts/modbus-slave/modbus-tcp-slave.mjs --self-test            # 回环自测（临时端口，无需预先起服务）
 *   node scripts/modbus-slave/modbus-tcp-slave.mjs --help
 */
import * as net from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASCII_STRING_REGION,
  CUSTOM_READ_FUNCTION,
  CUSTOM_WRITE_FUNCTION,
  DEFAULT_RULES,
  EXCEPTION_ILLEGAL_DATA_ADDRESS,
  EXCEPTION_ILLEGAL_DATA_VALUE,
  EXCEPTION_ILLEGAL_FUNCTION,
  EXCEPTION_NAMES,
  FUNCTION_READ_COILS,
  FUNCTION_READ_DISCRETE_INPUTS,
  FUNCTION_READ_HOLDING,
  FUNCTION_READ_INPUT_REGISTERS,
  FUNCTION_WRITE_MULTIPLE,
  FUNCTION_WRITE_MULTIPLE_COILS,
  LOG_LEVELS,
  TABLE_TYPE_COIL,
  TABLE_TYPE_DISCRETE_INPUT,
  TABLE_TYPE_INPUT_REGISTER,
  asciiStringReadPduHex,
  asciiToRegisters,
  createLogger,
  matchRule,
  normalizeRules,
  packRawBits,
  parseRegisters,
  sendWithBehavior,
  toHex,
  unpackRawBits,
} from "./lib/modbus-core.mjs";

// ---------------------------------------------------------------------------
// MBAP 常量
// ---------------------------------------------------------------------------
const PROTOCOL_IDENTIFIER = 0x0000;

// 仓库根（本文件位于 scripts/modbus-slave/，上跳两级）。
const REPO_ROOT = join(import.meta.dirname, "..", "..");

// 默认配置文件：脚本同目录下的 modbus-tcp-slave.config.json。
const DEFAULT_CONFIG_PATH = join(
  import.meta.dirname,
  "modbus-tcp-slave.config.json",
);

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 1502,
  unitId: 1,
  responseDelayMs: 0,
  logLevel: "info",
  logFrames: true,
  registers: {},
  coils: {},
  inputs: {},
  inputRegisters: {},
  rules: DEFAULT_RULES,
};

/**
 * 从 config/connections.json 读取 tcp-local-slave（唯一事实源）作为默认 host/port/unitId。
 * 读取失败回退内建默认（127.0.0.1:1502 / unitId 1）。
 */
function loadDefaultTcpTarget() {
  try {
    const raw = JSON.parse(
      readFileSync(join(REPO_ROOT, "config", "connections.json"), "utf8"),
    );
    const conn =
      (raw.connections ?? []).find((c) => c.id === "tcp-local-slave") ??
      (raw.connections ?? []).find((c) => c.protocol === "tcp");
    if (
      conn &&
      typeof conn.host === "string" &&
      typeof conn.port === "number"
    ) {
      return {
        host: conn.host,
        port: conn.port,
        unitId: typeof conn.unitId === "number" ? conn.unitId : 1,
      };
    }
  } catch {
    // 读取失败使用内建默认。
  }
  return { host: "127.0.0.1", port: 1502, unitId: 1 };
}

function assertConfigNumber(value, fieldName, { min, max }) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`配置 ${fieldName} 必须是数字`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`配置 ${fieldName} 不能小于 ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`配置 ${fieldName} 不能大于 ${max}`);
  }
}

/** 加载并校验配置；未提供 --config 时读取同目录 config（不存在则内建默认）。返回的 registers/coils/inputs/inputRegisters 为 Map。 */
function loadConfig(configPath) {
  const target = loadDefaultTcpTarget();
  const config = {
    ...DEFAULT_CONFIG,
    host: target.host,
    port: target.port,
    unitId: target.unitId,
    registers: {},
    coils: {},
    inputs: {},
    inputRegisters: {},
    rules: DEFAULT_RULES,
  };

  const effectivePath =
    configPath ??
    (existsSync(DEFAULT_CONFIG_PATH) ? DEFAULT_CONFIG_PATH : null);
  if (effectivePath) {
    if (!existsSync(effectivePath)) {
      throw new Error(`配置文件不存在: ${effectivePath}`);
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(effectivePath, "utf8"));
    } catch (err) {
      throw new Error(`配置文件解析失败: ${err.message}`);
    }
    Object.assign(config, raw);
  }

  if (typeof config.host !== "string" || config.host.length === 0) {
    throw new Error("配置 host 必须是非空字符串");
  }
  assertConfigNumber(config.port, "port", { min: 1, max: 65535 });
  assertConfigNumber(config.unitId, "unitId", { min: 0, max: 255 });
  assertConfigNumber(config.responseDelayMs, "responseDelayMs", { min: 0 });
  if (!Object.prototype.hasOwnProperty.call(LOG_LEVELS, config.logLevel)) {
    throw new Error(
      `配置 logLevel "${config.logLevel}" 无效（应为 debug/info/warn/error）`,
    );
  }

  config.registers = parseRegisters(config.registers);
  config.coils = parseRegisters(config.coils);
  config.inputs = parseRegisters(config.inputs);
  config.inputRegisters = parseRegisters(config.inputRegisters);
  config.rules = normalizeRules(config.rules);
  return config;
}

// ---------------------------------------------------------------------------
// TCP 从站
// ---------------------------------------------------------------------------
class ModbusTcpSlave {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.registers = new Map();
    for (const [address, value] of config.registers) {
      this.registers.set(address & 0xffff, value & 0xffff);
    }
    this.coils = new Map();
    for (const [address, value] of config.coils) {
      this.coils.set(address & 0xffff, value & 0xffff);
    }
    this.inputs = new Map();
    for (const [address, value] of config.inputs) {
      this.inputs.set(address & 0xffff, value & 0xffff);
    }
    this.inputRegisters = new Map();
    for (const [address, value] of config.inputRegisters) {
      this.inputRegisters.set(address & 0xffff, value & 0xffff);
    }
    this.server = null;
    this.sockets = new Set();
  }

  setRegister(address, value) {
    this.registers.set(address & 0xffff, value & 0xffff);
  }

  getRegister(address) {
    return this.registers.get(address & 0xffff) ?? 0;
  }

  /** 监听端口；resolve 后可用 port() 读取实际端口（自测用 0 随机端口）。 */
  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleSocket(socket));
      this.server.once("error", reject);
      this.server.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  /** 实际绑定端口（server.address().port；未启动返回 null）。 */
  port() {
    if (!this.server) return null;
    const address = this.server.address();
    return typeof address === "object" && address !== null
      ? address.port
      : null;
  }

  handleSocket(socket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {
      // 客户端断开：忽略。
    });
    const buffer = [];
    socket.on("data", (chunk) => {
      for (const byte of chunk) buffer.push(byte);
      while (true) {
        if (buffer.length < 7) return;
        const length = ((buffer[4] ?? 0) << 8) | (buffer[5] ?? 0);
        if (length < 1 || length > 254) {
          this.log.debug(`Length 非法（${length}），丢首字节重同步`);
          buffer.shift();
          continue;
        }
        const frameLength = 6 + length;
        if (buffer.length < frameLength) return;
        const frame = Uint8Array.from(buffer.splice(0, frameLength));
        this.handleFrame(socket, frame);
      }
    });
  }

  /** 构造 MBAP 帧（tid/proto=0/length/unit + pdu），无 CRC。 */
  buildMbapFrame(tid, unitId, pdu) {
    const length = 1 + pdu.length;
    const frame = Buffer.alloc(6 + length);
    frame.writeUInt16BE(tid & 0xffff, 0);
    frame.writeUInt16BE(PROTOCOL_IDENTIFIER, 2);
    frame.writeUInt16BE(length, 4);
    frame[6] = unitId;
    Buffer.from(pdu).copy(frame, 7);
    return frame;
  }

  /** 协议处理（镜像 MockTransport.handleFrame 的行为语义 + 共享规则）。 */
  handleFrame(socket, frame) {
    if (this.log.frames) this.log.debug(`[RX] ${toHex(frame)}`);
    const tid = (((frame[0] ?? 0) << 8) | (frame[1] ?? 0)) & 0xffff;
    const protocolId = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
    if (protocolId !== PROTOCOL_IDENTIFIER) {
      this.log.debug(
        `协议标识不匹配（收到 0x${protocolId.toString(16)}），忽略`,
      );
      return;
    }
    const unitId = frame[6] ?? 0;
    if (unitId !== this.config.unitId) {
      this.log.debug(
        `unitId 不匹配（收到 ${unitId}，期望 ${this.config.unitId}），忽略`,
      );
      return;
    }
    const functionCode = frame[7] ?? 0;
    const pdu = frame.subarray(7);
    const address = ((pdu[1] ?? 0) << 8) | (pdu[2] ?? 0);
    const rule = matchRule(this.config.rules, address);
    const addrHex = `0x${address.toString(16).toUpperCase().padStart(4, "0")}`;

    if (functionCode === FUNCTION_READ_HOLDING) {
      const behavior = rule?.read ?? { kind: "normal" };
      if (behavior.kind === "no-response") {
        this.log.info(`no-response：读 ${addrHex} 不回帧`);
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([functionCode | 0x80, behavior.exceptionCode]),
          behavior,
        );
        return;
      }
      // PDU：fc + addr(2) + qty(2)
      const quantity = ((pdu[3] ?? 0) << 8) | (pdu[4] ?? 0);
      // must-multi 区（ADR-030）：单读返回非法数据地址异常。
      if (rule?.mustMulti === true && quantity === 1) {
        this.logException(
          functionCode,
          EXCEPTION_ILLEGAL_DATA_ADDRESS,
          addrHex,
        );
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([
            functionCode | 0x80,
            EXCEPTION_ILLEGAL_DATA_ADDRESS,
          ]),
          behavior,
        );
        return;
      }
      // normal / write-value-gate（读按正常处理）：返回 quantity 个寄存器值（默认 0）。
      const values = [];
      for (let i = 0; i < quantity; i++) {
        values.push(this.getRegister(address + i));
      }
      this.log.debug(
        `读 ${addrHex} × ${quantity} → [${values
          .map((v) => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`)
          .join(", ")}]`,
      );
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([
          FUNCTION_READ_HOLDING,
          quantity * 2,
          ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
        ]),
        behavior,
      );
      return;
    }

    if (functionCode === FUNCTION_WRITE_MULTIPLE) {
      const behavior = rule?.write ?? { kind: "normal" };
      // PDU：fc + addr(2) + qty(2) + byteCount(1) + values(2N)
      const quantity = ((pdu[3] ?? 0) << 8) | (pdu[4] ?? 0);
      const values = [];
      for (let i = 0; i < quantity; i++) {
        values.push(((pdu[6 + i * 2] ?? 0) << 8) | (pdu[7 + i * 2] ?? 0));
      }
      const value = values[0] ?? 0;
      if (behavior.kind === "no-response") {
        this.log.info(`no-response：写 ${addrHex} 不回帧`);
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([functionCode | 0x80, behavior.exceptionCode]),
          behavior,
        );
        return;
      }
      // must-multi 区（ADR-030）：单写返回非法数据地址异常。
      if (rule?.mustMulti === true && quantity === 1) {
        this.logException(
          functionCode,
          EXCEPTION_ILLEGAL_DATA_ADDRESS,
          addrHex,
        );
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([
            functionCode | 0x80,
            EXCEPTION_ILLEGAL_DATA_ADDRESS,
          ]),
          behavior,
        );
        return;
      }
      if (
        behavior.kind === "write-value-gate" &&
        values.some((v) => v > behavior.maxValue)
      ) {
        this.log.warn(
          `写 ${addrHex} = 0x${value.toString(16).toUpperCase()} 超出上限 0x${behavior.maxValue.toString(16).toUpperCase()}，回异常 0x03`,
        );
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([
            FUNCTION_WRITE_MULTIPLE | 0x80,
            EXCEPTION_ILLEGAL_DATA_VALUE,
          ]),
          behavior,
        );
        return;
      }
      if (behavior.kind === "write-ignore") {
        // 写忽略区：回执成功但**不实际写入**（模拟设备「写不生效」——写入后回读仍为旧值）。
        this.log.warn(
          `写 ${addrHex} × ${quantity}（写忽略区：回执成功但不落盘）`,
        );
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([
            FUNCTION_WRITE_MULTIPLE,
            (address >> 8) & 0xff,
            address & 0xff,
            (quantity >> 8) & 0xff,
            quantity & 0xff,
          ]),
          behavior,
        );
        return;
      }
      for (let i = 0; i < quantity; i++) {
        this.registers.set((address + i) & 0xffff, (values[i] ?? 0) & 0xffff);
      }
      this.log.debug(
        `写 ${addrHex} × ${quantity} ← [${values
          .map((v) => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`)
          .join(", ")}]（寄存器 ${this.registers.size} 个）`,
      );
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([
          FUNCTION_WRITE_MULTIPLE,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ]),
        behavior,
      );
      return;
    }

    // FC01/FC02 读位（线圈/离散输入，ADR-043 E-1）：按表类型规则读位。
    if (
      functionCode === FUNCTION_READ_COILS ||
      functionCode === FUNCTION_READ_DISCRETE_INPUTS
    ) {
      const tableType =
        functionCode === FUNCTION_READ_COILS
          ? TABLE_TYPE_COIL
          : TABLE_TYPE_DISCRETE_INPUT;
      const readRule = matchRule(this.config.rules, address, tableType);
      const behavior = readRule?.read ?? { kind: "normal" };
      if (behavior.kind === "no-response") {
        this.log.info(`no-response：读 ${addrHex} 不回帧`);
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([functionCode | 0x80, behavior.exceptionCode]),
          behavior,
        );
        return;
      }
      const quantity = ((pdu[3] ?? 0) << 8) | (pdu[4] ?? 0);
      const map =
        functionCode === FUNCTION_READ_COILS ? this.coils : this.inputs;
      const data = packRawBits(map, address, quantity);
      this.log.debug(`读 ${addrHex} × ${quantity} 位 → [${toHex(data)}]`);
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([functionCode, data.length, ...data]),
        behavior,
      );
      return;
    }

    // FC04 读输入寄存器（ADR-043 E-1）：按 input-register 表类型规则读。
    if (functionCode === FUNCTION_READ_INPUT_REGISTERS) {
      const readRule = matchRule(
        this.config.rules,
        address,
        TABLE_TYPE_INPUT_REGISTER,
      );
      const behavior = readRule?.read ?? { kind: "normal" };
      if (behavior.kind === "no-response") {
        this.log.info(`no-response：读 ${addrHex} 不回帧`);
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([functionCode | 0x80, behavior.exceptionCode]),
          behavior,
        );
        return;
      }
      const quantity = ((pdu[3] ?? 0) << 8) | (pdu[4] ?? 0);
      const values = [];
      for (let i = 0; i < quantity; i++) {
        values.push(this.inputRegisters.get((address + i) & 0xffff) ?? 0);
      }
      this.log.debug(
        `读 ${addrHex} × ${quantity} → [${values
          .map((v) => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`)
          .join(", ")}]`,
      );
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([
          functionCode,
          quantity * 2,
          ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
        ]),
        behavior,
      );
      return;
    }

    // FC0F 写多线圈（ADR-043 E-1）：按 coil 表类型规则写（位打包）。
    if (functionCode === FUNCTION_WRITE_MULTIPLE_COILS) {
      const writeRule = matchRule(this.config.rules, address, TABLE_TYPE_COIL);
      const behavior = writeRule?.write ?? { kind: "normal" };
      const quantity = ((pdu[3] ?? 0) << 8) | (pdu[4] ?? 0);
      const byteCount = pdu[5] ?? 0;
      if (behavior.kind === "no-response") {
        this.log.info(`no-response：写 ${addrHex} 不回帧`);
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([functionCode | 0x80, behavior.exceptionCode]),
          behavior,
        );
        return;
      }
      const bits = unpackRawBits(pdu, 6, byteCount, quantity);
      if (behavior.kind === "write-ignore") {
        this.log.warn(
          `写 ${addrHex} × ${quantity}（写忽略区：回执成功但不落盘）`,
        );
      } else {
        for (let i = 0; i < quantity; i++) {
          this.coils.set((address + i) & 0xffff, bits[i] ?? 0);
        }
      }
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([
          FUNCTION_WRITE_MULTIPLE_COILS,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ]),
        behavior,
      );
      return;
    }

    // 自定义功能码（ADR-043 E-4）：0x65 读 / 0x66 写连续寄存器（走通用 holding 规则）。
    if (
      functionCode === CUSTOM_READ_FUNCTION ||
      functionCode === CUSTOM_WRITE_FUNCTION
    ) {
      const behavior =
        functionCode === CUSTOM_READ_FUNCTION
          ? (rule?.read ?? { kind: "normal" })
          : (rule?.write ?? { kind: "normal" });
      if (behavior.kind === "no-response") {
        this.log.info(
          `no-response：${functionCode === CUSTOM_READ_FUNCTION ? "读" : "写"} ${addrHex} 不回帧`,
        );
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([functionCode | 0x80, behavior.exceptionCode]),
          behavior,
        );
        return;
      }
      const quantity = ((pdu[3] ?? 0) << 8) | (pdu[4] ?? 0);
      if (functionCode === CUSTOM_READ_FUNCTION) {
        const values = [];
        for (let i = 0; i < quantity; i++) {
          values.push(this.getRegister(address + i));
        }
        this.log.debug(
          `读 ${addrHex} × ${quantity} → [${values
            .map((v) => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`)
            .join(", ")}]`,
        );
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([
            functionCode,
            quantity * 2,
            ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
          ]),
          behavior,
        );
      } else {
        for (let i = 0; i < quantity; i++) {
          const hi = pdu[6 + i * 2] ?? 0;
          const lo = pdu[7 + i * 2] ?? 0;
          this.registers.set((address + i) & 0xffff, ((hi << 8) | lo) & 0xffff);
        }
        this.log.debug(
          `写 ${addrHex} × ${quantity} ← [${Array.from(
            { length: quantity },
            (_, i) =>
              `0x${this.getRegister(address + i)
                .toString(16)
                .toUpperCase()
                .padStart(4, "0")}`,
          ).join(", ")}]`,
        );
        this.respond(
          socket,
          tid,
          unitId,
          Uint8Array.from([
            CUSTOM_WRITE_FUNCTION,
            (address >> 8) & 0xff,
            address & 0xff,
            (quantity >> 8) & 0xff,
            quantity & 0xff,
          ]),
          behavior,
        );
      }
      return;
    }

    // 不支持的功能码：回异常响应（0x01 非法功能）。
    this.log.warn(
      `不支持的功能码 0x${functionCode.toString(16).toUpperCase().padStart(2, "0")}，回异常 0x01`,
    );
    this.respond(
      socket,
      tid,
      unitId,
      Uint8Array.from([functionCode | 0x80, EXCEPTION_ILLEGAL_FUNCTION]),
      { kind: "normal" },
    );
  }

  logException(functionCode, exceptionCode, addrHex) {
    const fcHex = `0x${functionCode.toString(16).toUpperCase().padStart(2, "0")}`;
    const name = EXCEPTION_NAMES[exceptionCode] ?? `未知(${exceptionCode})`;
    this.log.warn(
      `异常 ${fcHex} @ ${addrHex} → 0x${exceptionCode.toString(16).padStart(2, "0")}（${name}）`,
    );
  }

  /** 按行为投递 MBAP 响应（normal 用 responseDelayMs；扩展延迟/拆段由 sendWithBehavior 处理）。 */
  respond(socket, tid, unitId, pdu, behavior = { kind: "normal" }) {
    const frame = this.buildMbapFrame(tid, unitId, pdu);
    const logWrite = (chunk) => {
      if (this.log.frames) this.log.debug(`[TX] ${toHex(chunk)}`);
      socket.write(Buffer.from(chunk));
    };
    sendWithBehavior(logWrite, frame, behavior, {
      baseDelayMs: this.config.responseDelayMs,
    });
  }

  close() {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      for (const socket of this.sockets) {
        try {
          socket.destroy();
        } catch {
          // 已关闭。
        }
      }
      this.sockets.clear();
      this.server.close(() => resolve());
    });
  }
}

// ---------------------------------------------------------------------------
// --self-test 回环自测：同进程开主站（临时端口）+ 从站，脚本化断言
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function encodeReadPdu(address, quantity = 1) {
  return Uint8Array.from([
    FUNCTION_READ_HOLDING,
    (address >> 8) & 0xff,
    address & 0xff,
    (quantity >> 8) & 0xff,
    quantity & 0xff,
  ]);
}

function encodeWritePdu(address, value) {
  return Uint8Array.from([
    FUNCTION_WRITE_MULTIPLE,
    (address >> 8) & 0xff,
    address & 0xff,
    0x00,
    0x01,
    0x02,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
}

/** FC01/FC02/FC04/FC65 读请求 PDU（与 FC03 同构）。 */
function encodeReadBitsPdu(functionCode, address, quantity = 1) {
  return Uint8Array.from([
    functionCode,
    (address >> 8) & 0xff,
    address & 0xff,
    (quantity >> 8) & 0xff,
    quantity & 0xff,
  ]);
}

/** FC0F 写多线圈请求 PDU（位打包，LSB 在前）。 */
function encodeWriteCoilsPdu(address, values) {
  const quantity = values.length;
  const byteCount = Math.ceil(quantity / 8);
  const pdu = new Uint8Array(6 + byteCount);
  pdu[0] = FUNCTION_WRITE_MULTIPLE_COILS;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (quantity >> 8) & 0xff;
  pdu[4] = quantity & 0xff;
  pdu[5] = byteCount & 0xff;
  for (let i = 0; i < quantity; i += 1) {
    if ((values[i] ?? 0) !== 0) {
      const index = 6 + (i >> 3);
      pdu[index] = (pdu[index] ?? 0) | (1 << (i & 7));
    }
  }
  return pdu;
}

/** FC66 自定义写请求 PDU（与 FC10 同构）。 */
function encodeCustomWritePdu(address, value) {
  return Uint8Array.from([
    CUSTOM_WRITE_FUNCTION,
    (address >> 8) & 0xff,
    address & 0xff,
    0x00,
    0x01,
    0x02,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
}

/** 构造主站请求函数：发送请求并等待一条完整 MBAP 应答帧（按 TID + Length 识别），
 *  超时返回 null（用于 no-response / delayed 断言）。迟到/不匹配 tid 丢弃继续等。 */
function createTcpMaster(socket) {
  let tid = 1;
  return (unitId, pdu, timeoutMs) =>
    new Promise((resolve) => {
      const currentTid = tid++;
      const buffer = [];
      let timer = null;
      let done = false;

      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.off("data", onData);
        resolve(result);
      };

      const onData = (chunk) => {
        for (const byte of chunk) buffer.push(byte);
        while (buffer.length >= 7) {
          const length = ((buffer[4] ?? 0) << 8) | (buffer[5] ?? 0);
          if (length < 1 || length > 254) {
            buffer.shift();
            continue;
          }
          const frameLength = 6 + length;
          if (buffer.length < frameLength) return;
          const frame = Uint8Array.from(buffer.splice(0, frameLength));
          const respTid = (((frame[0] ?? 0) << 8) | (frame[1] ?? 0)) & 0xffff;
          if (respTid !== currentTid) continue;
          finish(frame);
          return;
        }
      };

      socket.on("data", onData);
      timer = setTimeout(() => finish(null), timeoutMs);

      const mbap = Buffer.alloc(7);
      mbap.writeUInt16BE(currentTid, 0);
      mbap.writeUInt16BE(PROTOCOL_IDENTIFIER, 2);
      mbap.writeUInt16BE(1 + pdu.length, 4);
      mbap[6] = unitId;
      socket.write(Buffer.concat([mbap, Buffer.from(pdu)]));
    });
}

function assertFrame(actual, expectedHex) {
  if (actual === null) {
    return { ok: false, detail: "无响应（超时）" };
  }
  const expected = Uint8Array.from(
    expectedHex.split(" ").map((s) => Number.parseInt(s, 16)),
  );
  const pdu = actual.subarray(7);
  if (
    pdu.length !== expected.length ||
    !pdu.every((b, i) => b === expected[i])
  ) {
    return { ok: false, detail: `期望 ${toHex(expected)}，实际 ${toHex(pdu)}` };
  }
  return { ok: true, detail: toHex(pdu) };
}

async function runSelfTest() {
  // 自测使用内建默认配置 + 临时端口，保证断言确定性。
  // 规则 = 默认 7 区 + 扩展 2 区（延迟/分片，见配置说明）；
  // 保持寄存器预置 ASCII 字符串区（0x0010–0x001F，16 寄存器 = 32 字符）供字符串断言。
  const SELF_TEST_RULES = [
    // 扩展规则（延迟/分片）置于 DEFAULT_RULES 之前：分片区 0x0800 与 DEFAULT_RULES
    // 的 must-multi 区（0x0800）地址重叠，须让 split 规则优先命中，否则 mustMulti 抢先。
    {
      start: 0x0700,
      end: 0x070f,
      read: { kind: "delayed-response", delayMs: 1500 },
      write: { kind: "delayed-response", delayMs: 1500 },
    },
    {
      start: 0x0800,
      end: 0x080f,
      read: { kind: "split-response", chunkSize: 2, chunkDelayMs: 5 },
      write: { kind: "split-response", chunkSize: 2, chunkDelayMs: 5 },
    },
    ...DEFAULT_RULES,
  ];
  // ASCII 字符串区种子（0x0010 起 16 个寄存器 = 32 字符）。
  const stringRegisters = asciiToRegisters(ASCII_STRING_REGION.text);
  const registers = new Map();
  stringRegisters.forEach((value, index) => {
    registers.set(ASCII_STRING_REGION.start + index, value);
  });
  const config = {
    ...DEFAULT_CONFIG,
    host: "127.0.0.1",
    port: 0,
    unitId: 1,
    responseDelayMs: 0,
    registers,
    coils: new Map([[0x0000, 1]]),
    inputs: new Map([[0x0001, 1]]),
    inputRegisters: new Map([[0x0002, 0x1234]]),
    rules: SELF_TEST_RULES,
  };
  const verbose = process.env.MAMEP_SELFTEST_DEBUG === "1";
  const slave = new ModbusTcpSlave(
    config,
    createLogger(verbose ? "debug" : "warn", verbose),
  );
  console.log("[self-test] 启动 TCP 从站（临时端口）...");
  await slave.start();
  const port = slave.port();
  const master = net.createConnection({ host: "127.0.0.1", port });
  await new Promise((resolve, reject) => {
    master.once("connect", resolve);
    master.once("error", reject);
  });
  await sleep(50);
  const request = createTcpMaster(master);
  const unit = config.unitId;
  const TIMEOUT_MS = 400;
  const results = [];

  const run = async (name, pdu, expectedHex) => {
    const resp = await request(unit, pdu, TIMEOUT_MS);
    const r = assertFrame(resp, expectedHex);
    results.push({ name, ok: r.ok });
    console.log(
      `${r.ok ? "PASS" : "FAIL"}  ${name}${r.detail ? `  (${r.detail})` : ""}`,
    );
    await sleep(10);
  };

  const runNoResponse = async (name, pdu, sendUnitId = unit) => {
    const resp = await request(sendUnitId, pdu, TIMEOUT_MS);
    const ok = resp === null;
    results.push({ name, ok });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}  (${ok ? "无响应，符合预期" : `意外收到 ${toHex(resp.subarray(7))}`})`,
    );
    await sleep(10);
  };

  // ① FC03 读正常区（初始值 0）
  await run(
    "FC03 读 0x0000 返回当前值 0",
    encodeReadPdu(0x0000),
    "03 02 00 00",
  );
  // ② FC10 写后回执 + 重读验证值已更新
  await run(
    "FC10 写 0x0001=0x1234 回执",
    encodeWritePdu(0x0001, 0x1234),
    "10 00 01 00 01",
  );
  await run(
    "FC03 重读 0x0001 值已更新为 0x1234",
    encodeReadPdu(0x0001),
    "03 02 12 34",
  );
  // ③ 只读区：写回异常 0x02
  await run(
    "写 0x0100（只读区）→ 异常 0x02",
    encodeWritePdu(0x0100, 1),
    "90 02",
  );
  // ④ 只写区：读回异常 0x02
  await run("读 0x0200（只写区）→ 异常 0x02", encodeReadPdu(0x0200), "83 02");
  // ⑤ 寄存器不存在：读/写均异常 0x02
  await run("读 0x0300（不存在区）→ 异常 0x02", encodeReadPdu(0x0300), "83 02");
  await run(
    "写 0x0300（不存在区）→ 异常 0x02",
    encodeWritePdu(0x0300, 1),
    "90 02",
  );
  // ⑥ 非法数据值：超限异常 0x03、合法成功
  await run(
    "写 0x0400=0x8000（超 0x7FFF）→ 异常 0x03",
    encodeWritePdu(0x0400, 0x8000),
    "90 03",
  );
  await run(
    "写 0x0400=0x1234（合法）→ 回执",
    encodeWritePdu(0x0400, 0x1234),
    "10 04 00 00 01",
  );
  await run(
    "读 0x0400（非法值区）→ 正常返回当前值",
    encodeReadPdu(0x0400),
    "03 02 12 34",
  );
  // ⑦ 写忽略区：写入回执成功但不落盘（读回仍为旧值 0）
  await run(
    "写 0x0900=0x1234（写忽略区）→ 回执成功",
    encodeWritePdu(0x0900, 0x1234),
    "10 09 00 00 01",
  );
  await run(
    "读 0x0900（写忽略区）→ 仍为旧值 0（写入未落盘）",
    encodeReadPdu(0x0900),
    "03 02 00 00",
  );
  // ⑧ 不支持功能：读/写均异常 0x01
  await run(
    "读 0x0500（不支持功能区）→ 异常 0x01",
    encodeReadPdu(0x0500),
    "83 01",
  );
  await run(
    "写 0x0500（不支持功能区）→ 异常 0x01",
    encodeWritePdu(0x0500, 1),
    "90 01",
  );
  // ⑨ 未知功能码 0x06 → 异常 0x01
  await run(
    "未知功能码 0x06 → 异常 0x01",
    Uint8Array.from([0x06, 0x00, 0x00, 0x00, 0x01]),
    "86 01",
  );
  // ⑨ no-response 区间 → 无响应（验证超时/重试路径）
  await runNoResponse(
    "读 0x0600（no-response 区）→ 无响应",
    encodeReadPdu(0x0600),
  );
  await runNoResponse(
    "写 0x0600（no-response 区）→ 无响应",
    encodeWritePdu(0x0600, 1),
  );
  // ⑩ unitId 不匹配 → 忽略无响应
  await runNoResponse(
    "unitId 不匹配（unit=2）→ 忽略无响应",
    encodeReadPdu(0x0001),
    2,
  );
  // ⑪ 扩展：split-response 拆段发送 → 主站仍正确组帧
  await run(
    "读 0x0800（分片区）→ 拆段后仍返回当前值",
    encodeReadPdu(0x0800),
    "03 02 00 00",
  );
  // ⑫ 扩展：delayed-response（1500ms > 短超时 400ms）→ 无响应（迟到路径）
  await runNoResponse(
    "读 0x0700（延迟区）→ 短超时内无响应",
    encodeReadPdu(0x0700),
  );
  // ⑬ 边界：规则外地址 0xFFFF 回退正常行为
  await run(
    "读 0xFFFF（规则外）→ 回退正常返回 0",
    encodeReadPdu(0xffff),
    "03 02 00 00",
  );
  await run(
    "写 0xFFFF=0x1234（规则外）→ 回执",
    encodeWritePdu(0xffff, 0x1234),
    "10 FF FF 00 01",
  );
  await run("重读 0xFFFF → 0x1234", encodeReadPdu(0xffff), "03 02 12 34");
  // ⑭ FC01 读线圈 0x0000（预置 coil0=1）→ 位打包字节 bit0=1
  await run(
    "FC01 读线圈 0x0000 → 1",
    encodeReadBitsPdu(FUNCTION_READ_COILS, 0x0000),
    "01 01 01",
  );
  // ⑮ FC0F 写线圈 0x0000=0 → 回执；FC01 重读回 0
  await run(
    "FC0F 写线圈 0x0000=0 → 回执",
    encodeWriteCoilsPdu(0x0000, [0]),
    "0F 00 00 00 01",
  );
  await run(
    "FC01 重读线圈 0x0000 → 0",
    encodeReadBitsPdu(FUNCTION_READ_COILS, 0x0000),
    "01 01 00",
  );
  // ⑯ FC02 读离散输入 0x0001（预置 input1=1）→ 位打包字节 bit0=1
  await run(
    "FC02 读离散输入 0x0001 → 1",
    encodeReadBitsPdu(FUNCTION_READ_DISCRETE_INPUTS, 0x0001),
    "02 01 01",
  );
  // ⑰ FC04 读输入寄存器 0x0002（预置 inputReg2=0x1234）→ 0x1234
  await run(
    "FC04 读输入寄存器 0x0002 → 0x1234",
    encodeReadBitsPdu(FUNCTION_READ_INPUT_REGISTERS, 0x0002),
    "04 02 12 34",
  );
  // ⑱ FC65 读保持寄存器 0x0001（此前 FC10 写 0x1234）→ 0x1234
  await run(
    "FC65 读保持寄存器 0x0001 → 0x1234",
    encodeReadBitsPdu(CUSTOM_READ_FUNCTION, 0x0001),
    "65 02 12 34",
  );
  // ⑲ FC66 写保持寄存器 0x0003=0xABCD → 回执；FC03 重读回 0xABCD
  await run(
    "FC66 写保持寄存器 0x0003=0xABCD → 回执",
    encodeCustomWritePdu(0x0003, 0xabcd),
    "66 00 03 00 01",
  );
  await run("FC03 重读 0x0003 → 0xABCD", encodeReadPdu(0x0003), "03 02 AB CD");
  // ⑳ ASCII 字符串区（0x0010–0x001F，16 寄存器 = 32 字符）：一次连续读回正常 ASCII 字符串
  //    该区间未命中任何规则 → 回退正常行为（无需新增规则）。
  await run(
    `FC03 读 0x0010 连续 ${ASCII_STRING_REGION.registerCount} 寄存器 → ASCII 字符串 "${ASCII_STRING_REGION.text}"`,
    encodeReadPdu(ASCII_STRING_REGION.start, ASCII_STRING_REGION.registerCount),
    asciiStringReadPduHex(),
  );
  // ㉑ ASCII 字符串区部分读（前 4 个寄存器 = 前 8 字符）
  await run(
    "FC03 读 0x0010 前 4 寄存器 → 返回前 8 字符",
    encodeReadPdu(ASCII_STRING_REGION.start, 4),
    asciiStringReadPduHex(stringRegisters.slice(0, 4)),
  );

  master.destroy();
  await slave.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[self-test] ${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ""}`,
  );
  return failed === 0;
}

// ---------------------------------------------------------------------------
// CLI 与入口
// ---------------------------------------------------------------------------
function printHelp() {
  console.log(`用法:
  node scripts/modbus-slave/modbus-tcp-slave.mjs [选项]

选项:
  --config <path>     配置文件（JSON）。缺省自动读取脚本同目录 modbus-tcp-slave.config.json
                      （不存在则用内建默认）；host/port/unitId 缺省取 config/connections.json
                      的 tcp-local-slave。
  --host <h>          监听地址（默认 127.0.0.1）。
  --port <n>          监听端口（默认 1502）。
  --self-test         回环自测：同进程开主站（临时端口）+ 从站，脚本化断言全部行为清单。
  --help, -h          显示本帮助。

默认地址区间规则（与 RTU 从站 / dev Mock 一致）:
  0x0000–0x000f  正常区（读/写成功）        0x0100–0x010f  只读区（写回异常 0x02）
  0x0200–0x020f  只写区（读回异常 0x02）    0x0300–0x030f  不存在（读/写异常 0x02）
  0x0400–0x040f  非法值（写须 ≤ 0x7FFF，超限异常 0x03）
  0x0500–0x050f  不支持功能（读/写异常 0x01）  0x0600–0x060f  无响应（不回帧）
  0x0900–0x090f  写忽略区（读/写均回执成功，但写入不落盘——回读仍为旧值）
  基础表（ADR-043 E-1，靠 tableType 区分，地址空间与 0x0000–0x000f 重叠）:
    coil（FC01 读/FC0F 写正常）、discrete-input（FC02 只读，写异常 0x02）、
    input-register（FC04 只读，写异常 0x02）
  自定义功能码（ADR-043 E-4）: 0x65 读 / 0x66 写连续寄存器（走保持寄存器通用规则）
  规则外地址回退为正常行为。

扩展行为（配置文件规则可选，真实从站验证用，与 dev Mock 无关）:
  0x0700–0x070f  delayedResponse=1500（延迟响应 → 主站超时/迟到丢弃路径）
  0x0800–0x080f  splitResponse chunkSize=2（响应拆段发送 → 半包/粘包组帧健壮性）`);
}

function parseArgs(argv) {
  const args = {
    configPath: null,
    selfTest: false,
    host: null,
    port: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--config") {
      args.configPath = argv[++i];
      if (args.configPath === undefined)
        throw new Error("--config 缺少文件路径");
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--host") {
      args.host = argv[++i];
      if (args.host === undefined) throw new Error("--host 缺少地址");
    } else if (arg === "--port") {
      args.port = Number.parseInt(argv[++i], 10);
      if (Number.isNaN(args.port)) throw new Error("--port 缺少端口号");
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    printHelp();
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest()
      .then((ok) => process.exit(ok ? 0 : 1))
      .catch((err) => {
        console.error(`[self-test] 失败: ${err.message}`);
        process.exit(1);
      });
    return;
  }

  let config;
  try {
    config = loadConfig(args.configPath);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.host !== null) config.host = args.host;
  if (args.port !== null) config.port = args.port;

  const logger = createLogger(config.logLevel, config.logFrames);
  const slave = new ModbusTcpSlave(config, logger);

  slave
    .start()
    .then(() => {
      if (config.registers.size > 0) {
        const dump = [...config.registers.entries()]
          .map(
            ([a, v]) =>
              `0x${a.toString(16).toUpperCase().padStart(4, "0")}=0x${v.toString(16).toUpperCase().padStart(4, "0")}`,
          )
          .join(", ");
        logger.info(`初始寄存器: ${dump}`);
      }
      logger.info(
        `从站已启动: ${config.host}:${config.port}，unitId ${config.unitId}。Ctrl+C 退出。`,
      );
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      logger.info("收到退出信号，关闭服务...");
      slave
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

main();
