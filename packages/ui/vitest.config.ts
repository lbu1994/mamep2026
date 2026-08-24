import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  // MamepApp 头部品牌图标导入 AppIcon.svg（Vite 默认内联 data URI）；jsdom 测试
  // 环境不跑 Vite 资源管线，这里用 pre transform 把 *.svg 替换为纯字符串 stub。
  plugins: [
    {
      name: "mamep-svg-stub",
      enforce: "pre",
      transform(_code, id) {
        if (id.endsWith(".svg")) {
          return {
            code: `export default "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";`,
          };
        }
      },
    },
  ],
});
