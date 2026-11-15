/**
 * platform-node「仅 TCP」子路径入口（package.json `exports["./tcp"]`）。
 *
 * 与主入口 `index.ts` 的区别：**不** re-export `real-serial-port` / `node-platform-host`，
 * 从而不引入 serialport 原生绑定。供 Electron 主进程（Modbus TCP 会话承载，RTU 在
 * Renderer Web Serial）经 `@mamep2026/platform-node/tcp` 引用，避免 serialport 被
 * 打进主进程 ESM bundle，避免 `__dirname` 崩溃。
 *
 * VSCode Extension Host 等需要串口的宿主继续用 `@mamep2026/platform-node` 主入口。
 */
export * from "./node-tcp-platform-host";
export * from "./node-tcp-transport";
export * from "./real-clock";
export * from "./real-socket";
export * from "./socket-like";
export * from "./tcp-capabilities";
export { mapTcpError, mapTcpOpenError } from "./error-mapping";
