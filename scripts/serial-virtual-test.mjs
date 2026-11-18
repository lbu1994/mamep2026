/**
 * 虚拟串口测试入口（Layer 2，docs/TECH_DESIGN.md §34.3.20 第二层）。
 * 前置：com0com 虚拟串口对 COM4↔COM5 已由用户配置（只读写、禁止配置/提权）。
 * 设置 MAMEP_SERIAL_PROTO=1 后，仅运行 packages/platform-node 的虚拟串口专项配置。
 * 普通 platform-node 单测会排除这些文件，避免同一用例在 test:all 中重复执行。
 * 用法：pnpm test:serial:virtual
 */
import { spawnSync } from "node:child_process";

process.env.MAMEP_SERIAL_PROTO = "1";

const result = spawnSync(
  "pnpm",
  ["--filter", "@mamep2026/platform-node", "test:virtual-serial"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
