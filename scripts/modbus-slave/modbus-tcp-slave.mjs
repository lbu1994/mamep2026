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
  DEFAULT_RULES,
  EXCEPTION_ILLEGAL_DATA_VALUE,
  EXCEPTION_ILLEGAL_FUNCTION,
  EXCEPTION_NAMES,
  FUNCTION_READ_HOLDING,
  FUNCTION_WRITE_MULTIPLE,
  createLogger,
  matchRule,
  normalizeRules,
  parseRegisters,
  sendWithBehavior,
  toHex,
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
    if (conn && typeof conn.host === "string" && typeof conn.port === "number") {
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

/** 加载并校验配置；未提供 --config 时读取同目录 config（不存在则内建默认）。 */
function loadConfig(configPath) {
  const target = loadDefaultTcpTarget();
  const config = {
    ...DEFAULT_CONFIG,
    host: target.host,
    port: target.port,
    unitId: target.unitId,
    registers: {},
    rules: DEFAULT_RULES,
  };

  const effectivePath =
    configPath ?? (existsSync(DEFAULT_CONFIG_PATH) ? DEFAULT_CONFIG_PATH : null);
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
  if (!Object.prototype.hasOwnProperty.call(
    // 共享 LOG_LEVELS 未导出到本文件，直接用 createLogger 的校验键集合
    { debug: 1, info: 1, warn: 1, error: 1 },
    config.logLevel,
  )) {
    throw new Error(
      `配置 logLevel "${config.logLevel}" 无效（应为 debug/info/warn/error）`,
    );
  }

  config.registers = parseRegisters(config.registers);
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
    return typeof address === "object" && address !== null ? address.port : null;
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
      // normal / write-value-gate（读按正常处理）：返回当前寄存器值（默认 0）。
      const value = this.getRegister(address);
      this.log.debug(
        `读 ${addrHex} → 0x${value.toString(16).toUpperCase().padStart(4, "0")}`,
      );
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([
          FUNCTION_READ_HOLDING,
          0x02,
          (value >> 8) & 0xff,
          value & 0xff,
        ]),
        behavior,
      );
      return;
    }

    if (functionCode === FUNCTION_WRITE_MULTIPLE) {
      const behavior = rule?.write ?? { kind: "normal" };
      // PDU：fc + addr(2) + qty(2) + byteCount(1) + value(2)
      const value = ((pdu[6] ?? 0) << 8) | (pdu[7] ?? 0);
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
      if (behavior.kind === "write-value-gate" && value > behavior.maxValue) {
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
      this.registers.set(address & 0xffff, value & 0xffff);
      this.log.debug(
        `写 ${addrHex} ← 0x${value.toString(16).toUpperCase().padStart(4, "0")}（寄存器 ${this.registers.size} 个）`,
      );
      this.respond(
        socket,
        tid,
        unitId,
        Uint8Array.from([
          FUNCTION_WRITE_MULTIPLE,
          (address >> 8) & 0xff,
          address & 0xff,
          0x00,
          0x01,
        ]),
        behavior,
      );
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

function encodeReadPdu(address) {
  return Uint8Array.from([
    FUNCTION_READ_HOLDING,
    (address >> 8) & 0xff,
    address & 0xff,
    0x00,
    0x01,
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
  // 自测使用内建默认配置（registers 空）+ 临时端口，保证断言确定性。
  // 规则 = 默认 7 区 + 扩展 2 区（延迟/分片，见配置说明）。
  const SELF_TEST_RULES = [
    ...DEFAULT_RULES,
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
  ];
  const config = {
    ...DEFAULT_CONFIG,
    host: "127.0.0.1",
    port: 0,
    unitId: 1,
    responseDelayMs: 0,
    registers: new Map(),
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
  await run("FC03 读 0x0000 返回当前值 0", encodeReadPdu(0x0000), "03 02 00 00");
  // ② FC10 写后回执 + 重读验证值已更新
  await run("FC10 写 0x0001=0x1234 回执", encodeWritePdu(0x0001, 0x1234), "10 00 01 00 01");
  await run("FC03 重读 0x0001 值已更新为 0x1234", encodeReadPdu(0x0001), "03 02 12 34");
  // ③ 只读区：写回异常 0x02
  await run("写 0x0100（只读区）→ 异常 0x02", encodeWritePdu(0x0100, 1), "90 02");
  // ④ 只写区：读回异常 0x02
  await run("读 0x0200（只写区）→ 异常 0x02", encodeReadPdu(0x0200), "83 02");
  // ⑤ 寄存器不存在：读/写均异常 0x02
  await run("读 0x0300（不存在区）→ 异常 0x02", encodeReadPdu(0x0300), "83 02");
  await run("写 0x0300（不存在区）→ 异常 0x02", encodeWritePdu(0x0300, 1), "90 02");
  // ⑥ 非法数据值：超限异常 0x03、合法成功
  await run("写 0x0400=0x8000（超 0x7FFF）→ 异常 0x03", encodeWritePdu(0x0400, 0x8000), "90 03");
  await run("写 0x0400=0x1234（合法）→ 回执", encodeWritePdu(0x0400, 0x1234), "10 04 00 00 01");
  await run("读 0x0400（非法值区）→ 正常返回当前值", encodeReadPdu(0x0400), "03 02 12 34");
  // ⑦ 不支持功能：读/写均异常 0x01
  await run("读 0x0500（不支持功能区）→ 异常 0x01", encodeReadPdu(0x0500), "83 01");
  await run("写 0x0500（不支持功能区）→ 异常 0x01", encodeWritePdu(0x0500, 1), "90 01");
  // ⑧ 未知功能码 0x06 → 异常 0x01
  await run(
    "未知功能码 0x06 → 异常 0x01",
    Uint8Array.from([0x06, 0x00, 0x00, 0x00, 0x01]),
    "86 01",
  );
  // ⑨ no-response 区间 → 无响应（验证超时/重试路径）
  await runNoResponse("读 0x0600（no-response 区）→ 无响应", encodeReadPdu(0x0600));
  await runNoResponse("写 0x0600（no-response 区）→ 无响应", encodeWritePdu(0x0600, 1));
  // ⑩ unitId 不匹配 → 忽略无响应
  await runNoResponse("unitId 不匹配（unit=2）→ 忽略无响应", encodeReadPdu(0x0001), 2);
  // ⑪ 扩展：split-response 拆段发送 → 主站仍正确组帧
  await run("读 0x0800（分片区）→ 拆段后仍返回当前值", encodeReadPdu(0x0800), "03 02 00 00");
  // ⑫ 扩展：delayed-response（1500ms > 短超时 400ms）→ 无响应（迟到路径）
  await runNoResponse("读 0x0700（延迟区）→ 短超时内无响应", encodeReadPdu(0x0700));
  // ⑬ 边界：规则外地址 0xFFFF 回退正常行为
  await run("读 0xFFFF（规则外）→ 回退正常返回 0", encodeReadPdu(0xffff), "03 02 00 00");
  await run("写 0xFFFF=0x1234（规则外）→ 回执", encodeWritePdu(0xffff, 0x1234), "10 FF FF 00 01");
  await run("重读 0xFFFF → 0x1234", encodeReadPdu(0xffff), "03 02 12 34");

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
      if (args.configPath === undefined) throw new Error("--config 缺少文件路径");
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
