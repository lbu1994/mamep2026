import { defineConfig } from "vitest/config";

/**
 * application 包测试配置：默认 node 环境、默认 include src/**\/*.test.ts。
 * 本包无真实设备依赖（RtuSessionHost 用注入式 TransportPort），默认并行安全。
 */
export default defineConfig({
  test: {},
});
