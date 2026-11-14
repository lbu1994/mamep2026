# VSCode 宿主

## 1. apps/vscode-extension

> 当前状态（2026-08-23，[ADR-019](adr/ADR-019-vscode骨架与安全RPC.md)、[ADR-021](adr/ADR-021-vscode-rtu接线.md)）：扩展已迁移到 `apps/vscode-extension/`——命令 `mamep2026.openMainPanel` 打开 Webview 加载共享 UI；生产模式加载 `dist/media/` 本地静态资源（`asWebviewUri()` + 构建期 CSP meta `style-src 'unsafe-inline'`，`localResourceRoots` 限定媒体目录），dev 模式 `MAMEP_DEV_URL` 覆盖为 iframe 指向 Vite dev server；Extension Host ↔ Webview 复用 HostMessage v1 类型化 RPC（新增 `get-color-theme` / `color-theme-changed` kind），能力矩阵 `vscodeCapabilities` 如实声明（`modbusRtu:false` / `modbusTcp:false` / `serialPorts:"unsupported"` / `filesystem:"unsupported"`），`select-serial-port` 返回 `SERIAL_UNSUPPORTED`；`tests/e2e-vscode` 真实 VSCode 集成测试已建立。**VSCode RTU 已接线（2026-08-23，ADR-021）**：通信在 Extension Host 全量承载——`NodePlatformHost`（packages/platform-node）+ 共享编排层 `RtuSessionHost`（packages/application），Renderer `VscodeAppHost` 为远程会话代理（HostMessage v1 新 kind：`serial-enumerate`/`session-connect`/`session-read-row`/`session-write-row`/`session-batch-read`/轮询/追踪/`comm-log`/`poll-result`/`trace-sample`/`app-message` 事件）；能力矩阵翻转 `modbusRtu:true` / `serialPorts:"enumerated"`（antd Select 下拉选择）；e2e 经 `MAMEP_FAKE_SERIAL=1` 宿主进程内假串口（DevFakeSerialFactory，内联 CRC16 RTU responder）走通枚举→连接→FC10 写→FC03 读→断开闭环与面板关闭释放。**VSCode Modbus TCP 已接线（2026-08-23，ADR-022）**：`VscodeSessionHost.connectTcp`（`NodePlatformHost.openTcpTransport` + `TcpSessionHost`），`ipc.ts` 分发 `session-tcp-connect`，`DevFakeTcpServer`（`MAMEP_FAKE_TCP=1`，127.0.0.1:1502），能力矩阵 `modbusTcp:true`；e2e 走通 TCP 连接→FC10 写→FC03 读→断开闭环。本节其余为设计目标。

### extension

职责：

- 注册 VSCode 命令；
- 创建 Webview；
- 串口和 TCP 通信；
- 工作区存储；
- 插件装配；
- 监听工作区信任和扩展生命周期；
- 转发结构化事件；
- 在停用时释放连接。

### 宿主插件执行

Extension Host 从 `GlobalStatePluginStore` 读取与 Webview 共用的插件记录，通过 Node 宿主插件运行时装配宿主侧 codec 与地址变换。基础表 codec 仍由核心注册；插件 codec 覆盖在宿主插件注册表上。

宿主只加载已启用、`executionMode: "same-process"` 且带 `entrySource` 的插件。RTU 会话在 Extension Host 中承载，因此插件 codec 和表级地址变换可沿真实 RPC 路径生效。插件集合变化必须全量重建 dataType 与 addressTransform 注册表，卸载或禁用后不得继续解析其贡献。

插件 Webview 保存成功后触发宿主同步；保存失败不得同步。扩展停用时注销宿主插件并释放可重建注册表。Webview 不直接加载或执行 Node Host 插件，也不取得插件 entry 或注册表对象。

插件 entrySource 当前随插件记录保存在全局状态中。较大的插件记录可能触发 VSCode 的大扩展状态警告；需要承载大体积可执行插件时，应迁移到 `globalStorageUri` 等文件存储，并保持当前受控加载与同步契约不变。

### webview

职责：

- 渲染共享 React UI；
- 使用类型化 RPC 与扩展宿主通信；
- 适配 VSCode 主题；
- 不直接访问 Node.js；
- 不承担通信队列。


