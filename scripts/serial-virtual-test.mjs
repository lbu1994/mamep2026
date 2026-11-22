/**
 * 虚拟串口测试入口（Layer 2，docs/TECH_DESIGN.md §34.3.20 第二层）。
 * 前置：com0com 虚拟串口对 COM4↔COM5 已由用户配置（只读写、禁止配置/提权）。
 * 设置 MAMEP_SERIAL_PROTO=1 后，仅运行 packages/platform-node 的虚拟串口专项配置。
 * 普通 platform-node 单测会排除这些文件，避免同一用例在 test:all 中重复执行。
 * 用法：pnpm test:serial:virtual
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SerialPort } from "serialport";
import { findConnection, ROOT } from "./lib/connection-config.mjs";

process.env.MAMEP_SERIAL_PROTO = "1";

const masterPort = findConnection("rtu-com4-master").port;
const slaveConfig = JSON.parse(
  readFileSync(
    join(ROOT, "scripts", "modbus-slave", "modbus-slave.config.json"),
    "utf8",
  ),
);
const slavePort = slaveConfig.port;

const listed = new Set(
  (await SerialPort.list()).map((port) =>
    String(port.path ?? port.comName ?? "").toUpperCase(),
  ),
);
const unavailable = [];
for (const port of [masterPort, slavePort]) {
  if (!listed.has(String(port).toUpperCase())) {
    unavailable.push(`${port}（未枚举）`);
    continue;
  }
  const error = await probeSerialPort(port);
  if (error !== null) unavailable.push(`${port}（${error}）`);
}
if (unavailable.length > 0) {
  console.log(
    "[serial-virtual] SKIP（环境未就绪，不失败）：" +
      `未检测到可用的 ${unavailable.join("、")}。` +
      `请确认 com0com ${masterPort} ↔ ${slavePort} 回环对未被占用。`,
  );
  process.exit(0);
}

const result = spawnSync(
  "pnpm",
  ["--filter", "@mamep2026/platform-node", "test:virtual-serial"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);

function probeSerialPort(path) {
  return new Promise((resolve) => {
    const port = new SerialPort({ path, baudRate: 9600, autoOpen: false });
    port.open((openError) => {
      if (openError) {
        resolve(`无法打开：${openError.message}`);
        return;
      }
      port.close(() => resolve(null));
    });
  });
}
