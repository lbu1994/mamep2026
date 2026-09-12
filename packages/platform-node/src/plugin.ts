/**
 * platform-node「宿主侧插件执行面」子路径入口（package.json `exports["./plugin"]`）。
 *
 * 与主入口 `index.ts` 的区别：**不** re-export `real-serial-port` / `node-platform-host` /
 * TCP 相关模块，从而不引入 serialport 原生绑定与 socket 依赖。供 Electron 主进程
 * （`@mamep2026/platform-node/plugin`）与 VSCode Extension Host 装配宿主侧插件运行时使用
 * （ADR-055，2026-09-12）——见 host-plugin-runtime.ts 头注释。
 */
export * from "./plugin-local-runtime";
export * from "./host-plugin-runtime";
