#!/usr/bin/env node
/**
 * dev:vscode 启动器：启动共享 UI 的 Vite dev server，供 VSCode 扩展 dev 模式
 * （MAMEP_DEV_URL iframe）加载。
 *
 * 用法（由根 package.json 的 dev:vscode 脚本调用）：
 *   pnpm dev:vscode
 *
 * 工作流（参考 dev:electron 的「启动器 + 宿主」模式；VSCode 无法自动拉起扩展宿主，
 * 需用户 F5 启动）：
 *   1. 本脚本启动 Vite dev server（apps/web，默认 http://localhost:5173）；
 *   2. 在 VS Code 中按 F5，选择 launch.json 的「运行 Mamep2026 扩展（dev 模式）」——
 *      该配置设置 MAMEP_DEV_URL=http://localhost:5173，Webview 以 iframe 加载 dev server；
 *   3. Ctrl+C 退出时干净终止 Vite。
 *
 * 实现要点（Windows 可靠终止，同 dev-with-slave.mjs）：
 *   - 直接 spawn node 进程（apps/web/node_modules/vite/bin/vite.js），不经过 pnpm
 *     中间层，可按 PID 直接终止；vite 以 apps/web 为 cwd（与 pnpm --filter 等价）。
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
const WEB_DIR = path.join(ROOT, "apps", "web");
const DEV_URL = process.env.MAMEP_DEV_URL ?? "http://localhost:5173";

console.log(`[dev:vscode] 启动共享 UI Vite dev server（${DEV_URL}）...`);
console.log(
  "[dev:vscode] 之后在 VS Code 中按 F5（launch.json 的「运行 Mamep2026 扩展（dev 模式）」配置，MAMEP_DEV_URL 已指向本 server）。",
);

const vite = spawn(process.execPath, [VITE_ENTRY], {
  cwd: WEB_DIR,
  stdio: "inherit",
  env: { ...process.env },
});

vite.on("exit", (code, signal) => {
  if (signal !== null) {
    process.exit(0);
  }
  process.exit(code ?? 0);
});
