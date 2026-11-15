# VSCode 宿主

## 1. apps/vscode-extension

扩展位于 `apps/vscode-extension/`，命令 `mamep2026.openMainPanel` 打开单实例 Webview。Extension Host 承载 RTU、TCP、工作区、插件和颜色主题桥；Webview 只承载共享 UI，经 HostMessage v1 与宿主通信。能力矩阵如实声明当前 RTU/TCP 与串口枚举能力，UI 按能力隐藏或禁用入口。

### 工程结构与加载模式

- `src/extension.ts` 是扩展激活、面板和生命周期入口；
- `src/ipc.ts` 是可测试的 RPC 分发核心，外部能力通过 `IpcDeps` 注入；
- `src/webview/vscode-bridge.ts` 是 Webview 侧类型化桥；
- 构建任务先用 Vite 生成共享 UI，再复制到 `dist/media/`，最后用 esbuild 生成 Extension Host bundle 和 Webview bridge。

生产模式从 `dist/media/` 加载静态资源，所有资源 URI 经 `asWebviewUri()` 重写，`localResourceRoots` 只允许 media 目录。构建期 CSP 使用 `webview.cspSource`，禁止 inline script 和远程脚本，只为 Ant Design CSS-in-JS 放行 `style-src 'unsafe-inline'`。

开发模式仅在 `MAMEP_DEV_URL` 存在时用 iframe 加载 Vite dev server，以复用热更新；生产构建不得依赖 dev server，e2e 必须验证本地资源路径、bridge 注入和 CSP 不含 dev 地址。

### Webview RPC 与生命周期

Extension Host 与 Webview 复用平台包中的 HostMessage v1：版本、request/response/event/error、唯一 messageId、Zod payload 和 kind 白名单。错误使用可序列化 `MamepError` 投影，不允许 Webview 传任意方法名。

### RTU 与 TCP 会话

VSCode Webview 不提供 `navigator.serial`，所有连接、协议解析、调度、轮询、Trace、批量读取和写后回读都在 Extension Host 执行。Webview 中的 `VscodeAppHost` 是远程会话代理，不直接持有 Transport 或串口对象。

Extension Host 使用：

- `NodePlatformHost` 打开 Node Serial 或 Node TCP Transport；
- 共享 `SessionHostCore` 承载连接状态、调度、轮询、Trace、批量读取、写后回读、地址变换和设备拔出策略；
- `RtuSessionHost`/`TcpSessionHost` 作为协议装配层，避免为 RTU 和 TCP 复制应用编排；
- HostMessage v1 的会话 request/event 与宿主连接状态桥接。

会话 request 至少包括串口枚举、连接、断开、状态查询、地址/Unit ID 更新、单行读写、批量读取与取消、轮询目标和启停、Trace 启停、表级地址变换同步。事件复用连接状态、通信日志、轮询结果、Trace 样本和应用消息。每个 kind 进入白名单、Zod 校验和穷尽性分发，不在 Webview 暴露任意方法名。

串口选择流程为：

1. Webview 请求 `serial-enumerate`；
2. Extension Host 返回端口元数据；
3. 用户在下拉框选择端口；
4. Webview 暂存端口标识并发送 `session-connect`；
5. Extension Host 使用不可变 RTU profile 快照打开 Transport。

VSCode 不经过浏览器授权手势，也不调用 Electron 的 `select-serial-port` 授权 kind。TCP 连接使用 `session-tcp-connect` 和 TCP profile；主机、端口和初始 Unit ID 随工作区 profile 恢复，但恢复后仍保持离线。

RTU Slave Address 与 TCP Unit ID 都按表保存。活动表切换时，Webview 按当前协议调用对应会话方法，后续读、写、轮询和 Trace 使用更新后的地址；连接 profile 中的值只作为连接初始值。

全表读取由渲染端生成 `batchId`，随 `session-batch-read` 发送。宿主把活动句柄登记到共享会话核心；`session-batch-cancel` 按 `batchId` 取消，完成、失败、断开或未知 ID 均为安全边界。行结果继续经既有事件流上报，取消命令不新增事件通道。

测试可注入 Extension Host 内 Fake Serial/TCP 工厂，但只允许在开发或测试模式装配，生产扩展不得包含可启用的 Fake 传输。`debug:*` 命令仅用于开发/E2E，生产构建必须关闭。

面板关闭和扩展停用都必须调用会话 dispose，取消未完成请求并断开活动连接，防止串口占用和事件订阅残留。分发 VSIX 时，SerialPort 原生绑定必须与 VSCode Extension Host 的 Node ABI、CPU 架构和平台匹配；扩展开发路径可运行不代表打包产物已完成原生模块验证。

颜色主题桥使用：

- request `get-color-theme` 查询当前浅/深主题；
- event `color-theme-changed` 在编辑器主题变化或面板重新可见时推送；
- VSCode 高对比度主题先映射到 dark 基础模式，再由完整主题令牌层覆盖中性色。

主面板采用单实例：重复执行命令只 reveal 现有面板；注册 Webview panel serializer 以支持 VSCode 重载恢复。主题订阅、消息订阅、面板 dispose 和通信释放都必须进入扩展订阅或显式释放路径。恢复工作区后保持离线，不自动发送设备请求。

调试 RPC `debug:get-state` 与扩展内命令 `mamep2026.debug:getPanel` 仅用于开发或 e2e；Webview 不得调用面板引用命令，生产构建必须关闭调试 RPC。

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


