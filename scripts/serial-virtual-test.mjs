/**
 * 虚拟串口测试入口（Layer 2，docs/TECH_DESIGN.md §34.3.20 第二层）。
 * 前置：com0com 虚拟串口对 COM4↔COM5 已由用户配置（只读写、禁止配置/提权）。
 * 设置 MAMEP_SERIAL_PROTO=1 后运行 packages/platform-node 的 vitest，
 * 使 virtual-serial.* 测试不再跳过。
 * 用法：pnpm test:serial:virtual
 */
import { spawnSync } from "node:child_process";

process.env.MAMEP_SERIAL_PROTO = "1";

const result = spawnSync(
  "pnpm",
  ["--filter", "@mamep2026/platform-node", "test"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
