#!/usr/bin/env node
/**
 * 三端「真实端口」e2e 统一编排与门控（com0com 虚拟串口对 + 真实从站）。
 *
 * 前置：
 * - com0com 已建立 COM4 ↔ COM5 回环对（只读使用，禁止任何配置操作）；
 * - 仓库根 serialport@13 原生绑定已构建（从站与本脚本共用）；
 * - 网页端 dev server 由各端 playwright.real.config.ts 的 webServer 自动拉起。
 *
 * 流程：
 * 1. 读 config/connections.json（rtu-com4-master / tcp-local-slave，唯一事实源，
 *    见 scripts/lib/connection-config.mjs）+ 从站自身配置（COM5）；
 * 2. 门控预检（缺环境 → 打印清晰 SKIP 提示并以退出码 0 结束，不失败）：
 *    - RTU：SerialPort.list() 须同时含主站口（rtu-com4-master.port）与从站口
 *      （modbus-slave.config.json.port）；
 *    - TCP：目标 host:port 可监听；若被占用则做一次轻量 FC03 探测——能应答则视为
 *      已有从站运行（不再自启），否则 SKIP 提示。
 * 3. 就绪后：设 MAMEP_REAL=1 → 拉起所需从站（RTU: modbus-rtu-slave COM5；
 *    TCP: modbus-tcp-slave）等待就绪 → 运行对应端命令 → 回收从站 → 透传退出码。
 *
 * 用法：
 *   node scripts/e2e-real.mjs <web|electron|vscode|all>
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as net from "node:net";
import { SerialPort } from "serialport";
import { findConnection, ROOT } from "./lib/connection-config.mjs";

// ---------------------------------------------------------------------------
// 配置读取（不硬编码）
// ---------------------------------------------------------------------------
/** RTU 主站口（rtu-com4-master.port，如 COM4）。 */
function masterPort() {
  return findConnection("rtu-com4-master").port;
}

/** RTU 从站口（scripts/modbus-slave/modbus-slave.config.json 的 port，如 COM5）。 */
function slavePort() {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "scripts", "modbus-slave", "modbus-slave.config.json"), "utf8"),
  );
  return raw.port;
}

/** TCP 从站目标（tcp-local-slave）。 */
function tcpTarget() {
  const conn = findConnection("tcp-local-slave");
  return { host: conn.host, port: conn.port, unitId: conn.unitId ?? 1 };
}

// ---------------------------------------------------------------------------
// 门控预检
// ---------------------------------------------------------------------------
/** RTU：serialport 列表须含主站口与从站口；返回缺失列表（空 = 就绪）。 */
async function checkRtuPorts() {
  const ports = await SerialPort.list();
  const names = new Set(
    ports.map((p) => String(p.path ?? p.comName ?? "").toUpperCase()),
  );
  const missing = [];
  if (!names.has(String(masterPort()).toUpperCase())) {
    missing.push(`${masterPort()}（主站，来自 config/connections.json rtu-com4-master）`);
  }
  if (!names.has(String(slavePort()).toUpperCase())) {
    missing.push(`${slavePort()}（从站，来自 modbus-slave.config.json）`);
  }
  return missing;
}

/** 探测指定 TCP 目标是否为可应答的 Modbus TCP 从站（FC03 读 0x0000）。 */
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

/** TCP：目标端口可监听即就绪；被占用则探测是否已有从站。返回 { ready, note, slaveNeeded }。 */
async function checkTcpTarget(target) {
  const { host, port, unitId } = target;
  const canListen = await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
  if (canListen) return { ready: true, slaveNeeded: true, note: "" };
  const alive = await probeTcpSlave(host, port, unitId);
  if (alive) {
    return {
      ready: true,
      slaveNeeded: false,
      note: `${host}:${port} 已被现有 Modbus TCP 从站占用，复用现有从站（不自启）`,
    };
  }
  return {
    ready: false,
    slaveNeeded: false,
    note: `${host}:${port} 被占用且非 Modbus TCP 从站（探测无应答）`,
  };
}

// ---------------------------------------------------------------------------
// 进程辅助
// ---------------------------------------------------------------------------
/** 运行命令（stdio inherit），返回退出码。 */
function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`[e2e-real] 无法启动 ${command}: ${err.message}`);
      resolve(1);
    });
  });
}

/** 拉起从站子进程并等待就绪日志；返回子进程句柄。 */
function spawnSlave(name, args, readyRegex, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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
    child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${String(d)}`));
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

function stopSlave(child, name) {
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
// 目标执行
// ---------------------------------------------------------------------------
const TARGET_COMMAND = {
  web: { command: "pnpm", args: ["--filter", "@mamep2026/e2e-web", "test:real"], needsRtu: true, needsTcp: false },
  electron: { command: "pnpm", args: ["--filter", "@mamep2026/e2e-electron", "test:real"], needsRtu: true, needsTcp: true },
  vscode: { command: "pnpm", args: ["--filter", "@mamep2026/e2e-vscode", "test:real"], needsRtu: true, needsTcp: true, preBuild: ["pnpm", ["build:vscode"]] },
};

/** 执行单个目标；返回退出码（环境缺失 → SKIP 提示并返回 0）。 */
async function runTarget(target) {
  const spec = TARGET_COMMAND[target];
  if (spec === undefined) {
    console.error(`[e2e-real] 未知目标 "${target}"（应为 web/electron/vscode/all）`);
    return 1;
  }
  console.log(`\n===== [e2e-real] 目标: ${target} =====`);

  // 1. 门控预检
  const skipReasons = [];
  if (spec.needsRtu) {
    const missing = await checkRtuPorts();
    if (missing.length > 0) {
      skipReasons.push(
        `RTU 真实端口不可用：未检测到 ${missing.join("、")}。请确认 com0com 已建立 COM4 ↔ COM5 回环对。`,
      );
    }
  }
  if (spec.needsTcp) {
    const tcp = tcpTarget();
    const check = await checkTcpTarget(tcp);
    if (!check.ready) {
      skipReasons.push(`TCP 真实端口不可用：${check.note}（${tcp.host}:${tcp.port}）。请释放端口或启动 Modbus TCP 从站。`);
    }
  }
  if (skipReasons.length > 0) {
    console.log(`[e2e-real] SKIP ${target}（环境未就绪，不失败）：`);
    for (const reason of skipReasons) console.log(`  - ${reason}`);
    return 0;
  }
  const tcpCheck = spec.needsTcp ? await checkTcpTarget(tcpTarget()) : null;
  if (tcpCheck?.note) console.log(`[e2e-real] ${tcpCheck.note}`);

  // 2. 拉起从站（RTU 必需；TCP 仅当端口空闲时自启）
  const slaves = [];
  try {
    if (spec.needsRtu) {
      const child = await spawnSlave(
        "rtu-slave",
        [
          join(ROOT, "scripts", "modbus-slave", "modbus-rtu-slave.mjs"),
          "--config",
          join(ROOT, "scripts", "modbus-slave", "modbus-slave.config.json"),
        ],
        /从站已启动|从站就绪/,
      );
      slaves.push({ child, name: "rtu-slave" });
    }
    if (spec.needsTcp && tcpCheck?.slaveNeeded !== false) {
      const child = await spawnSlave(
        "tcp-slave",
        [join(ROOT, "scripts", "modbus-slave", "modbus-tcp-slave.mjs")],
        /从站已启动/,
      );
      slaves.push({ child, name: "tcp-slave" });
    }

    // 3. 目标前置构建（vscode 需要 build:vscode）
    if (spec.preBuild) {
      const [cmd, args] = spec.preBuild;
      const buildCode = await run(cmd, args, { MAMEP_REAL: "1" });
      if (buildCode !== 0) {
        console.error(`[e2e-real] 前置构建失败（${cmd} ${args.join(" ")}，code ${buildCode}）`);
        return buildCode;
      }
    }
    // 4. 运行对应端命令
    const code = await run(spec.command, spec.args, { MAMEP_REAL: "1" });
    return code;
  } catch (err) {
    console.error(
      `[e2e-real] ${target} 执行失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  } finally {
    // 5. 回收从站
    for (const { child, name } of slaves) {
      await stopSlave(child, name);
      console.log(`[e2e-real] 已停止 ${name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI 与入口
// ---------------------------------------------------------------------------
function printHelp() {
  console.log(`用法:
  node scripts/e2e-real.mjs <web|electron|vscode|all>

三端「真实端口」e2e 统一编排（com0com COM4↔COM5 + 真实从站）。
环境未就绪（缺 COM 口 / TCP 端口被占用）→ SKIP 提示并以退出码 0 结束，不失败。`);
}

async function main() {
  const target = process.argv[2];
  if (target === undefined || target === "--help" || target === "-h") {
    printHelp();
    process.exit(target === undefined ? 2 : 0);
  }

  const targets = target === "all" ? ["web", "electron", "vscode"] : [target];
  let worstCode = 0;
  for (const t of targets) {
    const code = await runTarget(t);
    if (code !== 0) worstCode = code;
  }
  process.exit(worstCode);
}

main();
