import { defineConfig } from "vitest/config";

export default defineConfig({
  // 与 apps/web/vite.config.ts 的 define 保持一致：测试运行时注入 __APP_VERSION__。
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    environment: "node",
  },
});
