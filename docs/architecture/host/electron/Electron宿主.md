# Electron 宿主

## 1. apps/electron

> 当前状态（2026-08-21，ADR-016/017；2026-08-23 TCP 接线，ADR-022）：Electron 已迁移到 `apps/electron/`——主进程 `src/main/main.ts`、preload `src/preload/preload.ts`，Main/Preload/Renderer 三层落地；安全 IPC 采用 HostMessage v1 版本化 Envelope + Zod 校验 + kind 白名单，`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。MVP 串口已落地（ADR-017 扩展：Web Serial + enumerated 下拉，能力矩阵 `modbusRtu:true`/`serialPorts:"enumerated"`）；**Modbus TCP 已接线（2026-08-23，ADR-022）**：会话承载在主进程——`ElectronSessionHost`（`NodePlatformHost` + `TcpSessionHost`）处理 `session-tcp-connect` 等会话 kinds（`ipc.ts` 异步化 + 事件转发 Renderer），Renderer `ElectronAppHost` 变混合（RTU 本地 `BrowserAppHost` / TCP 主进程远程代理，按 `activeProtocol` 路由），preload 暴露完整会话 RPC 桥，能力矩阵 `modbusTcp:true`；文件持久化仍未实现；`debug:get-state` 为 dev 探针（打包后禁用）。后续版本再把串口替换为 Node Serial Adapter。

### main

职责：

- 创建和管理窗口；
- 串口枚举和连接（后续版本；MVP 由 Renderer 经 Web Serial 承担，ADR-017）；
- TCP 连接；
- 工作区文件读写；
- 插件发现与加载；
- 系统菜单和快捷键适配；
- 应用生命周期；
- 安全 IPC 处理；
- 自动更新的后续接入边界。

### preload

职责：

- 暴露最小化、类型化的 IPC API；
- 隔离 Renderer 与 Node.js 能力；
- 对外暴露稳定的 Mamep Host API；
- 不暴露通用 ipcRenderer；
- 不暴露文件系统、net 或串口库对象。

### renderer

职责：

- 装配共享 UI；
- 通过 preload API 调用主进程能力；
- 维护 UI 状态；
- 不直接访问 Node.js。


