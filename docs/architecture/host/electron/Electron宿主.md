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

### 宿主插件执行

主进程从 Electron 插件存储加载宿主插件，并通过 Node 宿主插件运行时构造会话所需的 codec 注册表和地址变换解析器。插件代码不得由 Main、Preload 或 Renderer 静态 import。

装配与同步规则：

- 只加载已启用、`executionMode: "same-process"` 且带 `entrySource` 的插件；
- 启动时同步一次，插件存储保存成功后再次同步；
- 启用插件集合或其 entrySource 变化时，以新建的 dataType、addressTransform 注册表全量重建；
- 保存失败不触发同步；
- Main 退出时注销宿主插件并释放可重建注册表；
- 加载和激活错误只影响对应插件，并上报宿主诊断。

宿主插件运行时不能依赖 serialport 等 Electron 专用能力。Renderer 仍只能通过版本化 HostMessage 调用 Main，不取得 Node.js、文件系统或插件执行对象。

当前 Electron RTU 会话位于 Renderer，TCP 路径也未消费宿主地址变换或插件 codec。因此宿主执行面已经装配并可验证加载、卸载和释放，但尚不一定形成用户可见的协议扩展路径。新增 TCP 插件 codec 路由或 TCP 地址变换时必须复用现有宿主注册表，不得恢复静态插件 import。

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


