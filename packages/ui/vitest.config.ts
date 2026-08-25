import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  // 品牌图标已改为内联 SVG 组件（assets/AppIcon.tsx，不再 import .svg）；jsdom 测试
  // 环境不跑 Vite 资源管线，这里保留 pre transform 把 *.svg 替换为纯字符串 stub
  // （防止未来新增 .svg import 时测试环境报错）。
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
