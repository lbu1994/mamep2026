/**
 * Electron 主进程串口探针（原型，docs/TECH_DESIGN.md §34.3.14）。
 * 验证：serialport 原生绑定在 Electron Main 进程能否加载（ABI）、枚举、打开 COM4、
 * 与 modbus-slave（COM5）完成 FC03 读写闭环、关闭与干净退出。
 * 自包含：自动拉起/关闭从站。前置：com0com COM4↔COM5 已配置（只读写、禁止配置/提权）。
 * 运行：pnpm prototype:electron（等价 npx electron scripts/prototype/electron-serial-probe.mjs）
 *
 * 注意：serialport 原生绑定默认按当前 Node ABI 构建；若在 Electron 中加载报 ABI 版本不匹配，
 * 说明需用 @electron/rebuild 为 Electron 重建（见同目录 README.md）。本探针会如实报告。
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SLAVE_SCRIPT = resolve(
  ROOT,
  "scripts",
  "modbus-slave",
  "modbus-rtu-slave.mjs",
);
const MASTER_PORT = "COM4";
const SLAVE_PORT = "COM5";
// 在 Electron 中 process.execPath 是 electron.exe，必须用 node 启动从站。
const NODE_BIN = process.env.npm_node_execpath ?? "node";

/** CRC16（Modbus RTU）。权威实现见 packages/protocol-modbus/src/crc16.ts。 */
function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return Uint8Array.from([crc & 0xff, (crc >> 8) & 0xff]);
}

function appendCrc(bytes) {
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes);
  out.set(crc16(bytes), bytes.length);
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startSlave() {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn(NODE_BIN, [SLAVE_SCRIPT], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectReady(new Error(`slave 未在 15s 内就绪:\n${output}`));
      }
    }, 15000);
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      if (!settled && output.includes("从站就绪")) {
        settled = true;
        clearTimeout(timer);
        resolveReady(child);
      }
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectReady(
          new Error(
            `slave 提前退出 code=${code}（COM5 可能已被占用）:\n${output}`,
          ),
        );
      }
    });
  });
}

function stopSlave(child) {
  return new Promise((resolveDone) => {
    if (child === null || child.exitCode !== null) {
      resolveDone();
      return;
    }
    child.on("exit", () => resolveDone());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveDone();
    }, 2000);
  });
}

async function main() {
  console.log("[probe] Electron Main 进程");
  console.log(
    "[probe] versions:",
    JSON.stringify({
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    }),
  );

  const slave = await startSlave();
  console.log(`[probe] modbus-slave 已在 ${SLAVE_PORT} 就绪`);
  try {
    let SerialPort;
    try {
      ({ SerialPort } = await import("serialport"));
    } catch (cause) {
      console.error(
        "[probe] 加载 serialport 失败（多半是原生绑定为 Node ABI，与 Electron 不匹配）:",
      );
      console.error(cause instanceof Error ? cause.message : String(cause));
      console.error(
        "[probe] 处理：用 @electron/rebuild 为 Electron 重建（见 scripts/prototype/README.md），并注意重建会改变 ABI、Node 侧测试需重建回 Node ABI。",
      );
      process.exitCode = 2;
      return;
    }

    const ports = await SerialPort.list();
    console.log("[probe] 枚举:", ports.map((p) => p.path).join(", "));
    const target = ports.find((p) => p.path === MASTER_PORT);
    if (target === undefined) {
      console.error(`[probe] 未找到 ${MASTER_PORT}（com0com 未配置？）`);
      process.exitCode = 2;
      return;
    }

    const port = new SerialPort({
      path: MASTER_PORT,
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false,
    });
    await new Promise((resolveOpen, rejectOpen) => {
      port.open((error) => (error ? rejectOpen(error) : resolveOpen()));
    });
    console.log(`[probe] ${MASTER_PORT} 已打开`);
    await sleep(200);

    const request = appendCrc(
      Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]),
    );
    const response = await new Promise((resolveResponse, rejectResponse) => {
      const chunks = [];
      const onData = (chunk) => {
        for (const byte of chunk) chunks.push(byte);
        if (chunks.length >= 7) {
          port.off("data", onData);
          resolveResponse(Buffer.from(chunks));
        }
      };
      port.on("data", onData);
      setTimeout(() => {
        port.off("data", onData);
        rejectResponse(new Error("FC03 响应超时"));
      }, 3000);
      port.write(request);
    });
    console.log(`[probe] FC03 响应: ${response.toString("hex")}`);
    const expected = Buffer.from(
      appendCrc(Uint8Array.from([0x01, 0x03, 0x02, 0x04, 0xd2])),
    );
    if (!response.equals(expected)) {
      console.error(`[probe] 响应不匹配: 期望 ${expected.toString("hex")}`);
      process.exitCode = 1;
    } else {
      console.log("[probe] FC03 闭环 OK（0x0000 = 1234）");
    }

    await new Promise((resolveClose, rejectClose) => {
      port.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
    console.log(`[probe] ${MASTER_PORT} 已关闭`);
    console.log("[probe] DONE");
  } finally {
    await stopSlave(slave);
  }
}

main()
  .catch((cause) => {
    console.error(
      "[probe] 失败:",
      cause instanceof Error ? (cause.stack ?? cause.message) : cause,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
