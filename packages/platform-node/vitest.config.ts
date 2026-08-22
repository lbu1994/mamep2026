import { defineConfig } from "vitest/config";

/**
 * platform-node 测试配置：
 * - 默认 node 环境、默认 include src/**\/*.test.ts；
 * - fileParallelism:false：virtual-serial.integration 与 virtual-serial-loopback
 *   共用 com0com COM4↔COM5，必须串行（并行会互相抢端口导致 Access denied）。
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
