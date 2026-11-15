# Electron 宿主

## 1. apps/electron

Electron 已迁移到 `apps/electron/`，主进程 `src/main/main.ts`、preload `src/preload/preload.ts`，Renderer 复用 `apps/web` 的共享 UI。RTU 当前走 Renderer Web Serial 与主进程 `select-serial-port` 协调；TCP 会话和文件工作区由 Main 承载；Renderer 的 `ElectronAppHost` 按协议路由本地 RTU 与远程 TCP。工作区持久化使用应用数据目录中的版本化 JSON、原子替换和单份备份恢复。`debug:get-state` 是 dev 探针，打包后禁用。

### 混合会话与协议路由

Electron 同时存在两条通信路径：

- RTU：Renderer Web Serial 直接承载共享会话，Main 仅参与有限的串口授权协调；
- TCP：Main 使用 `NodeTcpTransport` 和共享 `SessionHostCore`，Renderer 经 Preload 的 HostMessage v2 远程调用。

`ElectronAppHost` 根据活动协议路由：

- RTU 读、写、轮询、Trace、Slave Address 和本地批任务使用 Renderer 会话；
- TCP 连接、会话状态、Unit ID、读写、批量取消、轮询和 Trace 使用 Main 会话 RPC；
- 本地与远程连接事件、通信日志、轮询结果、Trace 样本和应用消息合并转发给共享 UI。

TCP profile（host、port、初始 Unit ID、超时和重试）随工作区持久化，连接恢复后保持离线。TCP Unit ID 可按活动表动态更新，对后续请求生效。远程全表读取携带 Renderer 生成的 `batchId`，`session-batch-cancel` 由 Main 取消活动宿主任务。

Main、Preload、Renderer 都不得把当前协议判断散落到业务组件。共享 UI 只调用 `AppHost`，协议路由固定在 Electron 宿主边界。IPC 输入必须经过 HostMessage 白名单和 Zod 校验；错误投影保留原始 code、category、userMessageKey 和 technicalMessage，不能统一覆盖为通用宿主错误。

### 进程与产物

- Renderer 不创建独立页面工程，生产模式加载 `apps/web/dist-electron/index.html`；
- Main/Preload 产物位于 `dist-electron/`，Renderer 产物位于 `apps/web/dist-electron/`；
- 浏览器构建使用 `base: "/"`，Electron 构建必须使用 `base: "./"`，两种产物目录不得互相覆盖；
- Preload 在 `sandbox: true` 下以 CommonJS 输出，避免 ESM preload 与沙箱加载约束冲突；
- 生产页面在构建期通过 CSP meta 注入策略。`file://` 页面不能依赖只对 HTTP headers 生效的 `webRequest.onHeadersReceived`；
- Main 退出时等待有限时间完成工作区 flush、通信断开和宿主插件释放，超时后记录诊断并继续退出。

开发探针和真实能力必须区分：测试可经 `debug:get-state` 读取窗口、版本和连接状态；该探针不得进入生产可用路径，也不能作为完整业务 API。

### main

职责：

- 创建和管理窗口；
- TCP 连接；
- 工作区文件读写；
- 插件发现与加载；
- 系统菜单和快捷键适配；
- 应用生命周期；
- 安全 IPC 处理。

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
- 暴露 `MamepHostApi` 的查询能力、应用版本、剪贴板、串口选择和会话 RPC；
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


