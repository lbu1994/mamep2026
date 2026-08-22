#!/usr/bin/env node
/**
 * dev / dev:electron / dev:vscode 组合启动器：同时启动 Vite dev server 与 Modbus RTU 从站（COM5）。
 *
 * 用法（由根 package.json 的 dev / dev:electron / dev:vscode 脚本调用）：
 *   node scripts/dev-with-slave.mjs dev            # 等价原 pnpm --filter @mamep2026/web dev
 *   node scripts/dev-with-slave.mjs dev:electron   # 等价原 pnpm --filter @mamep2026/web dev:electron
 *   node scripts/dev-with-slave.mjs dev:vscode     # 等价原 pnpm dev:vscode（启动 Vite，供 VSCode dev 模式 iframe 加载）
 *
 * 生命周期约定：
 *   - Vite 退出（Ctrl+C / 崩溃）→ 立即终止从站（核心要求：dev 退出时 slave 同时退出）；
 *   - 从站退出 → 仅告警、不终止 Vite（避免 COM5 已被其他从站实例占用时把 dev 一起带崩）。
 *
 * 实现要点（Windows 可靠终止）：
 *   - 直接 spawn node 进程（vite 走 node_modules/vite/bin/vite.js，从站走本仓库脚本），
 *     两者都是本进程的直接子进程，可按 PID 直接终止，不经过 cmd/.cmd shim 与 pnpm 中间层；
 *   - vite 以 apps/web 为 cwd（与 pnpm --filter 等价），从站以仓库根为 cwd；
 *   - SIGTERM 在 Windows 上即强制终止，另加 2s 兜底 SIGKILL。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ENTRY = path.join(
  ROOT,
  "apps",
  "web",
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);
const SLAVE_SCRIPT = path.join(
  ROOT,
  "scripts",
  "modbus-slave",
  "modbus-rtu-slave.mjs",
);
const WEB_DIR = path.join(ROOT, "apps", "web");

const mode = process.argv[2] ?? "dev";
const electron = mode === "dev:electron";
const vscode = mode === "dev:vscode";
const viteArgs = electron
  ? [VITE_ENTRY, "--mode", "electron"]
  : [VITE_ENTRY];

console.log(
  `[dev-with-slave] 启动 ${
    electron ? "dev:electron" : vscode ? "dev:vscode" : "dev"
  }（Vite）与从站（COM5）...`,
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
const slave = spawn(process.execPath, [SLAVE_SCRIPT], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env },
});

let shuttingDown = false;

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

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[dev-with-slave] ${reason}`);
  killProcess(vite);
  killProcess(slave);
  setTimeout(() => process.exit(code), 500).unref();
}

// 核心要求：Vite 退出（正常或异常）→ 终止从站并退出。
vite.on("exit", (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    `[dev-with-slave] Vite 已退出（code=${String(code)}），正在终止从站...`,
  );
  killProcess(slave);
  setTimeout(() => process.exit(code ?? 0), 500).unref();
});

// 从站退出 → 仅告警，不终止 Vite。
slave.on("exit", (code) => {
  if (shuttingDown) return;
  console.warn(
    `[dev-with-slave] 从站已退出（code=${String(code)}）。Vite 继续运行。`,
  );
  console.warn(
    "  若 COM5 被占用，请确认已有从站实例在服务（可忽略此告警）。",
  );
});

// Ctrl+C / 终止信号 → 同步终止两个子进程。
process.on("SIGINT", () => shutdown("收到 SIGINT，终止 Vite 与从站"));
process.on("SIGTERM", () => shutdown("收到 SIGTERM，终止 Vite 与从站"));
