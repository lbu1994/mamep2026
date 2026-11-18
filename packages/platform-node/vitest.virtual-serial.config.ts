import { defineConfig } from "vitest/config";

/**
 * 虚拟串口专项配置：只收集需要 com0com 的测试。
 * 这些文件从普通测试配置中排除，确保 test:all 中每个用例只执行一次。
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "src/virtual-serial-loopback.test.ts",
      "src/virtual-serial.integration.test.ts",
    ],
  },
});
