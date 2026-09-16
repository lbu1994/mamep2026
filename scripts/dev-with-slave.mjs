#!/usr/bin/env node
/**
 * dev / dev:electron / dev:vscode 组合启动器：同时启动 Vite dev server 与 Modbus 从站
 * （RTU COM5 + TCP tcp-local-slave）。
 *
 * 用法（由根 package.json 的 dev:slave / dev:electron:slave / dev:vscode:slave 脚本调用）：
 *   node scripts/dev-with-slave.mjs dev            # 等价原 pnpm --filter @mamep2026/web dev
 *   node scripts/dev-with-slave.mjs dev:electron   # 等价原 pnpm --filter @mamep2026/web dev:electron
 *   node scripts/dev-with-slave.mjs dev:vscode     # 等价原 pnpm dev:vscode（启动 Vite，供 VSCode dev 模式 iframe 加载）
 *   node scripts/dev-with-slave.mjs --self-test    # 不启动 Vite：拉起 RTU + TCP 从站并断言均就绪（exit 0/1）
 *   node scripts/dev-with-slave.mjs --help, -h      # 显示本帮助
 *
 * 从站（2026-09-04 增强，关联 ADR-023 / ADR-024）：
 *   - RTU 从站挂 COM5（复用 scripts/modbus-slave/modbus-rtu-slave.mjs，读同目录 modbus-slave.config.json）；
 *   - TCP 从站监听 tcp-local-slave（复用 scripts/modbus-slave/modbus-tcp-slave.mjs，
 *     host/port/unitId 取 config/connections.json 的 tcp-local-slave，由该脚本内部读取，无需传参）；
 *   - 启动前探测 tcp-local-slave 目标：端口可监听 → 自启；已有可应答 Modbus TCP 从站 → 复用不重复创建；
 *     被非 Modbus 服务占用 → 告警跳过（Vite 继续运行）。
 *
 * 生命周期约定：
 *   - Vite 退出（Ctrl+C / 崩溃）→ 立即终止所有从站（核心要求：dev 退出时 slave 同时退出）；
 *   - 任一从站退出 → 仅告警、不终止 Vite（避免 COM5 / TCP 端口已被其他从站实例占用时把 dev 一起带崩）。
 *
 * 实现要点（Windows 可靠终止）：
 *   - 直接 spawn node 进程（vite 走 node_modules/vite/bin/vite.js，从站走本仓库脚本），
 *     两者都是本进程的直接子进程，可按 PID 直接终止，不经过 cmd/.cmd shim 与 pnpm 中间层；
 *   - vite 以 apps/web 为 cwd（与 pnpm --filter 等价），从站以仓库根为 cwd；
 *   - SIGTERM 在 Windows 上即强制终止，另加 2s 兜底 SIGKILL。
 */
import { spawn } from "node:child_process";
import * as net from "node:net";
import path from "node:path";
import { findConnection, ROOT } from "./lib/connection-config.mjs";
import {
  FUNCTION_READ_HOLDING,
  appendCrc,
  crc16Modbus,
  toHex,
} from "./modbus-slave/lib/modbus-core.mjs";

const VITE_ENTRY = path.join(
  ROOT,
  "apps",
  "web",
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);
const RTU_SLAVE_SCRIPT = path.join(
  ROOT,
  "scripts",
  "modbus-slave",
  "modbus-rtu-slave.mjs",
);
const TCP_SLAVE_SCRIPT = path.join(
  ROOT,
  "scripts",
  "modbus-slave",
  "modbus-tcp-slave.mjs",
);
const WEB_DIR = path.join(ROOT, "apps", "web");

const MODES = ["dev", "dev:electron", "dev:vscode"];

// ---------------------------------------------------------------------------
// 配置读取（唯一事实源：config/connections.json）
// ---------------------------------------------------------------------------
function rtuMaster() {
  return findConnection("rtu-com4-master");
}

function tcpTarget() {
  const conn = findConnection("tcp-local-slave");
  return { host: conn.host, port: conn.port, unitId: conn.unitId ?? 1 };
}

// ---------------------------------------------------------------------------
// 探测辅助
// ---------------------------------------------------------------------------
function canListen(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function probeTcpSlave(host, port, unitId, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on("connect", () => {
      const tid = 0x1234;
      const pdu = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x01]);
      const frame = Buffer.alloc(7 + pdu.length);
      frame.writeUInt16BE(tid, 0);
      frame.writeUInt16BE(1 + pdu.length, 4);
      frame[6] = unitId;
      pdu.copy(frame, 7);
      socket.write(frame);
    });
    socket.on("data", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// 进程辅助
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 终止子进程：先 SIGTERM，2s 未退则 SIGKILL 兜底。 */
function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* 已退出 */
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
  }, 2000).unref();
}

/** 拉起从站子进程并等待就绪日志；返回子进程句柄。 */
function spawnSlave(name, script, readyRegex, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, MAMEP_SLAVE_NO_COLOR: "1" },
    });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${name} 启动超时（${timeoutMs}ms 内未见就绪日志）`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      const text = String(d);
      out += text;
      process.stdout.write(`[${name}] ${text}`);
      if (!settled && readyRegex.test(out)) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (d) =>
      process.stderr.write(`[${name}] ${String(d)}`),
    );
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${name} 提前退出（code ${code ?? "unknown"}）`));
      }
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`无法启动 ${name}: ${err.message}`));
      }
    });
  });
}

function stopSlave(child) {
  return new Promise((resolve) => {
    if (child === null || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 已退出。
      }
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// dev 运行：Vite + RTU 从站（COM5）+ TCP 从站（tcp-local-slave）
// ---------------------------------------------------------------------------
async function runDev(mode) {
  const electron = mode === "dev:electron";
  const vscode = mode === "dev:vscode";
  const viteArgs = electron ? [VITE_ENTRY, "--mode", "electron"] : [VITE_ENTRY];

  console.log(
    `[dev-with-slave] 启动 ${
      electron ? "dev:electron" : vscode ? "dev:vscode" : "dev"
    }（Vite）与从站（RTU COM5 + TCP tcp-local-slave）...`,
  );
  if (vscode) {
    console.log(
      "[dev-with-slave] 之后在 VS Code 中按 F5（launch.json「运行 Mamep2026 扩展（dev 模式）」，MAMEP_DEV_URL 指向本 server）。",
    );
  }

  const vite = spawn(process.execPath, viteArgs, {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: { ...process.env },
  });
  const slaves = [];
  let shuttingDown = false;

  function shutdown(reason, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[dev-with-slave] ${reason}`);
    killProcess(vite);
    for (const s of slaves) killProcess(s.child);
    setTimeout(() => process.exit(code), 500).unref();
  }

  function attachSlaveExit(child, name) {
    child.on("exit", (code) => {
      if (shuttingDown) return;
      console.warn(
        `[dev-with-slave] ${name} 已退出（code=${String(code)}）。Vite 继续运行。`,
      );
      console.warn(
        name === "rtu-slave"
          ? "  若 COM5 被占用，请确认已有从站实例在服务（可忽略此告警）。"
          : "  若 TCP 端口被占用，请确认已有从站实例在服务（可忽略此告警）。",
      );
    });
  }

  // Ctrl+C / 终止信号 → 同步终止所有子进程（提前注册，覆盖端口探测窗口）。
  process.on("SIGINT", () => shutdown("收到 SIGINT，终止 Vite 与从站"));
  process.on("SIGTERM", () => shutdown("收到 SIGTERM，终止 Vite 与从站"));

  // 核心要求：Vite 退出（正常或异常）→ 终止所有从站并退出。
  vite.on("exit", (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(
      `[dev-with-slave] Vite 已退出（code=${String(code)}），正在终止从站...`,
    );
    for (const s of slaves) killProcess(s.child);
    setTimeout(() => process.exit(code ?? 0), 500).unref();
  });

  // RTU 从站（COM5）：直接拉起。
  const rtuSlave = spawn(process.execPath, [RTU_SLAVE_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });
  slaves.push({ child: rtuSlave, name: "rtu-slave" });
  attachSlaveExit(rtuSlave, "rtu-slave");

  // TCP 从站：先探测，再决定自启 / 复用 / 跳过。
  const tcp = tcpTarget();
  const listenable = await canListen(tcp.host, tcp.port);
  if (listenable) {
    const tcpSlave = spawn(process.execPath, [TCP_SLAVE_SCRIPT], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });
    slaves.push({ child: tcpSlave, name: "tcp-slave" });
    attachSlaveExit(tcpSlave, "tcp-slave");
  } else {
    const alive = await probeTcpSlave(tcp.host, tcp.port, tcp.unitId);
    if (alive) {
      console.log(
        `[dev-with-slave] ${tcp.host}:${tcp.port} 已有可应答 Modbus TCP 从站，复用现有从站（不重复启动）。`,
      );
    } else {
      console.warn(
        `[dev-with-slave] ${tcp.host}:${tcp.port} 被占用且非 Modbus 从站（探测无应答），跳过启动 TCP 从站。`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// --self-test：拉起 RTU + TCP 从站并断言均就绪（不启动 Vite）
// ---------------------------------------------------------------------------
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

async function openMaster(pathName, config) {
  const { SerialPort } = await import("serialport");
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: pathName,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
      parity: config.parity,
      autoOpen: false,
    });
    port.open((err) => {
      if (err) {
        reject(new Error(`无法打开主站串口 ${pathName}: ${err.message}`));
      } else {
        resolve(port);
      }
    });
  });
}

/** 在 buffer 中按偏移定位一条合法 RTU 帧（从站地址 + 功能码 + 有效 CRC）。
 *  处理首帧残留字节/粘包；返回 { start, len, frame } 或 null。 */
function findRtuFrame(buf, slaveAddr) {
  for (let start = 0; start + 4 < buf.length; start++) {
    if (buf[start] !== slaveAddr) continue;
    for (let len = 5; len <= buf.length - start && len <= 264; len++) {
      const expectedCrc = crc16Modbus(buf, start, start + len - 2);
      const actualCrc =
        (buf[start + len - 2] ?? 0) | ((buf[start + len - 1] ?? 0) << 8);
      if (actualCrc === expectedCrc) {
        return { start, len, frame: buf.subarray(start, start + len) };
      }
    }
  }
  return null;
}

function rtuReadRegister(port, slaveAddr, address, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let timer = null;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      port.off("data", onData);
      if (err) reject(err);
      else resolve(value);
    };
    const tryParse = () => {
      const buf = Buffer.concat(chunks);
      const found = findRtuFrame(buf, slaveAddr);
      if (!found) {
        if (buf.length > 512) {
          finish(new Error(`RTU 响应超长/无法识别: ${toHex(buf)}`));
        }
        return;
      }
      const frame = found.frame;
      const fc = frame[1];
      if ((fc & 0x80) !== 0) {
        finish(
          new Error(
            `RTU 异常响应 0x${fc.toString(16)} code=0x${(frame[2] ?? 0).toString(16)}`,
          ),
        );
        return;
      }
      const byteCount = frame[2];
      if (byteCount >= 2) {
        finish(null, ((frame[3] ?? 0) << 8) | (frame[4] ?? 0));
      } else {
        finish(new Error(`RTU 响应字节数异常: ${byteCount}`));
      }
    };
    const onData = (chunk) => {
      chunks.push(Buffer.from(chunk));
      tryParse();
    };
    port.on("data", onData);
    timer = setTimeout(() => finish(new Error("RTU 读超时")), timeoutMs);
    port.write(Buffer.from(encodeReadRequest(slaveAddr, address)));
  });
}

function tcpReadRegister(host, port, unitId, address, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const tid = 0x2345;
    const buffer = [];
    let timer = null;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
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
        if (respTid !== tid) continue;
        const fc = frame[7];
        if ((fc & 0x80) !== 0) {
          finish(
            new Error(
              `TCP 异常响应 0x${fc.toString(16)} code=0x${(frame[8] ?? 0).toString(16)}`,
            ),
          );
          return;
        }
        const byteCount = frame[8];
        if (byteCount >= 2) {
          finish(null, ((frame[9] ?? 0) << 8) | (frame[10] ?? 0));
        } else {
          finish(new Error(`TCP 响应字节数异常: ${byteCount}`));
        }
        return;
      }
    };
    socket.on("connect", () => {
      const pdu = Uint8Array.from([
        FUNCTION_READ_HOLDING,
        (address >> 8) & 0xff,
        address & 0xff,
        0x00,
        0x01,
      ]);
      const mbap = Buffer.alloc(7);
      mbap.writeUInt16BE(tid, 0);
      mbap.writeUInt16BE(1 + pdu.length, 4);
      mbap[6] = unitId;
      socket.write(Buffer.concat([mbap, Buffer.from(pdu)]));
    });
    socket.on("data", onData);
    socket.on("error", (err) => finish(err));
    timer = setTimeout(() => finish(new Error("TCP 读超时")), timeoutMs);
  });
}

async function runSelfTest() {
  const master = rtuMaster();
  const masterPort = master.port;
  const slaveAddr = master.slaveAddress ?? 1;
  const tcp = tcpTarget();
  // 从站初始寄存器 {0: 1234}（modbus-slave.config.json / modbus-tcp-slave.config.json）。
  const expectedValue = 0x04d2;

  const results = [];
  const add = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`,
    );
  };

  console.log(
    "[dev-with-slave] --self-test：拉起 RTU + TCP 从站并断言均就绪...",
  );

  const rtuSlave = await spawnSlave(
    "rtu-slave",
    RTU_SLAVE_SCRIPT,
    /从站已启动|从站就绪/,
  );
  add("RTU 从站就绪（COM5）", true);

  let tcpSlave = null;
  const listenable = await canListen(tcp.host, tcp.port);
  if (listenable) {
    tcpSlave = await spawnSlave("tcp-slave", TCP_SLAVE_SCRIPT, /从站已启动/);
    add(`TCP 从站就绪（${tcp.host}:${tcp.port}）`, true);
  } else {
    const alive = await probeTcpSlave(tcp.host, tcp.port, tcp.unitId);
    if (alive) {
      console.log(
        `[dev-with-slave] ${tcp.host}:${tcp.port} 已有可应答 Modbus TCP 从站，复用（不自启）`,
      );
      add(`TCP 从站就绪（${tcp.host}:${tcp.port}，复用现有）`, true);
    } else {
      throw new Error(
        `${tcp.host}:${tcp.port} 被占用且非 Modbus 从站，无法自测`,
      );
    }
  }

  // RTU 功能探测：经 rtu-com4-master.port（COM4）发 FC03 读 0x0000。
  // 重试至多 3 次，容忍首帧时序/残留字节造成的偶发误读。
  try {
    const masterPortObj = await openMaster(masterPort, master);
    await sleep(300);
    let rtuValue;
    let rtuError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        rtuValue = await rtuReadRegister(masterPortObj, slaveAddr, 0x0000);
        if (rtuValue === expectedValue) break;
        rtuError = new Error(
          `读到 0x${rtuValue.toString(16).toUpperCase()} ≠ 期望 0x${expectedValue.toString(16).toUpperCase()}`,
        );
      } catch (err) {
        rtuError = err;
      }
      await sleep(200);
    }
    masterPortObj.close();
    if (rtuValue === expectedValue) {
      add(
        `RTU FC03 读 0x0000（${masterPort}）→ 0x${rtuValue.toString(16).toUpperCase()}`,
        true,
      );
    } else {
      add(`RTU FC03 读 0x0000（${masterPort}）`, false, rtuError?.message);
    }
  } catch (err) {
    add(`RTU FC03 读 0x0000（${masterPort}）`, false, err.message);
  }

  // TCP 功能探测：经 tcp-local-slave 发 FC03 读 0x0000（重试至多 3 次）。
  try {
    let tcpValue;
    let tcpError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        tcpValue = await tcpReadRegister(
          tcp.host,
          tcp.port,
          tcp.unitId,
          0x0000,
        );
        if (tcpValue === expectedValue) break;
        tcpError = new Error(
          `读到 0x${tcpValue.toString(16).toUpperCase()} ≠ 期望 0x${expectedValue.toString(16).toUpperCase()}`,
        );
      } catch (err) {
        tcpError = err;
      }
      await sleep(200);
    }
    if (tcpValue === expectedValue) {
      add(
        `TCP FC03 读 0x0000（${tcp.host}:${tcp.port}）→ 0x${tcpValue.toString(16).toUpperCase()}`,
        true,
      );
    } else {
      add(
        `TCP FC03 读 0x0000（${tcp.host}:${tcp.port}）`,
        false,
        tcpError?.message,
      );
    }
  } catch (err) {
    add(`TCP FC03 读 0x0000（${tcp.host}:${tcp.port}）`, false, err.message);
  }

  await stopSlave(rtuSlave);
  if (tcpSlave !== null) await stopSlave(tcpSlave);

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n[self-test] ${results.length - failed}/${results.length} 通过${failed ? `，${failed} 项失败` : ""}`,
  );
  return failed === 0;
}

function printHelp() {
  console.log(`用法:
  node scripts/dev-with-slave.mjs <mode>       # 启动 dev 组合（Vite + RTU + TCP 从站）
  node scripts/dev-with-slave.mjs --self-test  # 拉起 RTU + TCP 从站并断言均就绪（exit 0/1）
  node scripts/dev-with-slave.mjs --help, -h   # 显示本帮助

mode:
  dev            启动网页端 Vite dev server + RTU（COM5）+ TCP（tcp-local-slave）从站
  dev:electron   启动 Electron（Vite --mode electron）+ 上述从站；另需 pnpm start:electron
  dev:vscode     启动 Vite（供 VSCode dev 模式 iframe 加载）+ 上述从站；之后按 F5 运行扩展

从站：
  - RTU 从站挂 COM5（scripts/modbus-slave/modbus-rtu-slave.mjs，读同目录 modbus-slave.config.json）
  - TCP 从站监听 config/connections.json 的 tcp-local-slave（scripts/modbus-slave/modbus-tcp-slave.mjs）
  - 启动前探测 TCP 目标：可监听 → 自启；已有可应答从站 → 复用；被非 Modbus 服务占用 → 告警跳过`);
}

function main() {
  const arg0 = process.argv[2];

  if (arg0 === "--help" || arg0 === "-h") {
    printHelp();
    process.exit(0);
  }
  if (arg0 === "--self-test") {
    runSelfTest()
      .then((ok) => process.exit(ok ? 0 : 1))
      .catch((err) => {
        console.error(
          `[dev-with-slave] --self-test 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      });
    return;
  }

  const mode = arg0 ?? "dev";
  if (!MODES.includes(mode)) {
    console.error(
      `[dev-with-slave] 未知模式 "${mode}"（应为 ${MODES.join(" / ")} / --self-test / --help）`,
    );
    printHelp();
    process.exit(2);
  }

  runDev(mode).catch((err) => {
    console.error(
      `[dev-with-slave] 启动失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}

main();
