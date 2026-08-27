#!/usr/bin/env node
/**
 * 独立 Modbus RTU 从站（模拟设备）——挂载到配置串口（默认 COM5）。
 *
 * 用途：在没有真实 Modbus 设备的开发环境，配合 com0com 虚拟串口对（COM4 ↔ COM5），
 * 让 Mamep2026 应用（连接 COM4）走真实串口完成 RTU 调试闭环。
 *
 * 行为与仓库 dev Mock 模拟设备完全一致（唯一权威：
 * packages/platform-web/src/mock-transport.ts 的 MockTransport +
 * packages/platform-web/src/mock-scenarios.ts 的 DEFAULT_MOCK_RULES）：
 * - FC03 读单个保持寄存器：正常响应 [slave, 0x03, 0x02, valueHi, valueLo] + CRC（共 7 字节）
 * - FC0x10 写单个保持寄存器：写入后回执 [slave, 0x10, addrHi, addrLo, 0x00, 0x01] + CRC（共 8 字节）
 * - 异常响应：[slave, fc|0x80, exceptionCode] + CRC（共 5 字节）
 * - 不支持的功能码：回异常 0x01（非法功能）
 * - 地址区间 → 读写行为规则（默认与 DEFAULT_MOCK_RULES 一致）；规则外回退正常行为
 * - 寄存器存储：Map<address, value>（可配置初始值，默认 0）；读返回当前值、写更新并回执
 * - 健壮性：CRC 校验失败静默丢弃；从站地址不匹配忽略（广播地址 0 默认不支持）；
 *   RTU 分包缓冲（InterByteTimeoutParser 按 3.5 字符静默间隔组帧，不得假设一次收齐）；
 *   帧长度 < 8 字节直接忽略
 * - 响应延迟：config.responseDelayMs（默认 0），模拟设备处理延迟
 *
 * 串口库：使用仓库根 node_modules 已安装的 serialport@13（原生绑定已构建），本脚本不重装/不重建。
 * 说明：协议/规则/日志/CRC 复用共享模块 ./lib/modbus-core.mjs（RTU / TCP 从站单一事实源；
 * protocol-modbus 包 exports 指向 TS 源，独立 .mjs 无法直接导入）；算法与常量以
 * packages/protocol-modbus/src/crc16.ts、rtu-frame.ts 为唯一权威，修改须同步。
 * 扩展行为（配置文件规则可用，不在 DEFAULT_MOCK_RULES 内）：
 *   { "delayedResponse": ms } —— 按区间延迟响应（如 2500ms > 应用 1000ms 超时 × 重试总窗口
 *   2000ms → 迟到/丢弃路径；须落在重试总窗口外，RTU 无事务 ID 落在窗口内会被重试消费）
 *   { "splitResponse": { chunkSize, chunkDelayMs } } —— 响应拆段发送（半包/粘包组帧健壮性）
 *
 * 用法：
 *   node scripts/modbus-slave/modbus-rtu-slave.mjs                        # 默认读取同目录 modbus-slave.config.json（不存在则用内建默认配置）
 *   node scripts/modbus-slave/modbus-rtu-slave.mjs --config <path.json>   # 自定义配置文件
 *   node scripts/modbus-slave/modbus-rtu-slave.mjs --self-test            # 回环自测（COM4 主 + COM5 从）
 *   node scripts/modbus-slave/modbus-rtu-slave.mjs --self-test --master-port COM4
 *   node scripts/modbus-slave/modbus-rtu-slave.mjs --help
 */
import { SerialPort, InterByteTimeoutParser } from "serialport";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RULES,
  EXCEPTION_ILLEGAL_DATA_ADDRESS,
  EXCEPTION_ILLEGAL_DATA_VALUE,
  EXCEPTION_ILLEGAL_FUNCTION,
  EXCEPTION_NAMES,
  FUNCTION_READ_HOLDING,
  FUNCTION_WRITE_MULTIPLE,
  LOG_LEVELS,
  appendCrc,
  createLogger,
  crc16Modbus,
  matchRule,
  normalizeRules,
  parseRegisters,
  sendWithBehavior,
  toHex,
} from "./lib/modbus-core.mjs";

// ---------------------------------------------------------------------------
// 配置：默认值 + 归一化（行为枚举与 Mock 的 MockOpBehavior 对齐）
// ---------------------------------------------------------------------------
// 默认地址区间规则（DEFAULT_RULES，7 区）与行为归一化/顺序匹配/寄存器解析均来自
// 共享模块 ./lib/modbus-core.mjs（RTU / TCP 从站单一事实源，见其头注释）。
// 扩展行为（delayed-response / split-response）同在该模块，配置文件规则可引用。

const DEFAULT_CONFIG = {
  port: "COM5",
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  slaveAddress: 1,
  responseDelayMs: 0,
  logLevel: "info",
  logFrames: true,
  registers: {},
  rules: DEFAULT_RULES,
};

// 默认配置文件：脚本同目录下的 modbus-slave.config.json。
// 未显式 --config 时自动加载；该文件不存在则回退内建默认配置。
const DEFAULT_CONFIG_PATH = join(import.meta.dirname, "modbus-slave.config.json");

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

/** 加载并校验配置文件；未提供时返回默认配置。返回的 registers 为 Map。 */
function loadConfig(configPath) {
  const config = { ...DEFAULT_CONFIG, registers: {}, rules: DEFAULT_RULES };

  if (configPath) {
    if (!existsSync(configPath)) {
      throw new Error(`配置文件不存在: ${configPath}`);
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (err) {
      throw new Error(`配置文件解析失败: ${err.message}`);
    }
    Object.assign(config, raw);
  }

  if (typeof config.port !== "string" || config.port.length === 0) {
    throw new Error("配置 port 必须是非空字符串");
  }
  assertConfigNumber(config.baudRate, "baudRate", { min: 1 });
  assertConfigNumber(config.dataBits, "dataBits", { min: 5, max: 8 });
  assertConfigNumber(config.stopBits, "stopBits", { min: 1, max: 2 });
  if (!["none", "even", "odd", "mark", "space"].includes(config.parity)) {
    throw new Error(
      `配置 parity "${config.parity}" 无效（应为 none/even/odd/mark/space）`,
    );
  }
  assertConfigNumber(config.slaveAddress, "slaveAddress", { min: 0, max: 255 });
  assertConfigNumber(config.responseDelayMs, "responseDelayMs", { min: 0 });
  if (!Object.prototype.hasOwnProperty.call(LOG_LEVELS, config.logLevel)) {
    throw new Error(
      `配置 logLevel "${config.logLevel}" 无效（应为 debug/info/warn/error）`,
    );
  }

  config.registers = parseRegisters(config.registers);
  config.rules = normalizeRules(config.rules);
  return config;
}

// ---------------------------------------------------------------------------
// 从站
// ---------------------------------------------------------------------------
class ModbusRtuSlave {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.registers = new Map();
    for (const [address, value] of config.registers) {
      this.registers.set(address & 0xffff, value & 0xffff);
    }
    this.port = null;
    this.parser = null;
  }

  setRegister(address, value) {
    this.registers.set(address & 0xffff, value & 0xffff);
  }

  getRegister(address) {
    return this.registers.get(address & 0xffff) ?? 0;
  }

  /** 打开串口并挂接 RTU 组帧（InterByteTimeoutParser）。 */
  open() {
    return new Promise((resolve, reject) => {
      const { port, baudRate, dataBits, stopBits, parity } = this.config;
      this.port = new SerialPort({
        path: port,
        baudRate,
        dataBits,
        stopBits,
        parity,
        autoOpen: false,
      });
      // RTU 帧结束判定：3.5 字符静默间隔（1 字符按 11 位计），至少 20ms。
      // 下限取 20ms 以吸收 Node 事件循环/驱动分片抖动（如自测首请求曾被拆成
      // 5+3 字节且间隔 >10ms）。主站一帧一帧发送，帧间间隔 ≥ 25ms（self-test）/
      // ≥ 50ms（应用 Rx Delay），不会误把两帧合成一帧。
      const interval = Math.max(20, Math.ceil((3.5 * 11 * 1000) / baudRate));
      this.parser = this.port.pipe(
        new InterByteTimeoutParser({ interval, maxBufferSize: 256 }),
      );
      this.parser.on("data", (chunk) => this.handleFrameChunk(chunk));
      this.port.on("error", (err) => {
        this.log.error(`串口错误: ${err.message}`);
      });
      this.port.on("close", () => {
        this.log.warn("串口已关闭");
      });
      this.port.on("open", () => {
        const parityLabel = { none: "N", even: "E", odd: "O", mark: "M", space: "S" }[parity] ?? "N";
        this.log.info(
          `从站已启动: ${port} @ ${baudRate} ${dataBits}${parityLabel}${stopBits}，从站地址 ${this.config.slaveAddress}`,
        );
        resolve();
      });
      this.port.open((err) => {
        if (err) {
          reject(new Error(`无法打开串口 ${port}: ${err.message}`));
        }
      });
    });
  }

  /** 帧入口：长度/CRC/从站地址校验后进入协议处理。 */
  handleFrameChunk(chunk) {
    if (this.log.frames) this.log.debug(`[RX] ${toHex(chunk)}`);
    if (chunk.length < 8) {
      this.log.debug(`忽略短帧（${chunk.length} 字节 < 8）`);
      return;
    }
    const bodyLength = chunk.length - 2;
    const expectedCrc = crc16Modbus(chunk, 0, bodyLength);
    const actualCrc =
      (chunk[bodyLength] ?? 0) | ((chunk[bodyLength + 1] ?? 0) << 8);
    if (actualCrc !== expectedCrc) {
      this.log.debug(`CRC 校验失败，静默丢弃: ${toHex(chunk)}`);
      return;
    }
    const slave = chunk[0] ?? 0;
    if (slave !== this.config.slaveAddress) {
      this.log.debug(
        `从站地址不匹配（收到 ${slave}，期望 ${this.config.slaveAddress}），忽略`,
      );
      return;
    }
    this.handleFrame(chunk);
  }

  /** 协议处理（镜像 MockTransport.handleFrame 的行为语义）。 */
  handleFrame(bytes) {
    const slave = bytes[0] ?? 0;
    const functionCode = bytes[1] ?? 0;
    const address = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
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
          this.exceptionFrame(slave, FUNCTION_READ_HOLDING, behavior.exceptionCode),
          behavior,
        );
        return;
      }
      const quantity = ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0);
      // must-multi 区（ADR-030）：单读返回非法数据地址异常。
      if (rule?.mustMulti === true && quantity === 1) {
        this.logException(functionCode, EXCEPTION_ILLEGAL_DATA_ADDRESS, addrHex);
        this.respond(
          this.exceptionFrame(
            slave,
            FUNCTION_READ_HOLDING,
            EXCEPTION_ILLEGAL_DATA_ADDRESS,
          ),
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
        Uint8Array.from([
          slave,
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
      const quantity = ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0);
      const values = [];
      for (let i = 0; i < quantity; i++) {
        values.push(((bytes[7 + i * 2] ?? 0) << 8) | (bytes[8 + i * 2] ?? 0));
      }
      const value = values[0] ?? 0;
      if (behavior.kind === "no-response") {
        this.log.info(`no-response：写 ${addrHex} 不回帧`);
        return;
      }
      if (behavior.kind === "exception") {
        this.logException(functionCode, behavior.exceptionCode, addrHex);
        this.respond(
          this.exceptionFrame(slave, FUNCTION_WRITE_MULTIPLE, behavior.exceptionCode),
          behavior,
        );
        return;
      }
      // must-multi 区（ADR-030）：单写返回非法数据地址异常。
      if (rule?.mustMulti === true && quantity === 1) {
        this.logException(functionCode, EXCEPTION_ILLEGAL_DATA_ADDRESS, addrHex);
        this.respond(
          this.exceptionFrame(
            slave,
            FUNCTION_WRITE_MULTIPLE,
            EXCEPTION_ILLEGAL_DATA_ADDRESS,
          ),
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
          this.exceptionFrame(slave, FUNCTION_WRITE_MULTIPLE, EXCEPTION_ILLEGAL_DATA_VALUE),
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
          Uint8Array.from([
            slave,
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
        Uint8Array.from([
          slave,
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

    // 不支持的功能码：回异常响应（0x01 非法功能）。
    this.log.warn(
      `不支持的功能码 0x${functionCode.toString(16).toUpperCase().padStart(2, "0")}，回异常 0x01`,
    );
    this.respond(
      this.exceptionFrame(slave, functionCode, EXCEPTION_ILLEGAL_FUNCTION),
      { kind: "normal" },
    );
  }

  logException(functionCode, exceptionCode, addrHex) {
    const fcHex = `0x${functionCode.toString(16).toUpperCase().padStart(2, "0")}`;
    const name = EXCEPTION_NAMES[exceptionCode] ?? `未知(${exceptionCode})`;
    this.log.warn(`异常 ${fcHex} @ ${addrHex} → 0x${exceptionCode.toString(16).padStart(2, "0")}（${name}）`);
  }

  /** 构造异常响应体（slave + fc|0x80 + exceptionCode；CRC 由 respond 追加，共 5 字节）。 */
  exceptionFrame(slave, functionCode, exceptionCode) {
    return Uint8Array.from([slave, functionCode | 0x80, exceptionCode]);
  }

  /** 追加 CRC 并按行为投递（normal 用 responseDelayMs；扩展延迟/拆段由 sendWithBehavior 处理）。 */
  respond(body, behavior = { kind: "normal" }) {
    const frame = appendCrc(body);
    const logWrite = (chunk) => {
      if (this.log.frames) this.log.debug(`[TX] ${toHex(chunk)}`);
      this.port.write(Buffer.from(chunk), (err) => {
        if (err) this.log.error(`发送失败: ${err.message}`);
      });
    };
    sendWithBehavior(logWrite, frame, behavior, {
      baseDelayMs: this.config.responseDelayMs,
    });
  }

  close() {
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) {
        resolve();
        return;
      }
      this.port.close(() => resolve());
    });
  }
}

// ---------------------------------------------------------------------------
// --self-test 回环自测：同进程开主站（默认 COM4）+ 从站（配置端口），脚本化断言
// ---------------------------------------------------------------------------
function openMaster(path, config) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
      parity: config.parity,
      autoOpen: false,
    });
    port.open((err) => {
      if (err) {
        reject(new Error(`无法打开主站串口 ${path}: ${err.message}`));
      } else {
        resolve(port);
      }
    });
  });
}

/**
 * 构造主站请求函数：发送请求并等待一条完整应答帧（按 CRC 识别 5/7/8/11 字节帧），
 * 超时返回 null（用于 no-response 断言）。
 */
function createMasterRequest(port) {
  return (bytes, timeoutMs) =>
    new Promise((resolve) => {
      const chunks = [];
      let timer = null;
      let done = false;

      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        port.off("data", onData);
        resolve(result);
      };

      const onData = (chunk) => {
        chunks.push(Buffer.from(chunk));
        const buf = Buffer.concat(chunks);
        // 遍历候选长度（异常 5 / 读响应 7 / 写回执 8 / 预留 11），
        // 以 CRC 校验唯一识别帧边界，避免漏检。
        for (let len = 5; len <= buf.length && len <= 264; len++) {
          const expectedCrc = crc16Modbus(buf, 0, len - 2);
          const actualCrc = (buf[len - 2] ?? 0) | ((buf[len - 1] ?? 0) << 8);
          if (actualCrc === expectedCrc) {
            finish(buf.subarray(0, len));
            return;
          }
        }
        // 意外数据（长度或 CRC 均不匹配）：返回已收到的全部字节。
        if (buf.length > 264) finish(buf);
      };

      port.on("data", onData);
      timer = setTimeout(() => finish(null), timeoutMs);
      port.write(Buffer.from(bytes));
    });
}

function encodeReadRequest(slave, address) {
  return appendCrc(
    Uint8Array.from([
      slave,
      FUNCTION_READ_HOLDING,
      (address >> 8) & 0xff,
      address & 0xff,
      0x00,
      0x01,
    ]),
  );
}

function encodeWriteRequest(slave, address, value) {
  return appendCrc(
    Uint8Array.from([
      slave,
      FUNCTION_WRITE_MULTIPLE,
      (address >> 8) & 0xff,
      address & 0xff,
      0x00,
      0x01,
      0x02,
      (value >> 8) & 0xff,
      value & 0xff,
    ]),
  );
}

function assertFrame(actual, expectedHex) {
  if (actual === null) {
    return { ok: false, detail: "无响应（超时）" };
  }
  // 期望值只写响应体（不含 CRC），此处自动追加 CRC16-Modbus。
  const expected = appendCrc(
    Uint8Array.from(
      expectedHex.split(" ").map((s) => Number.parseInt(s, 16)),
    ),
  );
  if (
    actual.length !== expected.length ||
    !actual.every((b, i) => b === expected[i])
  ) {
    return { ok: false, detail: `期望 ${toHex(expected)}，实际 ${toHex(actual)}` };
  }
  return { ok: true, detail: toHex(actual) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSelfTest(masterPort) {
  // 自测使用内建默认配置（registers 为空、默认规则），保证断言确定性；
  // 不读取 --config 指定的文件。
  const config = {
    ...DEFAULT_CONFIG,
    registers: new Map(),
    rules: DEFAULT_RULES,
  };
  // 设置 MAMEP_SELFTEST_DEBUG=1 可输出从站 [RX]/[TX] 与丢弃日志，便于诊断。
  const verbose = process.env.MAMEP_SELFTEST_DEBUG === "1";
  const slave = new ModbusRtuSlave(
    config,
    createLogger(verbose ? "debug" : "warn", verbose),
  );
  console.log(`[self-test] 打开从站 ${config.port} 与主站 ${masterPort} ...`);
  await slave.open();
  const master = await openMaster(masterPort, config);
  // 端口刚打开时首帧传输可能被拆分/抖动，先稳定片刻再开始断言。
  await sleep(150);
  const request = createMasterRequest(master);
  const slaveAddr = config.slaveAddress;
  const TIMEOUT_MS = 400;
  const results = [];

  const run = async (name, bytes, expectedHex) => {
    const resp = await request(bytes, TIMEOUT_MS);
    const r = assertFrame(resp, expectedHex);
    results.push({ name, ok: r.ok });
    console.log(
      `${r.ok ? "PASS" : "FAIL"}  ${name}${r.detail ? `  (${r.detail})` : ""}`,
    );
    await sleep(25);
  };

  const runNoResponse = async (name, bytes) => {
    const resp = await request(bytes, TIMEOUT_MS);
    const ok = resp === null;
    results.push({ name, ok });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}  (${ok ? "无响应，符合预期" : `意外收到 ${toHex(resp)}`})`,
    );
    await sleep(25);
  };

  // ① FC03 读正常区（初始值 0）
  await run(
    "FC03 读 0x0000 返回当前值 0",
    encodeReadRequest(slaveAddr, 0x0000),
    "01 03 02 00 00",
  );
  // ② FC10 写后回执 + 重读验证值已更新
  await run(
    "FC10 写 0x0001=0x1234 回执",
    encodeWriteRequest(slaveAddr, 0x0001, 0x1234),
    "01 10 00 01 00 01",
  );
  await run(
    "FC03 重读 0x0001 值已更新为 0x1234",
    encodeReadRequest(slaveAddr, 0x0001),
    "01 03 02 12 34",
  );
  // ③ 只读区：写回异常 0x02
  await run(
    "写 0x0100（只读区）→ 异常 0x02",
    encodeWriteRequest(slaveAddr, 0x0100, 1),
    "01 90 02",
  );
  // ④ 只写区：读回异常 0x02
  await run(
    "读 0x0200（只写区）→ 异常 0x02",
    encodeReadRequest(slaveAddr, 0x0200),
    "01 83 02",
  );
  // ⑤ 寄存器不存在：读/写均异常 0x02
  await run(
    "读 0x0300（不存在区）→ 异常 0x02",
    encodeReadRequest(slaveAddr, 0x0300),
    "01 83 02",
  );
  await run(
    "写 0x0300（不存在区）→ 异常 0x02",
    encodeWriteRequest(slaveAddr, 0x0300, 1),
    "01 90 02",
  );
  // ⑥ 非法数据值：超限异常 0x03、合法成功
  await run(
    "写 0x0400=0x8000（超 0x7FFF）→ 异常 0x03",
    encodeWriteRequest(slaveAddr, 0x0400, 0x8000),
    "01 90 03",
  );
  await run(
    "写 0x0400=0x1234（合法）→ 回执",
    encodeWriteRequest(slaveAddr, 0x0400, 0x1234),
    "01 10 04 00 00 01",
  );
  await run(
    "读 0x0400（非法值区）→ 正常返回当前值",
    encodeReadRequest(slaveAddr, 0x0400),
    "01 03 02 12 34",
  );
  // ⑦ 写忽略区：写入回执成功但不落盘（读回仍为旧值 0）
  await run(
    "写 0x0900=0x1234（写忽略区）→ 回执成功",
    encodeWriteRequest(slaveAddr, 0x0900, 0x1234),
    "01 10 09 00 00 01",
  );
  await run(
    "读 0x0900（写忽略区）→ 仍为旧值 0（写入未落盘）",
    encodeReadRequest(slaveAddr, 0x0900),
    "01 03 02 00 00",
  );
  // ⑧ 不支持功能：读/写均异常 0x01
  await run(
    "读 0x0500（不支持功能区）→ 异常 0x01",
    encodeReadRequest(slaveAddr, 0x0500),
    "01 83 01",
  );
  await run(
    "写 0x0500（不支持功能区）→ 异常 0x01",
    encodeWriteRequest(slaveAddr, 0x0500, 1),
    "01 90 01",
  );
  // ⑨ 未知功能码 0x06 → 异常 0x01
  await run(
    "未知功能码 0x06 → 异常 0x01",
    appendCrc(Uint8Array.from([slaveAddr, 0x06, 0x00, 0x00, 0x00, 0x01])),
    "01 86 01",
  );
  // ⑨ 短帧（< 8 字节）→ 忽略无响应
  await runNoResponse(
    "短帧 4 字节 → 忽略无响应",
    Uint8Array.from([slaveAddr, 0x03, 0x00, 0x00]),
  );
  // ⑩ 坏 CRC → 静默丢弃
  const badCrcFrame = encodeReadRequest(slaveAddr, 0x0001);
  badCrcFrame[badCrcFrame.length - 1] ^= 0xff;
  await runNoResponse("坏 CRC 帧 → 静默丢弃无响应", badCrcFrame);
  // ⑪ 从站地址不匹配 → 忽略
  await runNoResponse(
    "从站地址不匹配（slave=2）→ 忽略无响应",
    encodeReadRequest(0x02, 0x0001),
  );
  // ⑫ no-response 区间 → 无响应（验证超时/重试路径）
  await runNoResponse(
    "读 0x0600（no-response 区）→ 无响应",
    encodeReadRequest(slaveAddr, 0x0600),
  );
  await runNoResponse(
    "写 0x0600（no-response 区）→ 无响应",
    encodeWriteRequest(slaveAddr, 0x0600, 1),
  );

  await master.close();
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
  node scripts/modbus-slave/modbus-rtu-slave.mjs [选项]

选项:
  --config <path>     配置文件（JSON）。缺省自动读取脚本同目录 modbus-slave.config.json，
                      该文件不存在时使用内建默认配置（COM5/9600/8N1/从站地址 1）。
  --self-test         回环自测：同进程开主站（默认 COM4）+ 从站，脚本化断言全部行为清单。
  --master-port <p>   --self-test 时主站串口（默认 COM4）。
  --help, -h          显示本帮助。

默认地址区间规则（与 dev Mock 一致）:
  0x0000–0x000f  正常区（读/写成功）        0x0100–0x010f  只读区（写回异常 0x02）
  0x0200–0x020f  只写区（读回异常 0x02）    0x0300–0x030f  不存在（读/写异常 0x02）
  0x0400–0x040f  非法值（写须 ≤ 0x7FFF，超限异常 0x03）
  0x0500–0x050f  不支持功能（读/写异常 0x01）  0x0600–0x060f  无响应（不回帧）
  0x0900–0x090f  写忽略区（读/写均回执成功，但写入不落盘——回读仍为旧值）
  规则外地址回退为正常行为。

扩展行为（配置文件规则可选，真实从站验证用，与 dev Mock 无关）:
  0x0700–0x070f  delayedResponse=1500（延迟响应 → 主站超时/迟到丢弃路径）
  0x0800–0x080f  splitResponse chunkSize=2（响应拆段发送 → 半包/粘包组帧健壮性）`);
}

function parseArgs(argv) {
  const args = { configPath: null, selfTest: false, masterPort: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--config") {
      args.configPath = argv[++i];
      if (args.configPath === undefined) throw new Error("--config 缺少文件路径");
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--master-port") {
      args.masterPort = argv[++i];
      if (args.masterPort === undefined) throw new Error("--master-port 缺少端口名");
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
    runSelfTest(args.masterPort ?? "COM4")
      .then((ok) => process.exit(ok ? 0 : 1))
      .catch((err) => {
        console.error(`[self-test] 失败: ${err.message}`);
        process.exit(1);
      });
    return;
  }

  let config;
  try {
    // 未显式 --config 时默认读取脚本同目录 modbus-slave.config.json；
    // 该默认文件不存在则回退内建默认配置（显式 --config 指定的文件缺失仍报错）。
    const configPath = args.configPath ?? DEFAULT_CONFIG_PATH;
    config = loadConfig(existsSync(configPath) ? configPath : null);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const logger = createLogger(config.logLevel, config.logFrames);
  const slave = new ModbusRtuSlave(config, logger);

  slave
    .open()
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
      logger.info("从站就绪，等待请求。Ctrl+C 退出。");
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      logger.info("收到退出信号，关闭串口...");
      slave
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

main();
