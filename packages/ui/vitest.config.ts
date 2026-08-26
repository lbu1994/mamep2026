import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 重 jsdom 组件测试（MamepApp 全应用渲染 / RegisterTable 50 行表）在
    // `pnpm test`（turbo 全包并行）下 CPU 争抢时单测可达 5–9s，默认 5000ms 超时
    // 会偶发误报（2026-08-26：全量并行 7 例超时，单跑 ui 包 159 例全绿）。
    // 提高超时上限（仅作安全边际，不影响测试速度），消除并行负载下的偶发超时。
    testTimeout: 15000,
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
