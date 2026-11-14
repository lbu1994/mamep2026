# Mamep2026 技术设计文档（TECH_DESIGN.md）

- 文档版本：V1.0
- 产品名称：Mamep2026
- 文档类型：技术设计文档
- 目标平台：浏览器、Electron 桌面客户端、VSCode 插件
- 核心语言：TypeScript
- 架构风格：Monorepo、分层架构、Ports and Adapters、共享核心与平台适配
- 开发模式：核心通信与协议在用户要求测试时采用测试驱动开发与验收测试驱动开发；测试执行时机由用户决定
- 文档状态：初始技术设计
- 上游输入：《Mamep2026 产品需求文档（PRD）》
- 下游输入：工程初始化、模块实现、测试设计和 AGENTS.md 编写

---

# 1. 文档定位

本文档定义 Mamep2026 的技术实现方案，包括：

1. 技术栈选择；
2. 系统总体架构；
3. Monorepo 项目结构；
4. 核心模块和模块依赖；
5. 浏览器、Electron 和 VSCode 三端实现方式；
6. Modbus RTU 和 Modbus TCP 的协议及传输架构；
7. 通信请求队列和轮询调度；
8. 寄存器数据转换；
9. 工作区数据模型和持久化；
10. 日志和错误模型；
11. 插件架构；
12. Electron、VSCode 和浏览器安全边界；
13. 测试架构；
14. 构建、发布和持续集成方案；
15. 关键技术风险和应对方案。

本文档不重新定义产品范围、功能优先级、用户价值和产品验收目标。相关内容以 PRD 为准。

本文档也不规定 AI 代理的逐步操作方法、每次任务必须执行的命令、提交格式、代码检查清单和失败处理流程。相关内容应在 AGENTS.md 中定义。

---

# 2. 设计目标

## 2.1 核心技术目标

1. 三端共享相同的 Modbus 协议、数据转换、寄存器表、任务调度和错误处理逻辑；
2. 平台差异仅通过明确的平台端口和适配器实现；
3. UI 组件不得直接访问串口、TCP、文件系统或 VSCode API；
4. 核心业务模块不得依赖 React、Electron、VSCode 或浏览器全局对象；
5. 同一连接上的所有请求必须经过统一调度器串行执行；
6. 所有请求应支持超时、取消、重试和结构化日志；
7. 工作区数据必须包含版本号并支持迁移；
8. 插件不得通过修改核心模块实现私有功能；
9. 通信协议和数据转换行为必须可在无真实设备的环境中测试；
10. 三端使用统一的领域模型、消息协议和验收测试数据。

## 2.2 非目标

本技术设计不试图实现：

1. 通用工业控制平台；
2. 云端账户和云同步服务；
3. 分布式后端服务；
4. 多用户协作数据库；
5. 工业级权限、审计和安全联锁；
6. 浏览器直接访问任意 TCP Socket；
7. MVP 阶段的多连接并行；
9. MVP 阶段的任意 JavaScript 第三方插件执行；
10. 以三套相互独立的代码实现三个客户端。

---

# 3. 核心架构决策摘要

| 决策项               | 技术决策                                                              |
| -------------------- | --------------------------------------------------------------------- |
| 编程语言             | TypeScript，启用严格类型检查                                          |
| 仓库结构             | pnpm workspace 管理的 Monorepo                                        |
| 构建编排             | Turborepo                                                             |
| Web UI               | React                                                                 |
| Web 构建工具         | Vite                                                                  |
| 桌面端               | Electron                                                              |
| VSCode 端            | VSCode Extension API 与 React Webview                                 |
| UI 状态              | Zustand                                                               |
| 异步服务状态         | 领域服务事件与受控 Store，不引入远程请求型缓存框架作为核心状态源      |
| 表格                 | Ant Design Table                                                      |
| 表单和配置校验       | React Hook Form 与 Zod                                                |
| 样式                 | Ant Design ConfigProvider 主题令牌与主题适配层                        |
| 图标                 | @ant-design/icons                                                     |
| 浏览器 RTU           | Web Serial API 适配器                                                 |
| Electron RTU（MVP）  | Web Serial API 适配器（与浏览器复用，ADR-017）                        |
| Electron RTU（后续） | Node.js 串口适配器（替换 Web Serial）                                 |
| VSCode RTU           | 扩展宿主中的 Node.js 串口适配器                                       |
| Electron、VSCode TCP | Node.js net 模块适配器                                                |
| Modbus 核心          | 项目内实现所需的最小协议核心，不把业务行为绑定到第三方 Modbus 客户端  |
| 浏览器持久化         | IndexedDB                                                             |
| Electron 持久化      | 本地版本化 JSON 工作区文件与原子写入                                  |
| VSCode 持久化        | workspaceState 或 globalState 存储元数据，工作区文件存储可共享配置    |
| 单元测试             | Vitest                                                                |
| React 组件测试       | React Testing Library                                                 |
| 浏览器端到端测试     | Playwright                                                            |
| Electron 端到端测试  | Playwright Electron 支持                                              |
| VSCode 集成测试      | VSCode Extension Test 工具与专用测试工作区                            |
| 模拟设备             | TypeScript 实现的虚拟 Modbus TCP Server 和可注入的 RTU Fake Transport |
| 数据库               | MVP 不引入服务端数据库                                                |
| 后端服务             | MVP 不建设远程后端，Electron 主进程和 VSCode 扩展宿主承担本地后端职责 |

---

# 4. 技术栈设计

## 4.1 TypeScript

所有业务代码、平台适配代码、UI 代码、测试代码和构建脚本优先采用 TypeScript。

要求：

1. 启用 strict；
2. 启用 noUncheckedIndexedAccess；
3. 启用 exactOptionalPropertyTypes；
4. 启用 useUnknownInCatchVariables；
5. 禁止在核心模块使用隐式 any；
6. 外部输入进入领域层前必须完成运行时校验；
7. 对跨进程和跨 Webview 消息使用可辨识联合类型；
8. 对 ID、地址和原始寄存器值使用明确的领域类型或受控工厂函数创建；
9. 不使用 TypeScript enum 作为序列化数据格式，优先使用字符串联合类型；
10. 所有持久化数据均通过 Schema 校验后加载。

## 4.2 Monorepo 工具

采用：

- pnpm workspace；
- Turborepo；
- 共享根级 TypeScript 配置；
- 共享 ESLint、Prettier 和测试配置；
- 每个应用与包拥有独立 package.json；
- 包之间通过 workspace 依赖建立明确关系。

选择原因：

1. 三端共享包数量较多；
2. 需要统一执行类型检查、测试和构建；
3. pnpm 对 Monorepo 支持成熟；
4. Turborepo 能提供任务依赖、缓存和并行执行；
5. 两者均使用主流 Node.js 工具链；
6. 能避免把三端代码混合在单一大型应用目录中。

## 4.3 React 与 Vite

三端复杂界面统一使用 React。

浏览器端和共享 Webview UI 使用 Vite 构建。

设计要求：

1. UI 只通过应用服务和接口访问业务能力；
2. React 组件不解析 Modbus 报文；
3. React 组件不维护通信请求队列；
4. React 组件不直接引用 Node.js API；
5. 共享 UI 通过能力对象决定功能是否可用；
6. 平台差异不通过散落的 userAgent 判断实现；
7. 复杂业务状态由领域服务和 Store 管理，组件只订阅需要的数据。

## 4.4 状态管理

采用 Zustand 管理 UI 和应用层状态。

状态分为四类：

1. 领域持久状态；
2. 运行时连接状态；
3. 通信任务状态；
4. 纯界面状态。

### 4.4.1 领域持久状态

包括：

- 工作区；
- 标签页；
- 寄存器行；
- 通信配置；
- 轮询配置；
- 备注；
- 主题和布局设置；
- 插件启用配置。

这些状态通过工作区仓储保存。

### 4.4.2 运行时连接状态

包括：

- 当前连接状态；
- 当前连接 ID；
- 当前活动协议；
- 串口授权状态；
- 最近连接错误；
- 当前连接能力。

运行时连接状态不直接写入工作区。工作区仅保存允许恢复的配置。

### 4.4.3 通信任务状态

包括：

- 队列长度；
- 当前任务；
- 批量读取进度；
- 轮询运行状态；
- 取消状态；
- 当前重试次数；
- 实际轮询周期统计。

通信任务状态由通信服务提供，UI Store 只保存显示所需的投影。

### 4.4.4 纯界面状态

包括：

- 当前活动标签页；
- 侧边栏展开状态；
- 底部面板高度；
- 当前表格选择；
- 对话框状态；
- 筛选条件；
- 日志自动滚动状态。

纯界面状态不得反向驱动协议层的隐含行为。

## 4.5 表格技术

采用 Ant Design Table 构建寄存器表。

选择原因：

1. 成熟组件，表格渲染、选择、排序等交互开箱即用；
2. 通过 ConfigProvider 主题令牌统一适配浏览器、Electron 和 VSCode 主题；
3. 支持虚拟滚动，满足 1000 行以上表格需求；
4. 与整体 Ant Design 组件框架一致，减少自研成本；
5. Data 单元格使用受控 Input 直接改值，符合 Ant Design 表格默认交互。

需要自行实现：

- 地址自动格式化；
- 类型化数据输入；
- 复制、剪切和粘贴；
- 多行操作；
- 键盘导航；
- 行拖动或移动；
- 焦点恢复；
- 错误提示；
- 轮询状态显示；
- 右键菜单；
- 撤销和重做。

在正式采用前应通过表格原型验证：

1. 1000 行渲染与滚动；
2. 受控输入与虚拟滚动的兼容性（焦点、输入不丢失）；
3. 多单元格粘贴；
4. 跨行键盘导航；
5. VSCode Webview 中的焦点行为；
6. 浏览器缩放和响应式表现；
7. 深色主题可读性。

领域模型不得依赖 Ant Design Table 的内部数据结构。

## 4.6 表单和 Schema 校验

采用：

- React Hook Form 处理连接配置表单；
- Zod 定义运行时 Schema；
- 领域层使用显式校验函数处理高频寄存器数据转换。

Zod 主要用于：

1. 平台消息校验；
2. 插件清单校验；
3. 工作区文件校验；
4. 配置导入校验；
5. 本地存储恢复校验；
6. Electron IPC 输入校验；
7. VSCode Webview 消息校验。

高频通信路径不应反复对已验证的内部对象执行完整 Schema 解析。

## 4.7 样式和主题

UI 组件框架统一采用 Ant Design，主题通过 ConfigProvider 主题令牌管理：

- Ant Design ConfigProvider token 体系；
- defaultAlgorithm 与 darkAlgorithm 切换浅色和深色主题；
- 基于 antd token 扩展的语义令牌；
- 平台主题适配层；
- @ant-design/icons 图标。

基于 antd token 扩展的语义令牌至少包括：

- 品牌强调色；
- 在线、警告、错误和离线语义色；
- 表格行高；
- 单元格边距；
- 焦点轮廓；
- 轮询和操作状态色。

VSCode 端通过主题适配层将 VSCode Theme Color 映射到 antd token，保持三端主题一致。

## 4.8 后端与数据库结论

MVP 不建设远程后端服务，也不引入服务端数据库。

各端的本地后端职责如下：

- 浏览器端：Web API、Web Serial 和 IndexedDB；
- Electron 端：MVP 阶段串口经 Renderer 的 Web Serial API 承担（与浏览器一致，ADR-017），主进程负责 TCP、插件；文件持久化已移出 MVP，由后续版本落地；后续版本串口改由主进程经 Node 串口库接管；
- VSCode 端：扩展宿主负责串口、TCP、插件和工作区持久化。

不采用 SQLite 作为 MVP 默认存储，原因：

1. 当前工作区数据规模较小；
2. 数据以完整工作区文档为主要边界；
3. 三端无法直接共享相同 SQLite 运行方式；
4. 浏览器需要 IndexedDB；
5. 引入 SQLite 会增加原生模块和打包复杂度；
6. 版本化 JSON 更适合跨端导入导出和人工诊断。

如果后续出现大量历史采样、Trace 数据或超大日志检索需求，可单独评估 SQLite 或专用时序数据存储，但不得改变当前工作区领域模型。

---

# 5. 系统总体架构

## 5.1 分层结构

系统分为以下层次：

1. Domain 层；
2. Application 层；
3. Ports 层；
4. Adapters 层；
5. Presentation 层；
6. Host 层。

依赖方向只能从外层指向内层。

### 5.1.1 Domain 层

包含纯业务模型和纯函数：

- Modbus 数据模型；
- 寄存器地址；
- 16 位原始值；
- 数据类型转换；
- 寄存器行；
- 标签页；
- 工作区；
- 结构化错误；
- 插件贡献描述；
- 能力描述。

Domain 层不得依赖：

- React；
- Electron；
- VSCode；
- Web Serial；
- Node.js net；
- Node.js 串口库；
- IndexedDB；
- 文件系统；
- Zustand；
- 浏览器 DOM。

### 5.1.2 Application 层

包含用例和业务编排：

- 连接；
- 断开；
- 单行读取；
- 单行写入；
- 写后回读；
- 全表读取；
- 开始和停止轮询；
- 工作区加载与保存；
- 标签页管理；
- 插件启用与禁用；
- 日志导出；
- 状态恢复；
- 数据迁移。

Application 层通过 Ports 使用外部能力。

### 5.1.3 Ports 层

定义外部能力接口：

- SerialPortPort；
- TcpSocketPort；
- TransportPort；
- WorkspaceRepositoryPort；
- LogRepositoryPort；
- PluginRuntimePort；
- ClockPort；
- IdGeneratorPort；
- PlatformCapabilityPort；
- FileDialogPort；
- NotificationPort。

Ports 只定义核心需要什么，不暴露具体平台实现细节。

### 5.1.4 Adapters 层

分别实现：

- Web Serial Adapter（浏览器 + Electron MVP，ADR-017）；
- Node Serial Adapter（后续版本替换 Electron Web Serial；VSCode 自始使用）；
- Node TCP Adapter；
- IndexedDB Workspace Adapter；
- Electron File Workspace Adapter；
- VSCode Workspace Storage Adapter；
- Electron IPC Adapter；
- VSCode Webview RPC Adapter；
- Browser Plugin Adapter；
- Electron Plugin Adapter；
- VSCode Plugin Adapter。

### 5.1.5 Presentation 层

包含：

- React 页面；
- 表格；
- 连接配置；
- 日志面板；
- 状态指示；
- 插件管理界面；
- 设置界面；
- 对话框；
- Store；
- UI ViewModel。

### 5.1.6 Host 层

Host 是每个平台真正的运行入口：

- Browser Host；
- Electron Main Host；
- Electron Renderer Host；
- VSCode Extension Host；
- VSCode Webview Host；
- Android WebView Host（Capacitor 容器 + 原生通信插件，ADR-050）。

Host 负责装配具体适配器，不实现领域规则。

## 5.2 核心依赖原则

1. protocol-core 不依赖 transport；
2. transport 不依赖 UI；
3. communication-session 依赖 TransportPort，而非具体串口库；
4. register-table 依赖 application service，而非具体协议字节流；
5. workspace 只保存领域状态，不保存运行时 Promise、Timer 或连接句柄；
6. plugin-api 只暴露稳定的能力接口和数据契约；
7. Electron Renderer 不直接导入 Node.js 串口或 net（MVP 经 Web Serial API，非 Node 串口库，ADR-017）；
8. VSCode Webview 不直接调用 VSCode Extension API；
9. 浏览器端不得包含 Electron 或 VSCode 条件分支；
10. 平台能力由 Capability Matrix 明确声明；
11. Android WebView 不得直接调用 Capacitor 原生插件（只允许经 `packages/platform-android` 封装，ADR-050）；
12. 浏览器端不得包含 Android 条件分支（四端共用 UI，平台差异经能力矩阵与 Host 装配隔离）。

---

# 6. 项目结构

> 本节为规划目标结构。当前实际（2026-08）：`apps/` 有 `web/` 与 `electron/`（2026-08-21 迁移，ADR-016；`apps/electron/src/main/main.ts` + `apps/electron/src/preload/preload.ts`）；VSCode 插件已在 `apps/vscode-extension/`（2026-08-23 迁入）；`packages/` 现有 domain、protocol-modbus、data-conversion、communication、workspace、logging、plugin-api、register-table、platform-api、platform-web、ui、ui-theme（2026-08-25，ADR-027）、test-kit（尚未创建 platform-node、platform-electron、platform-vscode、schemas、shared-utils）；`tooling/` 仅 typescript-config；`tests/` 含 acceptance、e2e-web、e2e-electron（2026-08-21）、e2e-vscode（2026-08-23）；尚无 `plugins/` 目录。详细现状见 docs/AGENTS.md §7。**Android（2026-09-10，ADR-050）**：`apps/android/`（Capacitor 工程）、`packages/platform-android/`、`tests/e2e-android/` 与 `apps/web` 的 `--mode android` 产物 **已按 Phase 1 落地**（真机 TCP e2e 全绿）。

建议项目结构如下：

    mamep2026/
    ├─ apps/
    │  ├─ web/
    │  │  ├─ src/
    │  │  ├─ public/
    │  │  └─ package.json
    │  ├─ electron/
    │  │  ├─ src/
    │  │  │  ├─ main/
    │  │  │  ├─ preload/
    │  │  │  └─ renderer/
    │  │  ├─ resources/
    │  │  └─ package.json
    │  └─ vscode-extension/
    │     ├─ src/
    │     │  ├─ extension/
    │     │  └─ webview/
    │     ├─ media/
    │     └─ package.json
    ├─ packages/
    │  ├─ domain/
    │  ├─ protocol-modbus/
    │  ├─ data-conversion/
    │  ├─ communication/
    │  ├─ register-table/
    │  ├─ workspace/
    │  ├─ logging/
    │  ├─ plugin-api/
    │  ├─ platform-api/
    │  ├─ platform-web/
    │  ├─ platform-node/
    │  ├─ platform-electron/
    │  ├─ platform-vscode/
    │  ├─ ui/
    │  ├─ ui-theme/
    │  ├─ schemas/
    │  ├─ test-kit/
    │  └─ shared-utils/
    ├─ plugins/
    │  └─ example-yaskawa/
    ├─ tests/
    │  ├─ acceptance/
    │  ├─ integration/
    │  ├─ e2e-web/
    │  ├─ e2e-electron/
    │  └─ e2e-vscode/
    ├─ tooling/
    │  ├─ eslint-config/
    │  ├─ typescript-config/
    │  ├─ vitest-config/
    │  └─ scripts/
    ├─ docs/
    │  ├─ adr/
    │  ├─ architecture/
    │  └─ testing/
    ├─ package.json
    ├─ pnpm-workspace.yaml
    ├─ turbo.json
    ├─ tsconfig.json
    ├─ TECH_DESIGN.md
    └─ AGENTS.md

## 6.1 apps/web

职责：

- 装配浏览器平台能力；
- 渲染共享 React UI；
- 使用 Web Serial（同时服务 Electron MVP 串口，ADR-017）；
- 使用 IndexedDB；
- 执行浏览器能力检测；
- 注册浏览器生命周期事件；
- 构建静态网站。

不得包含：

- Node.js 串口实现；
- Node.js TCP；
- Electron IPC；
- VSCode API；
- 厂商私有协议实现。

## 6.2 apps/electron

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

## 6.3 apps/vscode-extension

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

### webview

职责：

- 渲染共享 React UI；
- 使用类型化 RPC 与扩展宿主通信；
- 适配 VSCode 主题；
- 不直接访问 Node.js；
- 不承担通信队列。

## 6.4 packages/domain

包含：

- 标识符；
- 通用 Result 类型；
- 结构化错误；
- 工作区聚合根；
- 标签页实体；
- 寄存器行实体；
- 连接配置值对象；
- 平台能力类型；
- 插件贡献类型。

不得包含平台实现。

## 6.5 packages/protocol-modbus

包含：

- Modbus RTU ADU 编解码；
- Modbus TCP ADU 编解码；
- PDU 编解码；
- 功能码 03 请求和响应；
- 功能码 0x10 请求和响应；
- CRC-16；
- Modbus TCP MBAP Header；
- 异常响应解析；
- 响应一致性校验；
- 报文长度校验；
- 事务 ID 校验；
- Unit ID 和 Slave Address 校验。

## 6.6 packages/data-conversion

包含：

- 16 位 HEX；
- 16 位 Binary；
- Unsigned；
- Signed；
- 十进制定点缩放；
- 输入解析；
- 输出格式化；
- 精度和范围校验；
- 原始值与展示值转换；
- 地址格式化。

该包必须保持为纯函数包。

## 6.7 packages/communication

包含：

- CommunicationSession；
- RequestScheduler；
- RetryPolicy；
- TimeoutController；
- PollingCoordinator；
- BatchReadCoordinator；
- WriteVerifyCoordinator；
- TransportPort；
- 请求生命周期事件；
- 连接状态机；
- 取消机制；
- 延迟响应隔离。

## 6.8 packages/register-table

包含：

- 表格应用服务；
- 行增删移动（含插入、批量移动、批量删除，`row-operations.ts`）；
- 复制和粘贴模型（含系统剪贴板 CSV 编解码与应用内剪贴板，`row-clipboard.ts`）；
- 多行选择状态（会话态 `selectedRowIds`，由 UI 层 Ant Design `rowSelection` 驱动）；
- 地址提交；
- 单元格直接编辑；
- 读取结果应用；
- 写入值解析与校验；
- 状态和错误投影；
- 撤销与重做命令（P1 未来项，当前未实现）；
- 对通信服务的用例封装。

> **行编辑实现说明（2026-08-15，产品决策见 [ADR-015](adr/ADR-015-行编辑交互与剪贴板决策.md)）**：插入 / 剪切 / 粘贴 / 多行选择 / 键盘快捷键 / 行级右键菜单已在浏览器 MVP 完整实现。多选采用 Ant Design Table `rowSelection` 原生能力（复选框列、表头全选、Shift 范围选择、Ctrl 多选），领域层只持有 `selectedRowIds: RowId[]`（不依赖 AntD 内部结构，AGENTS §25.4）；行级右键菜单用 `Dropdown trigger={['contextMenu']}`；系统剪贴板经 `AppHost` 端口（`copyTextToClipboard` / `readTextFromClipboard`，浏览器端 `navigator.clipboard`）。

## 6.9 packages/workspace

包含：

- 工作区 Schema；
- Repository Port；
- 自动保存协调器；
- 数据迁移；
- 单元格直接编辑；
- 读取结果应用；
- 写入值解析与校验边界；
- 保存节流和原子提交逻辑。

## 6.10 packages/logging

包含：

- 结构化消息日志；
- 通信日志；
- 日志保留上限；
- 日志导出模型（仅导出，CSV 格式；搜索/过滤不提供）；
- 敏感字段标记；
- 日志事件订阅。

## 6.11 packages/plugin-api

包含：

- 插件 Manifest Schema；
- 插件生命周期接口；
- 插件贡献点；
- 插件权限声明；
- 平台能力要求；
- 版本兼容规则；
- 插件 Host 接口；
- 插件错误边界。

## 6.12 packages/platform-api

定义 UI 和 Application 层可访问的平台统一接口，包括：

- 串口；
- TCP；
- 持久化；
- 文件选择；
- 剪贴板；
- 通知；
- 插件；
- 平台信息；
- 能力矩阵；
- 生命周期。

## 6.13 packages/ui

包含三端共享的：

- 页面布局；
- 顶部应用栏；
- 侧边栏；
- 标签页；
- 寄存器表（含多行选择、行级右键菜单、行级键盘快捷键，见 [ADR-015](adr/ADR-015-行编辑交互与剪贴板决策.md)）；
- 连接配置；
- 日志面板；
- 插件页面；
- 设置页面；
- 通用组件；
- 可访问性工具；
- UI Store。

## 6.14 packages/test-kit

包含：

- Fake Serial Transport；
- Fake TCP Transport；
- Scripted Modbus Device；
- Virtual Clock；
- Deterministic ID Generator；
- In-memory Workspace Repository；
- 请求记录器；
- 延迟和超时控制；
- 错误注入；
- 工作区测试工厂；
- 插件测试 Host。

---

# 7. 平台能力矩阵

平台不支持的能力应由能力矩阵明确表示。

建议定义以下能力：

| 能力                        |                             Browser |                            Electron |                              VSCode |                                            Android（ADR-050，分期） |
| --------------------------- | ----------------------------------: | ----------------------------------: | ----------------------------------: | ------------------------------------------------------------------: |
| Modbus RTU                  |                                支持 |                                支持 |                                支持 |           支持（USB Host + usb-serial-for-android，Phase 2 已落地） |
| Modbus TCP                  |                              不支持 |                                支持 |                                支持 |                                        支持（原生 socket，Phase 1） |
| 串口枚举                    |        授权 picker 承担，无全量枚举 |        授权 picker（MVP，同浏览器） |                                支持 |                       支持（USB Host 枚举；无 Web Serial 手势约束） |
| COM10 及以上                |            由浏览器设备选择机制处理 |                                支持 |                                支持 |                             支持（USB 设备制，无 Windows 路径问题） |
| 本地文件系统                |                                受限 |                                支持 |                                支持 |                                 受限（IndexedDB；文件通道 Phase 4） |
| 工作区文件                  |                  可通过导入导出实现 |                                支持 |                                支持 |                 可通过导入导出实现（Capacitor Filesystem，Phase 4） |
| IndexedDB                   |                                支持 |                              非默认 |                              非默认 |                                            支持（WebView 原生支持） |
| Node.js 插件                |                              不支持 |                            受控支持 |                            受控支持 |                                                              不支持 |
| Web 插件                    |                        支持受限插件 |                              可支持 |                              可支持 |   支持受限插件（手动安装；`executablePlugins` 运行时探测，ADR-056） |
| VSCode 命令                 |                              不支持 |                              不支持 |                                支持 |                                                              不适用 |
| 系统通知                    |                          浏览器能力 |                                支持 |                         VSCode 通知 |                                                            Phase 4+ |
| 连接对象配置文件（ADR-023） | 已移除（ADR-034，由工作区导入替代） | 已移除（ADR-034，由工作区导入替代） | 已移除（ADR-034，由工作区导入替代） |                                                   已移除（ADR-034） |
| 自动更新                    |                              不适用 |                            后续支持 |                      由 VSCode 管理 | Phase 5（APK/AAB 打包签名已落地：`build:android:release`，ADR-056） |

> 实现状态（2026-08-21；2026-08-23 更新）：上表为三端能力规划。Browser 列已随浏览器 MVP 落地（Web Serial RTU、IndexedDB 持久化、授权 picker 串口选择、dev `?mockTransport=1` 模拟传输）；Electron MVP 串口已落地（ADR-017 扩展：Web Serial + enumerated 下拉，能力矩阵 `modbusRtu:true`/`serialPorts:"enumerated"`）；**VSCode 列 RTU 已接线（2026-08-23，ADR-021）**（Extension Host `NodePlatformHost` + 共享 `RtuSessionHost`，Renderer 远程代理，能力翻转）。**两端 Modbus TCP 已接线（2026-08-23，ADR-022）**：会话层 `CommunicationSession` 支持 `protocol:"tcp"`（`TcpFrameParser` MBAP 分帧 + Transaction ID 管理）；Electron TCP 会话承载主进程（`ElectronSessionHost`，Renderer `ElectronAppHost` 混合远程代理）、VSCode TCP 会话承载 Extension Host（`VscodeSessionHost.connectTcp`），能力矩阵 `electronCapabilities`/`vscodeCapabilities` → `modbusTcp:true`；UI Connection Settings 增加 TCP 分组（协议 Segmented 能力门控，浏览器不显示 TCP 入口）；`tests/e2e-vscode` 走通 TCP 闭环、`tests/e2e-electron` 走通 TCP 配置连接 → FC03 读 → FC10 写闭环。**连接对象配置文件（2026-08-24，ADR-023；应用侧功能 2026-08-29 由 ADR-034 移除）**：`config/connections.json`（JSON，schemaVersion 1）定义真实设备连接对象（RTU 含串口名/从站地址，TCP 含 host/port/unitId 等），**保留供测试/验证脚本消费**（消除 COM4/COM5/127.0.0.1:1502 硬编码）；应用侧「Load from Config File」UI、`packages/connection-config` 包、`connection-config-load` kind、能力矩阵 `connectionConfig` 字段、浏览器 `?connectionConfig=` URL 已删除，连接对象导入由 Settings → 工作区导入（ADR-033）承担。VSCode 文件持久化仍为规划目标。

> 多寄存器连续读写（ADR-030，2026-08-27 设计确认）：属协议层共享能力（三端共用同一共享会话层），
> 不新增能力矩阵字段；三端一致支持，实施未开始。

> **Electron 文件持久化已落地（2026-08-30，ADR-036）**：工作区持久化由 Renderer IndexedDB 替换为
> 主进程应用数据目录版本化 JSON（`WorkspaceFileRepository`，原子保存 + 单份 .bak + 损坏自愈），
> HostMessage v1 新增 `workspace-load/workspace-save/workspace-clear` kind，Renderer `FileWorkspaceRepository`
> 薄桥，`electronCapabilities.filesystem` 翻转为 `"full"`；浏览器维持 `limited`（IndexedDB）、
> VSCode 维持 `unsupported` 如实声明（工作区持久化仍走 Webview 内 IndexedDB，VSCode 文件持久化属
> ADR-019 复审条件待办）。

能力矩阵通过 PlatformCapabilities 对象注入 UI。

> **Android 列（2026-09-10，ADR-050）**：Android 为第四平台（Capacitor 容器 + 原生通信插件）。
> **Phase 1（TCP）已落地**；**Phase 2（USB-RS485）已落地**，故 `modbusRtu:true` / `serialPorts:"enumerated"` 已翻转，
> 其余如实声明：`modbusTcp:true` / `filesystem:"limited"` / `nodePlugins:false` / `webPlugins:true` /
> `executablePlugins:false` / `hostPlugins:false` / `pluginInstall:"unsupported"`；
> `logExport` / `workspaceImport` / `workspaceExport` 在文件通道落地（Phase 4）后按实翻转。

> **边界不变**：`browserCapabilities.modbusTcp` 维持 `false`（Android 与浏览器使用独立产物与独立能力矩阵）；
> Android 的 `AppHost.browserCompatibility` 返回 `null`（不使用 Web Serial 兼容性提示）。

UI 根据能力执行：

1. 隐藏完全不适用的功能；
2. 禁用临时不可用的功能；
3. 展示禁用原因；
4. 不尝试调用不存在的平台 API；
5. 不通过捕获运行时异常来判断平台能力。

---

# 8. Modbus 协议设计

## 8.1 实现范围

MVP 协议核心只实现：

1. Modbus RTU；
2. Modbus TCP；
3. 功能码 03；
4. 功能码 0x10；
5. 单个或多个连续 16 位保持寄存器读取（FC03，quantity 可 >1，范围行，ADR-030）；
6. 单个或多个连续 16 位保持寄存器写入（FC0x10，多值写，ADR-030）；
7. Modbus 异常响应；
8. RTU CRC-16；
9. TCP MBAP Header；
10. 请求和响应一致性校验。

不得在核心协议包中加入：

- BCC；
- CHECK-SUM；
- 厂商私有功能码；
- Enter RAM；
- Enter ROM；
- 厂商寄存器语义；
- 私有报文封装。

Address Adjust（ON 时发送地址 = 用户地址 − 1，默认 OFF）由 register-table 应用层实现，协议包只接收最终已验证的实际发送地址。

## 8.2 协议层次

协议处理分为：

1. 领域请求；
2. PDU；
3. ADU；
4. Transport 字节流；
5. 响应帧；
6. 领域结果。

读取请求转换流程：

    ReadHoldingRegisterCommand
    -> Function 03 PDU
    -> RTU ADU 或 TCP ADU
    -> Transport
    -> RTU ADU 或 TCP ADU
    -> Function 03 Response PDU
    -> RawRegisterValue

写入请求转换流程：

    WriteHoldingRegisterCommand
    -> Function 0x10 PDU
    -> RTU ADU 或 TCP ADU
    -> Transport
    -> RTU ADU 或 TCP ADU
    -> Function 0x10 Response PDU
    -> WriteAcknowledgement

## 8.3 请求模型

每个通信请求至少包含：

- requestId；
- connectionId；
- protocol；
- source；
- operation；
- target；
- timeoutMs；
- retryCount；
- createdAt；
- cancellationToken；
- metadata。

source 用于区分：

- manual-read；
- manual-write；
- batch-read；
- polling；
- write-verify；
- plugin。

operation 用于区分：

- read-holding-register；
- write-holding-register。

target 至少包含：

- slaveAddress 或 unitId；
- registerAddress；
- registerCount。

MVP 的 registerCount 固定为 1，但协议层不应依赖 UI 假设。

## 8.4 响应校验

RTU 响应必须校验：

1. 最小帧长度；
2. CRC；
3. Slave Address；
4. 功能码；
5. 异常功能码；
6. 字节数；
7. 数据长度；
8. 写入响应中的起始地址；
9. 写入响应中的数量；
10. 是否存在多余或缺失字节。

TCP 响应必须校验：

1. Transaction ID；
2. Protocol ID；
3. Length；
4. Unit ID；
5. 功能码；
6. 异常功能码；
7. 字节数；
8. 数据长度；
9. 写入地址；
10. 写入数量。

## 8.5 RTU 帧读取

串口字节流可能分多次到达，不能假设一次 data 事件包含完整响应。

RTU Transport Adapter 应提供字节缓冲，通信会话根据当前请求推导预期响应长度。

需要处理：

1. 响应被拆分为多个数据片段；
2. 一次收到完整响应；
3. 收到多余字节；
4. 收到上一个请求的迟到响应；
5. 收到噪声或非法前缀；
6. CRC 错误；
7. 超时前只收到部分帧；
8. 设备断开。

对于当前 MVP 的功能码 03 和 0x10，可以根据响应头确定完整帧长度：

- 功能码 03：根据 byte count 推导；
- 功能码 0x10：响应长度固定；
- 异常响应：长度固定。

不得仅依赖固定延迟判断帧结束。

## 8.6 TCP 帧读取

TCP 是字节流协议，必须处理：

1. 半包；
2. 粘包；
3. 多个响应连续到达；
4. 连接中断；
5. MBAP Length 非法；
6. Transaction ID 不匹配；
7. 超时后的迟到响应。

TCP Adapter 应维护接收缓冲，根据 MBAP Header 中的 Length 分帧。

## 8.7 Transaction ID

Modbus TCP Transaction ID 由 CommunicationSession 维护。

要求：

1. 在 16 位范围内递增并回绕；
2. 单连接内唯一关联当前未完成请求；
3. 响应必须与当前请求 Transaction ID 匹配；
4. 超时后的迟到响应不得被后续请求误接收；
5. 连接重建后重置或重新初始化；
6. Transaction ID 不进入持久化工作区。

---

# 9. 传输层设计

## 9.1 TransportPort

统一传输接口表达：

- open；
- close；
- write；
- subscribeData；
- subscribeError；
- subscribeClose；
- isOpen；
- capabilities。

TransportPort 只处理字节和连接事件，不理解寄存器行、Data Type 或工作区。

RTU 和 TCP 可以使用不同的 Transport 配置，但应向 CommunicationSession 提供统一的字节传输能力。

实现标识（`TransportPort.kind`）：`"web-serial"`（浏览器/Electron MVP）、`"node-serial"`（Node Serial Adapter）、
`"node-tcp"`（Node TCP Adapter）、**`"capacitor-serial"` / `"capacitor-tcp"`（Android，ADR-050）**、`"mock"`（dev）、`"fake"`（测试）。

> Android 端接缝切在 **TransportPort（字节流）**，不在功能码层：原生插件只提供「打开 / 写字节 / 来字节 / 关闭」，
> 帧编码、CRC、TCP 分帧、超时重试与会话编排全部留在共享 JS 层（ADR-050）。

## 9.2 Web Serial Adapter

职责：

1. 用户授权串口；
2. 打开和关闭端口；
3. 读取数据流；
4. 写入数据流；
5. 将浏览器错误映射为结构化错误；
6. 响应页面卸载和连接丢失；
7. 释放 Reader 和 Writer 锁；
8. 支持能力检测；
9. 处理当前浏览器不支持的串口参数。

浏览器端不能依赖传统 COM 端口字符串作为设备唯一标识。

浏览器端（BrowserPlatformHost）不实现自定义串口枚举列表，以授权 picker 替代；**Electron MVP 复用同一 Web Serial Adapter，但主进程 `select-serial-port` 不再自动选择/依赖系统 picker，而是把端口列表转发给渲染进程、由用户在 antd Select 下拉框中选择（ADR-017 扩展，`serialPorts: "enumerated"`）；后续版本替换为 Node Serial Adapter 后再由主进程系统枚举**：

- `requestPort()` 浏览器端打开系统原生设备选择器，每次打开即实时枚举系统可用设备（等同「自动枚举 + 刷新」），用户取消返回 null；Electron 端则触发主进程 `select-serial-port`（列表经事件转发，选择经 invoke 回传）；
- `getPorts()` 只返回已授权端口，无法枚举未授权设备（Web Serial 隐私模型）；当前实现已声明该类型但从未调用；
- 因此浏览器端无串口列表/刷新按钮/`listSerialPorts` 能力，能力矩阵声明为 `serialPorts: "browser-picker"`；Electron 端为 `serialPorts: "enumerated"`（下拉框 + 刷新 + 取消/空态）。

**Electron 串口获取机制（ADR-017 扩展，2026-08-22 真机验证）**——完整链路如下：

1. **用户手势触发枚举**：`navigator.serial.requestPort()` 必须在用户手势中调用（下拉框 `onOpenChange` / 点击刷新按钮），否则抛 `SecurityError: Must be handling a user gesture`（在弹窗打开 / effect 里自动枚举会被吞掉，下拉框恒空）。下拉框仅注册事件、不在 `afterOpenChange` 自动枚举。
2. **主进程拦截选择**：`requestPort()` 触发 session 的 `select-serial-port` 事件，主进程 `event.preventDefault()` 后默认「延迟选择」——把 `portList`（含 `portId`/`portName`/`displayName`）经 `serial-ports-available` 事件转发给渲染进程，挂起 callback 等待用户选择；设置 `selectPort` 策略则自动选择（测试/无人值守）。
3. **权限放行**：`setPermissionCheckHandler` / `setDevicePermissionHandler` 仅对本应用 origin 放行 `serial`。**origin 必须归一化（`normalizeOrigin`）**：dev 下 `details.securityOrigin` 报告为 `http://localhost:5173/`（尾斜杠），而 allowlist 由 `new URL().origin` 生成（无斜杠），精确匹配会失败 → 设备被拒 → `requestPort` reject `NotFoundError: No port selected by the user`（"刷不出来串口"的根因）。`normalizeOrigin` 对 http(s) 用 `new URL(origin).origin` 归一化，`file://` 原样保留（URL API 会把它归一化成 `"null"`）。
4. **下拉框展示**：渲染进程 `ElectronAppHost` 把事件转成的 `SerialPortOption[]`（label 优先级 `portName → displayName → portId`）喂给 antd Select；空列表显示 "No serial ports found" + 刷新按钮。
5. **回传选择**：用户选中 → `select-serial-port` invoke（HostMessage v1，payload `{portId}`，空串 = 取消）→ 主进程 `resolvePendingSelection` 调用挂起 callback → `requestPort()` settle → 渲染进程拿到 `SerialPort` 构建 `WebSerialHandle`；用户取消 → callback("") → `requestPort` reject `NotFoundError` → 视为 ok(null)。
6. **幂等/清理**：重枚举前先取消旧挂起会话（`cancelPendingPicker`，调 `selectSerialPort("")` 并吞掉 rejection），避免多个 `requestPort` 同时挂起。

> 经验：fake `navigator.serial` 的 e2e 走不到真实权限/手势路径，单测/e2e 全绿 ≠ 真机可用；串口权限类问题必须真机验证（详见仓库 memory `electron-serial-debug-2026-08-22`）。

浏览器持久化时只保存：

- 非设备标识类通信参数；
- 可选的最近设备显示信息；
- 不保存可用于自动重连的授权假设。

## 9.3 Node Serial Adapter

> 实现状态（2026-08-23，ADR-020）：Node 串口原型已通过并产出选型 ADR——`packages/platform-node`
> 落地 `NodeSerialTransport` + `NodePlatformHost` + 错误映射 + 能力描述 + 注入式 `SerialPortLike` 隔离面
>
> - Fake 测试，com0com COM4↔COM5 虚拟串口闭环全绿（详见 [node-serial-prototype-验证记录.md](./node-serial-prototype-验证记录.md)）。
>   正式接线（Electron 替换 Web Serial、VSCode 接线）仍属后续版本；MVP 阶段 Electron 与浏览器一致使用
>   Web Serial API（Renderer `navigator.serial`，ADR-017）。

Electron（后续版本替换 Web Serial）和 VSCode 共用 Node Serial Adapter。

职责：

1. 枚举系统串口；
2. 完整保留系统返回的串口路径；
3. 支持 COM10 及以上；
4. 打开和关闭串口；
5. 串口错误映射；
6. 设备拔出检测；
7. 写入和 drain；
8. 数据事件转为 Uint8Array；
9. 防止重复打开；
10. 保证关闭操作幂等。

COM10 以上不得通过手工拼接不完整路径实现。应直接使用成熟串口库枚举和打开时提供的原始 path。

Windows、macOS 和 Linux 下均把端口路径视为不透明字符串，不在领域层解析其命名格式。

## 9.4 Node TCP Adapter

Electron 和 VSCode 共用 Node TCP Adapter。

职责：

1. DNS 或 IP 连接；
2. 连接超时；
3. Socket 错误；
4. 远端关闭；
5. 本地主动关闭；
6. 半包和粘包数据传递；
7. 阻止断开后继续写入；
8. 可取消连接；
9. 支持自动重连协调器使用；
10. 映射结构化错误。

是否自动重连不由 Adapter 决定，而由 Application 层的连接策略决定。

## 9.5 Capacitor 传输适配（Android，ADR-050）

Android 端不使用 Node 串口/TCP 库，而是经 Capacitor 原生插件提供字节流。

职责：

1. 打开/关闭 USB 串口（USB Host + `USB_PERMISSION` 授权）与 TCP socket；
2. 字节写入（base64 经桥传递）；
3. 原生侧**整帧聚合**后单次投递入站字节（避免分片事件风暴）；
4. 设备拔出 / socket 断开 / 权限拒绝的结构化错误映射；
5. 枚举可用的 USB 串口设备（`serialPorts: "enumerated"`）；
6. 不实现 Modbus 帧语义、不实现超时重试与调度。

桥契约采用与 HostMessage v1 相同的安全姿态：版本化信封 + Zod 校验 + 方法白名单（`packages/platform-android/src/bridge-contract.ts`）。

> 风险与退路：默认 `requestTimeoutMs: 50`（超时从 `transport.write()` resolve 后开始）对桥接型传输偏紧，
> Phase 0 spike 实测桥往返延迟；若不足，先在该平台 composition root 覆盖超时/重试（不改全局 `defaultConfig`），
> 退路为将**帧解析**下沉原生（`exchange(bytes) → bytes`，JS 侧合成 TransportPort 事件），因接缝在 TransportPort，上层零改动。

---

# 10. 连接状态机

## 10.1 状态定义

连接状态建议定义为：

- disconnected；
- selecting-device；
- connecting；
- connected；
- disconnecting；
- reconnect-waiting；
- reconnecting；
- interrupted；
- failed。

状态机必须防止非法转换。

示例合法转换：

    disconnected -> selecting-device
    disconnected -> connecting
    selecting-device -> connecting
    selecting-device -> disconnected
    connecting -> connected
    connecting -> failed
    connecting -> disconnected
    connected -> disconnecting
    connected -> interrupted
    disconnecting -> disconnected
    interrupted -> reconnect-waiting
    interrupted -> disconnected
    reconnect-waiting -> reconnecting
    reconnecting -> connected
    reconnecting -> failed
    failed -> connecting
    failed -> disconnected

## 10.2 状态机职责

1. 防止重复连接；
2. 防止重复断开；
3. 断开时取消未执行任务；
4. 连接丢失时通知轮询器停止；
5. 用户主动断开后禁止自动重连；
6. 区分连接失败和连接中断；
7. 释放底层资源；
8. 发布结构化状态事件；
9. 为 UI 提供可预测状态；
10. 不将连接句柄写入持久化状态。

## 10.3 连接配置快照

建立连接时创建不可变配置快照。

正在执行的请求使用连接建立时和请求提交时确定的配置，不读取之后被 UI 修改的可变对象。

配置修改规则：

- 串口核心参数变更后需要重新连接；
- TCP 主机和端口变更后需要重新连接；
- 从站地址或 Unit ID 对后续请求生效；
- 超时和重试可对后续请求生效；
- 已入队请求保留创建时的请求配置快照。

---

# 11. 请求调度与并发控制

## 11.1 单连接单队列

每个活动连接拥有一个 RequestScheduler。

MVP 只有一个活动连接，因此运行时只有一个主要请求队列。

所有来源的请求必须进入同一队列：

- 单行读取；
- 单行写入；
- 全表读取；
- 周期轮询；
- 写后回读；
- 插件请求。

不得绕过队列直接调用 Transport。

## 11.2 调度目标

1. 同一时刻只执行一个设备请求；
2. 用户手动操作不被大批轮询任务长期阻塞；
3. 轮询任务不能无限积压；
4. 全表读取可以取消；
5. 断开时取消队列；
6. 写后回读保持操作关联；
7. 插件请求不能垄断通信链路；
8. 请求执行顺序可测试；
9. 超时后能够继续处理后续请求；
10. 迟到响应不会关联到错误请求。

## 11.3 请求优先级

建议定义以下优先级：

1. connection-control；
2. manual-write；
3. manual-read；
4. write-verify；
5. batch-read；
6. polling；
7. plugin-background。

优先级只能影响尚未开始的任务，不中断已经发送到设备的请求。

为避免低优先级任务饥饿，应采用带公平性的优先级队列，例如：

- 高优先级请求优先；
- 连续执行一定数量高优先级请求后允许较低优先级请求执行；
- 同优先级按创建顺序执行；
- 插件不得指定超出其权限的优先级。

具体公平参数作为内部实现配置，不进入 PRD。

## 11.4 不允许重复积压的轮询任务

每一个轮询行在队列中最多存在一个待执行任务和一个可能正在执行的任务。

如果下一次轮询触发时，上一次任务仍在等待或执行：

- 不追加新的同类任务；
- 记录一次 skipped tick 或 lag 指标；
- 保留下一轮重新调度机会；
- UI 可展示实际刷新速度低于配置速度。

这可以避免链路变慢时队列无限增长。

## 11.5 手动快速点击

对同一行连续快速点击读取时：

- 如果已有同一行的手动读取尚未开始，可以合并为一次；
- 如果已有读取正在执行，可以禁用按钮或将后续请求合并；
- 不应无上限创建相同请求。

对写入操作不自动合并，因为每次写入可能代表用户的独立意图。

UI 在写入请求未完成时默认禁用该行的再次写入按钮，除非后续明确设计写入队列功能。

## 11.6 请求取消

每个任务持有 CancellationToken。

取消分为：

- 尚未开始：直接从队列移除；
- 已在附加延迟阶段：终止等待；
- 已发送请求：停止等待结果并标记取消；
- 底层 Transport 不支持撤回已经发送的字节，因此取消不等于设备未执行；
- 取消后到达的响应必须被识别为迟到响应并丢弃或记录。

用户断开连接时：

1. 阻止新任务入队；
2. 取消所有未开始任务；
3. 取消当前等待；
4. 关闭 Transport；
5. 清理接收缓冲；
6. 发布取消和断开事件。

---

# 12. 超时、重试和接收延迟

## 12.1 超时

每次协议请求拥有独立超时。

超时从实际发送完整请求后开始计算，不从进入队列时开始计算。

需要分别记录：

- queueWaitMs；
- writeDurationMs；
- responseDurationMs；
- totalDurationMs。

连接超时和请求超时是不同配置，不得共用同一个错误类型。

## 12.2 重试

重试规则：

1. retryCount 表示首次请求失败后允许的额外尝试次数；
2. 每次尝试使用新的 attempt 编号；
3. TCP 请求重试使用新的 Transaction ID；
4. RTU 请求重试清理当前请求的接收缓冲状态；
5. 每次尝试单独记录日志；
6. 最终结果记录累计耗时；
7. 用户取消后不再重试；
8. 用户主动断开后不再重试；
9. 参数校验错误不重试；
10. 明确的 Modbus 异常响应默认不重试；
11. 超时、临时连接错误和可配置的传输错误可以重试；
12. CRC 错误是否重试由 RetryPolicy 明确决定。

## 12.3 接收延迟

接收延迟（Rx Delay / interRequestDelayMs）已于 2026-09-06 移除（见 docs/features/2026-09-06-删除RxDelay.md）。

当前行为：

- 相邻请求之间无附加延迟（上一请求结束后立即开始下一请求）；
- 不用于判断帧结束；
- 不替代请求超时；
- 不影响已收到响应的解析。

---

# 13. 周期轮询设计

## 13.1 轮询模型

MVP 使用：

- 每行独立启用状态（WP 开关）；
- 轮询间隔为 0（读完一个立即读下一个，2026-09-06 移除 Rx Delay）；
- 不设独立的全局轮询间隔配置，不提供全部行持续轮询（ALL Polling）；
- 单连接；
- 每行单独功能码 03 请求；
- 不合并连续地址。

PollingCoordinator 管理需要轮询的行，但不直接访问 UI 表格。

每个轮询目标至少包含：

- workspaceId；
- sheetId；
- rowId；
- address；
- slaveAddress 或 unitId；
- enabled；
- generation；
- nextDueAt。

## 13.2 Generation 机制

当发生以下操作时增加行的 generation：

- 修改地址；
- 修改所属标签页；
- 删除行；
- 停止轮询；
- 切换连接；
- 修改影响请求目标的配置。

轮询结果返回时，只有 generation 与当前行一致才允许更新行状态。

该机制防止：

- 修改地址后旧响应覆盖新地址；
- 删除行后迟到响应重新创建状态；
- 关闭标签页后旧任务更新已销毁页面；
- 断开并重连后旧请求污染新连接。

## 13.3 轮询间隔语义

技术层将轮询间隔固定为 0（2026-09-06 移除 Rx Delay）：每个启用行在上一轮完成后立即重新加入轮询（读完一个立即读下一个）。

由于所有请求串行执行，实际刷新周期由请求往返时间决定。

调度器不保证严格实时性。

每行记录：

- configuredIntervalMs（= 0，2026-09-06 移除 Rx Delay 后恒定）；
- lastScheduledAt；
- lastStartedAt；
- lastCompletedAt；
- actualIntervalMs；
- skippedTicks；
- lastSuccessAt。

## 13.4 标签页切换

切换标签页不自动停止其他标签页的轮询，因为轮询状态属于工作区行为而非可见性行为。

关闭标签页时：

1. 停止该标签页所有轮询；
2. 取消尚未执行任务；
3. 已发送任务的返回结果不得更新已删除标签页；
4. 保存新的工作区状态。

如果后续产品决定只有当前标签页轮询，可通过策略替换，不改变底层队列。

## 13.5 全部轮询控制（不提供）

不提供全部行持续轮询（ALL Polling）功能。

轮询仅由每行 WP 开关控制。一次性全表读取（Read All）由 BatchReadCoordinator 实现，是一次性批量操作，不进入轮询调度。

停止轮询：

- 通过关闭各行的 WP 开关停止该行轮询调度；
- 关闭标签页时取消该标签页尚未执行的轮询任务；
- 不取消用户手动读取和写入；
- 不断开连接。

---

# 14. 全表读取设计

BatchReadCoordinator 负责全表读取。

处理流程：

1. 获取当前标签页不可变行快照；
2. 对每行执行地址校验；
3. 创建有效行任务；
4. 统计空行和无效行；
5. 按表格顺序提交读取；
6. 每行独立执行；
7. 单行失败后继续；
8. 发布进度；
9. 支持取消尚未执行的任务；
   （实现注记：浏览器/Electron RTU 本地 `BatchReadCoordinator` 真取消；Electron TCP/VSCode
   远程路径经 `session-batch-cancel`（渲染端生成 batchId 随请求传入，ADR-025）取消宿主批任务，
   UI 提供取消入口；取消语义见 ADR-025 与 docs/AGENTS.md §12.4）
10. 输出批次摘要。

> 范围行（多寄存器，ADR-030，2026-08-27 设计确认）：`BatchReadRow` 携带 quantity，范围行在
> 单次请求内读完全部连续寄存器（不跨行合并）；结果以 `values[]` 回传并按组合类型格式化；
> 单行失败不中断批次的原则不变。

批次摘要至少包含：

- batchId；
- totalRows；
- eligibleRows；
- successCount；
- failureCount；
- skippedCount；
- cancelledCount；
- startedAt；
- completedAt；
- durationMs。

全表读取和轮询同时存在时：

- 全表读取优先级高于普通轮询；
- 不清空轮询配置；
- 轮询任务不得重复积压；
- 批量完成后轮询继续；
- 对同一行的临近重复读取允许由调度器去重。

---

# 15. 写入与写后回读设计

## 15.1 Data 单元格单一当前值

Data 单元格采用单一当前值模型，不再区分读取值与待写草稿：

- 单元格内容即当前值，用户编辑直接改值；
- 读取成功后按当前 Type 格式化，强制覆盖单元格内容，包括用户正在输入时；
- 读取失败时不改变单元格内容，不做提示；
- 同一时刻只存在一份单元格文本，禁止在领域模型中为读取值和待写值维护两份独立文本。

用户开始编辑时：

1. 不创建独立草稿；
2. 该行不进入独立编辑状态；
3. 轮询结果直接覆盖单元格内容；
4. UI 无需区分实时值与待写值。

## 15.2 写入流程

1. 创建行快照；
2. 校验连接；
3. 校验地址；
4. 根据 Type 解析 Data 单元格当前文本；
5. 转换为 16 位原始值（范围行解析为多个原始值，ADR-030）；
6. 创建 0x10 写入请求（范围行为多值写，一次写全部连续寄存器）；
7. 进入统一队列；
8. 记录请求和响应；
9. 根据 Read Verify 规则决定是否回读；
10. 更新写入状态；
11. 写入失败不清空单元格内容。

## 15.3 写后回读

WriteVerifyCoordinator 将写入和回读视为相关但独立的两个阶段：

- write；
- optional-delay；
- verify-read；
- compare。

结果类型必须区分：

- write-failed；
- write-succeeded-no-verify；
- write-succeeded-verify-matched；
- write-succeeded-verify-mismatched；
- write-succeeded-verify-failed；
- cancelled-before-verify。

回读失败不能修改写入阶段的成功结论。

等待 100、200 或 500 ms 时使用可取消时钟，不直接使用散落的 setTimeout。

> 范围行（ADR-030）：一次 FC0x10 写全部子寄存器（`values[]`），回读 FC03 读 N 个连续寄存器并
> 逐项 compare；`WriteOutcome` 的 verify 结果携带 `readValues`/`expectedValues` 数组。

## 15.4 写入和轮询冲突

编辑不停止该行轮询，读取结果直接覆盖单元格内容。

写入任务提交后：

- 同一行的普通轮询任务暂缓；
- 写入及其回读完成后恢复；
- 其他行轮询可以继续；
- 如果用户停止轮询，则写入完成后不得自动重新启用；
- 如果行地址在写入过程中被修改，返回结果只能关联原请求快照，不能覆盖新地址状态。

---

# 16. 数据类型转换设计

## 16.1 原始值

内部统一使用 0 至 65535 的 16 位无符号整数表示寄存器原始值。

创建 RawRegisterValue 时必须验证：

- 是整数；
- 大于等于 0；
- 小于等于 65535。

通信层只处理 RawRegisterValue，不处理格式化字符串。

## 16.2 有符号转换

Signed 16 位解释规则：

- 原始值小于 0x8000 时，值不变；
- 原始值大于等于 0x8000 时，解释为 rawValue - 65536。

允许范围：

-32768 至 32767。

## 16.3 缩放类型

缩放类型使用十进制定点数，不使用二进制浮点直接判断输入精度。

缩放因子：

- 0.1：10；
- 0.01：100；
- 0.001：1000；
- 0.0001：10000。

写入转换：

    rawNumeric = decimalInput × scaleFactor

要求：

1. 输入小数位不得超过类型允许精度；
2. 转换结果必须为整数；
3. Signed 和 Unsigned 分别校验范围；
4. 不进行无提示四舍五入；
5. 不进行无提示截断；
6. 科学计数法默认不接受，除非后续明确支持；
7. 本地化逗号和小数点必须先由 UI 规范化，不得直接进入协议转换。

可以采用成熟十进制运算库，或通过字符串解析实现确定性的十进制转换。不得依赖浮点误差容忍来判断是否合法。

## 16.4 HEX

显示规则：

- 固定 4 位；
- 大写；
- 不包含 0x 前缀。

输入规则：

- 可接受可选的 0x 前缀；
- 可接受大小写；
- 去除首尾空格；
- 最多 4 位有效十六进制字符；
- 超出范围时返回结构化错误；
- 不无提示截断。

## 16.5 Binary

显示规则（ADR-051，2026-09-11）：

- 固定 16 位（单寄存器）；范围行宽度 = `registerCount × 16`；
- 每 8 位一组、组间单空格：16 位 `00000000 11111111`；32 / 48 / 64 位分别为 4 / 6 / 8 组；
- 只包含 0 和 1。

输入规则：

- 忽略任意空白（首尾、中间的空格 / 制表 / 换行），与显示对称（可粘贴已分组文本）；
- 不接受 0b 前缀，除非后续明确支持；
- 最多 16 位（单寄存器）/ `registerCount × 16` 位（范围行），按去空白后的位数校验；
- 超出范围时返回结构化错误；
- 不足位数可以在提交后补零显示（并按 8 位分组）。

## 16.6 Type 切换

Type 切换时：

- rawReadValue 不变；
- formattedReadValue 重新计算；
- 单元格文本不自动转换；
- 不允许因为 Type 切换而写入设备；
- 不修改通信报文；
- 不修改地址。

## 16.7 多寄存器组合类型（ADR-030，2026-08-27 设计确认）

范围行（Address 列 `start-end`，`registerCount>1`）按组合解释，一次请求读写全部连续寄存器：

- 32 位整数：2 个寄存器，大端合并 `values[0]<<16 | values[1]`（有符号按 32 位补码解释）；
- 64 位整数：4 个寄存器，BigInt 合并（`hi32<<32n | lo32`），输入/显示用 BigInt，超出 2^53 不丢精度；
- 二进制：1/2/3/4 个寄存器，位串按每 8 位一组显示（16/32/48/64 位 → 2/4/6/8 组，ADR-051）；
- 十六进制：任意数量，显示为空格分隔的 4 位大写组（如 `0400 0401`），解析兼容连续串；
- 字符串：任意数量，ASCII 编码，每寄存器 2 字符（高字节在前）。

scale 作用于组合十进制值（沿用 §16.3 十进制定点运算，防浮点误差）。

合法寄存器数校验（跨字段：范围长度 × 类型合法集，错误显示在进制列并禁止该行读写）：

- Unsigned/Signed：1 / 2 / 4；
- Binary：1 / 2 / 3 / 4；
- HEX 与 String：任意数量；
- 整体默认 1。

字节序默认大端（高字在前，Modbus 惯例）；「字节序和字序配置」仍为 P2 未来项（PRD §8.4）。

### 提交与粘贴后规范化（ADR-051，2026-09-11）

Data 单元格提交成功、或从剪贴板粘贴时，按该行 Type 写回**规范显示形式**（与读取后格式化同源：
`formatRawValue` / `formatRawValues` / 插件 `resolver.format`）：

- hex：4 位大写、无 `0x`；unsigned/signed：十进制去 `+` 与前导零；带 scale：按类型固定小数位；
- binary：每 8 位一组；hex 范围行：每寄存器 4 位大写、单空格；
- string：ASCII，补齐到 `2 × registerCount` 字符；bool：`0` / `1`；插件类型：由插件格式化器决定。

规范化不做任何舍入或截断（超范围 / 超小数位仍返回结构化错误）；解析失败时保留用户输入
（提交路径红框 + Tooltip、粘贴路径保留原文）。写入请求内容不受影响（仍按同一解析值组帧）。

---

# 17. 寄存器地址设计

## 17.1 内部表示

内部地址使用 0 至 65535 的整数。

UI 使用 4 位大写十六进制字符串显示。

例如：

- 用户输入 1；
- 提交后显示 0001；
- 内部值为十进制 1。

范围行（ADR-030，2026-08-27 设计确认）：Address 列支持 `start-end` 范围输入（按当前进制，
HEX 如 `0400-0401`、DEC 如 `1000-1001`），内部记录起始地址 + `registerCount`，范围 =
[start, start+count-1]；单地址输入等价于 count=1。

## 17.2 编辑状态和提交状态

地址字段分为：

- addressDraft；
- addressValue；
- addressValidation。

编辑中允许暂时存在不完整内容。

在以下时机提交：

- Enter；
- 单元格失焦；
- 用户执行读取或写入；
- 全表读取快照创建。

提交结果：

- 合法：更新 addressValue 并规范化显示（HEX 4 位大写补零 / DEC 去前导零；范围行两端各自规范化；ADR-051）；
- 空白：addressValue 为空（addressDraft 归一为 `""`）；
- 非法：保留 addressDraft 并显示错误；
- 超范围：保留 addressDraft 并显示错误。

不得在校验失败时清空用户输入。

## 17.3 地址调整（Address Adjust）

核心地址值表示实际准备发送的协议地址。

Address Adjust 为核心功能，位于 Connection Settings：

- OFF（默认）：发送地址 = 用户输入的寄存器地址；
- ON：发送地址 = 用户输入的寄存器地址 − 1。

转换需要记录：

- 用户输入地址；
- 最终发送地址；
- 日志中的两种地址。

核心协议层只接收最终已验证的实际发送地址，不了解 Address Adjust。

---

# 18. 工作区数据模型

## 18.1 Workspace

工作区为主要持久化聚合根。

建议字段：

    Workspace
      schemaVersion
      workspaceId
      name
      createdAt
      updatedAt
      activeSheetId
      sheets
      connectionProfiles
      activeConnectionProfileId
      pollingSettings
      readVerifySettings
      panelLayout
      preferences
      notes
      pluginStates
      migrationHistory

## 18.2 RegisterSheet

    RegisterSheet
      sheetId
      name
      type
      order
      rows
      createdAt
      updatedAt
      uiState

MVP 的 type 固定为 holding-register。

type 仍应保留，以支持未来增加其他表类型。

## 18.3 RegisterRow

    RegisterRow
      rowId
      order
      name
      comment
      addressDraft        // 支持 "start" 或 "start-end"（范围行，ADR-030）
      addressValue        // 起始地址；registerCount>1 时范围=[start, start+count-1]
      registerCount       // 范围长度，默认 1（ADR-030）
      dataType            // 进制/类型（hex/unsigned/signed 各 scale/binary/string）
      pollingEnabled
      traceEnabled
      cellText            // 组合值显示文本（范围行为组合解释）
      registerValues      // 各寄存器原始值数组，单一事实源（ADR-030，替代 lastKnownRawValue）
      createdAt
      updatedAt

是否持久化寄存器原始值应采用明确策略。

建议：

- 持久化最近成功值仅用于恢复显示（单行=`registerValues[0]`，范围行=整组）；
- 恢复后仅作为普通单元格文本展示，不视为当前设备实时值；
- 不持久化正在进行的请求状态；
- 不持久化运行时错误对象；
- 不自动恢复正在运行的轮询任务。

PRD 要求恢复轮询配置状态，但应用启动保持离线。因此恢复的是 pollingEnabled 配置，不是自动启动实际请求。

## 18.4 ConnectionProfile

RTU 配置：

    RtuConnectionProfile
      id
      name
      protocol
      baudRate
      dataBits
      stopBits
      parity
      flowControl
      slaveAddress       // 0~255，默认 1；0 不触发广播写入
      requestTimeoutMs
      retryCount
      interRequestDelayMs // Rx Delay，默认 50 ms，兼作 WP 轮询间隔
      addressAdjust      // OFF（默认）| ON（发送地址 = 用户地址 - 1）
      recentPortHint

> **持久化边界（2026-08-17 确认）**：工作区持久化「除串口/端口选择外」的全部连接配置——
> 端口参数（baudRate、dataBits、stopBits、parity、flowControl）与从站地址、requestTimeoutMs、
> retryCount、interRequestDelayMs、addressAdjust 均随工作区保存。串口/端口选择本身是
> 运行时会话状态（浏览器侧每次打开 Connection Settings 处于待选状态），不进入持久化；
> recentPortHint 仅作端口提示（docs/AGENTS.md §19.3），不用于自动连接。旧数据格式兼容，
> schemaVersion 不变。

TCP 配置：

    TcpConnectionProfile
      id
      name
      protocol
      host
      port
      unitId             // 0~255，默认 0（2026-08-23 确认：MBAP Unit Identifier 为 RTU Slave ID 的 TCP 版本，纯 TCP 忽略寻址、网关场景寻址；与 RTU Slave Address 默认 1 不同）
      connectTimeoutMs
      requestTimeoutMs
      retryCount
      autoReconnect
      interRequestDelayMs // 请求间隔，兼作 WP 轮询间隔（内部字段，不入表单）

> **持久化边界（2026-08-23 确认，ADR-022；2026-08-25 更新，ADR-026）**：TCP 配置随工作区
> 持久化（host/port/unitId/requestTimeoutMs/retryCount/interRequestDelayMs；
> connectTimeoutMs/autoReconnect 默认值随 profile 保存）。恢复后保持离线、不自动连接；
> **Unit ID 会话内可动态修改（2026-08-25，ADR-026）**：与 RTU 每表从站地址同构——工具栏
> 按协议切换「Slave Address / Unit ID」，每表独立值经 `session-set-unit-id`（远程端）对
> 后续请求生效；连接建立时按活动表值覆盖 profile.unitId 初始值。

串口路径不作为必须恢复项。

recentPortHint 只能用于显示最近使用信息，不得触发自动连接。

## 18.4.1 连接对象配置文件（ADR-023；应用侧功能已由 ADR-034 移除）

外部连接对象（真实设备连接参数）以 `config/connections.json` 集中管理，**仅供测试/验证脚本消费**
（real e2e 参数、探针，消除 COM4/COM5/127.0.0.1:1502 硬编码）。应用侧「Load from Config File」
用户功能（UI 分组、`connection-config-load` kind、三端 `config-loader.ts`、`packages/connection-config`
包、能力矩阵 `connectionConfig` 字段、浏览器 `?connectionConfig=<base64>` URL）已于 2026-08-29
**整体移除（ADR-034）**，连接对象导入改由 **Settings → 工作区导入**（ADR-033）承担：工作区 JSON
已含 `connectionProfiles`，导入后 Connection Settings 以 `connectionProfiles[0]` 预填连接表单。

配置文件格式（JSON，schemaVersion 1）：

    ConnectionConfigFile
      schemaVersion           // 1
      activeConnectionId      // 默认连接对象 id（测试脚本可忽略，可 null）
      connections[]           // RTU 连接对象（port/baudRate/dataBits/stopBits/parity/flowControl/
                              //   slaveAddress/requestTimeoutMs/retryCount/interRequestDelayMs/addressAdjust）
                              // TCP 连接对象（host/port/unitId/connectTimeoutMs/requestTimeoutMs/
                              //   retryCount/autoReconnect/interRequestDelayMs）

- 省略字段按 `defaultConfig` 回填；`port`（串口名）为配置文件特有字段，不进入 `connectionProfiles`
  持久化（ADR-017 边界不变）；RTU `slaveAddress` 为该连接对象的默认从站地址。
- 消费方：`scripts/e2e-real.mjs`（`scripts/lib/connection-config.mjs` `findConnection`）、
  `scripts/prototype/electron-serial-probe.mjs`、各端 real e2e spec（readFileSync 直读）。
  字段说明与消费方式详见 `config/README.md`。

## 18.5 ReadVerifySettings

    ReadVerifySettings
      mode
      delayMs

mode：

- off；
- immediate；
- delayed。

当 mode 为 delayed 时，delayMs 只能为允许的配置值。

## 18.6 PollingSettings

    PollingSettings
      enabledBehavior
      maxPendingPollingTasks

MVP 不设独立的全局轮询间隔配置（intervalMs）。轮询间隔使用连接配置中的 Rx Delay（interRequestDelayMs，默认 50 ms），随连接配置快照生效。

MVP 中 maxPendingPollingTasks 由系统内部控制，不提供给普通用户配置。

## 18.7 PanelLayout

包含：

- 侧边栏展开状态；
- 侧边栏宽度；
- 底部面板展开状态；
- 底部面板高度；
- 当前底部标签页；
- 可选表格列宽；
- 可选表格列显示状态。

布局数据损坏时使用默认布局，不影响核心工作区恢复。

## 18.8 PluginState

    PluginState
      pluginId
      enabled
      settings
      lastKnownVersion
      permissions
      platformState

插件不存在时保留其配置，但不加载。

插件重新安装后，必须重新执行兼容性和权限检查。

---

# 19. 持久化设计

## 19.1 Repository 接口

WorkspaceRepositoryPort 至少提供：

- load；
- save；
- reset；
- export；
- import；
- createBackup；
- getRecoveryInfo。

UI 不直接调用 IndexedDB 或文件系统。

## 19.2 自动保存

AutoSaveCoordinator 监听可持久状态变更。

策略：

1. 对连续编辑采用 debounce；
2. 关键结构操作可立即触发保存；
3. 应用关闭前尝试 flush；
4. 每次保存生成完整一致的工作区快照；
5. 不在保存过程中读取正在变化的可变对象；
6. 保存失败发布结构化错误；
7. 保存失败不得清除内存状态；
8. 自动保存不对外展示保存状态，仅手动保存场景展示保存中、已保存和失败状态；
9. 保存操作串行执行；
10. 新保存请求到来时合并中间状态，只保存最新快照。

## 19.3 浏览器 IndexedDB

浏览器使用 IndexedDB 保存：

- 当前工作区；
- 备份；
- 插件元数据；
- 有上限的消息和日志；
- Schema 版本。

建议使用成熟的轻量 IndexedDB 封装库，避免直接维护大量事件式 API。

浏览器存储异常处理：

- 隐私模式或存储不可用；
- 配额不足；
- 数据库升级失败；
- 事务中断；
- 数据验证失败；
- 用户清理站点数据。

## 19.4 Electron 文件持久化

Electron 使用应用数据目录下的版本化 JSON 文件。

原子保存流程：

1. 序列化到临时文件；
2. 完成写入；
3. 尽可能执行同步刷新；
4. 将当前文件改为备份；
5. 将临时文件原子替换为正式文件；
6. 更新保存状态；
7. 定期清理旧备份。

不得由 Renderer 直接写入文件。

文件权限和路径由 Main Process 控制。

> **实现状态（2026-08-30，ADR-036）**：已落地——主进程 `WorkspaceFileRepository`
> （`apps/electron/src/main/workspace-file-repository.ts`）实现 `WorkspaceRepositoryPort`，
> 文件布局 `userData/workspace.json` + `workspace.json.bak`（单份备份轮转，与浏览器 IndexedDB
> 单备份语义一致；「定期清理旧备份」在单份策略下退化为每次轮转覆盖）；原子保存流程 1→5 已实现
> （临时文件 → 写入 → `fsync` → 主改备份 → 临时文件原子替换，Windows `rename` 目标已存在先 `rm`
> 兜底）；损坏时从 .bak 恢复并自愈写回主文件；Renderer 经 `workspace-load/save/clear`
> HostMessage v1 kind 走薄桥 `FileWorkspaceRepository`（`apps/web/src/file-workspace-repository.ts`），
> 不直接触碰文件系统；能力矩阵 `electronCapabilities.filesystem: "full"`。

## 19.5 VSCode 持久化

VSCode 使用两层存储：

1. workspaceState 或 globalState；
2. 可选工作区配置文件。

workspaceState/globalState 保存：

- 当前应用状态；
- UI 布局；
- 最近使用信息；
- 不适合共享的本地状态。

工作区配置文件保存：

- 可跨机器或团队共享的寄存器表；
- 标签页；
- 备注；
- 非敏感配置。

是否默认创建工作区文件由后续产品决策决定。技术上需要支持两种 Repository 实现。

## 19.6 数据版本和迁移

每个工作区包含 schemaVersion。

加载流程：

1. 解析 JSON；
2. 检查基础结构；
3. 读取 schemaVersion；
4. 顺序执行迁移；
5. 使用当前 Schema 校验；
6. 创建迁移后备份；
7. 返回领域对象。

迁移必须：

- 单向；
- 可重复测试；
- 不直接修改原始文件；
- 保留未知插件配置；
- 记录迁移历史；
- 遇到无法迁移数据时尽可能部分恢复。

既有/规划迁移：v1→v2（ADR-029，全局 readVerifySettings → 各表 writeVerify）；规划 v2→v3
（ADR-030：`lastKnownRawValue` → `registerValues`、补 `registerCount=1`、`dataType` 新增
"string"）。

## 19.7 损坏恢复

如果主工作区损坏：

1. 尝试读取备份；
2. 若备份有效，进入恢复模式；
3. 保留损坏原文件；
4. 提示恢复来源和时间；
5. 允许导出损坏文件；
6. 允许创建新工作区；
7. 不因单个插件配置损坏而放弃全部工作区；
8. 对无法恢复的字段采用明确默认值并记录告警。

---

# 20. 日志设计

## 20.1 日志类型

分为：

1. ApplicationMessage；
2. CommunicationLogEntry；
3. DiagnosticLog。

ApplicationMessage 面向用户。

CommunicationLogEntry 面向通信调试。

DiagnosticLog 面向开发和故障定位，不默认展示全部内部细节。

## 20.2 通信日志模型

每条通信日志建议包含：

    CommunicationLogEntry
      id
      timestamp
      connectionId
      protocol
      source
      direction
      slaveAddressOrUnitId
      transactionId
      functionCode
      registerAddress
      registerCount
      rawBytes
      attempt
      queueWaitMs
      durationMs
      status
      modbusExceptionCode
      errorCode
      errorMessage
      metadata

原始数据在内存中使用 Uint8Array，在展示和导出时转换为大写十六进制字节串。

## 20.3 请求和响应关联

每次尝试拥有独立 attemptId。

写入和回读通过 operationGroupId 关联。

全表读取通过 batchId 关联。

轮询通过 pollingCycleId 或 rowId 关联。

这些关联字段随日志一并导出（CSV），供用户在第三方软件（如 Excel）中自行筛选；本软件不提供日志搜索/过滤。

## 20.4 日志保留策略

为避免长时间运行导致内存无限增长：

- 通信日志采用环形缓冲；
- 消息日志采用独立上限；
- 上限可在设置中配置；
- 达到上限后删除最旧条目；
- 导出时只导出当前缓冲区内容；
- 后续版本可增加流式文件日志；
- Trace 数据不与普通通信日志共用无限缓冲。

## 20.5 原始报文展示

展示格式：

- 大写十六进制；
- 字节间使用空格；
- 不进行本地化；
- 对请求和响应使用不同方向标识；
- 同时展示解析后的功能码和地址；
- 插件转换地址时同时展示用户地址和实际发送地址。

## 20.6 日志隐私

导出前提示日志可能包含：

- IP 地址；
- 串口信息；
- 设备地址；
- 寄存器地址；
- 寄存器数据；
- 插件元数据。

默认不记录：

- 操作系统用户名；
- 完整个人目录；
- 与调试无关的环境变量；
- 插件私有凭据；
- 未经用户允许的任意文件内容。

---

# 21. 错误模型

## 21.1 结构化错误

所有应用可识别错误使用 MamepError。

建议字段：

    MamepError
      code
      category
      severity
      retryable
      userMessageKey
      technicalMessage
      cause
      context

category：

- validation；
- capability；
- permission；
- connection；
- transport；
- timeout；
- protocol；
- modbus-exception；
- cancellation；
- persistence；
- plugin；
- internal。

UI 不通过字符串匹配判断错误类型。

## 21.2 错误代码示例

连接和传输：

- SERIAL_NOT_FOUND；
- SERIAL_PERMISSION_DENIED；
- SERIAL_PORT_BUSY；
- SERIAL_OPEN_FAILED；
- SERIAL_DEVICE_REMOVED；
- TCP_INVALID_HOST；
- TCP_CONNECTION_REFUSED；
- TCP_CONNECT_TIMEOUT；
- TCP_CONNECTION_RESET；
- CONNECTION_NOT_ACTIVE。

协议：

- RTU_CRC_MISMATCH；
- RESPONSE_TOO_SHORT；
- RESPONSE_LENGTH_MISMATCH；
- SLAVE_ADDRESS_MISMATCH；
- UNIT_ID_MISMATCH；
- FUNCTION_CODE_MISMATCH；
- TRANSACTION_ID_MISMATCH；
- MODBUS_EXCEPTION_RESPONSE；
- PARTIAL_RESPONSE_TIMEOUT。

数据：

- INVALID_REGISTER_ADDRESS；
- INVALID_HEX_VALUE；
- INVALID_BINARY_VALUE；
- VALUE_OUT_OF_RANGE；
- VALUE_PRECISION_EXCEEDED；
- UNSIGNED_NEGATIVE_VALUE。

持久化：

- WORKSPACE_PARSE_FAILED；
- WORKSPACE_SCHEMA_UNSUPPORTED；
- WORKSPACE_SAVE_FAILED；
- WORKSPACE_STORAGE_FULL；
- WORKSPACE_MIGRATION_FAILED。

插件：

- PLUGIN_MANIFEST_INVALID；
- PLUGIN_VERSION_INCOMPATIBLE；
- PLUGIN_PLATFORM_UNSUPPORTED；
- PLUGIN_PERMISSION_DENIED；
- PLUGIN_LOAD_FAILED；
- PLUGIN_HOOK_FAILED。

## 21.3 用户信息与技术信息分离

用户界面显示：

- 简短原因；
- 可执行建议；
- 相关字段；
- 是否可以重试。

诊断日志保存：

- 底层错误；
- 堆栈；
- 平台错误码；
- 请求上下文。

不得直接把未知异常堆栈作为主要用户提示。

---

# 22. 平台通信桥设计

## 22.1 统一 Host API

共享 UI 通过 MamepHostApi 与平台通信。

主要能力：

- getCapabilities；
- listSerialPorts（后续版本 Electron/VSCode 枚举实现；MVP 阶段 Browser 与 Electron 均由授权 picker 承担，不实现，ADR-017）；
- requestSerialPort；
- connect；
- disconnect；
- executeCommand；
- loadWorkspace；
- saveWorkspace；
- listPlugins；
- enablePlugin；
- disablePlugin；
- subscribeEvents；
- exportData；
- importData。

Browser Host 可以在同一线程直接实现该接口。

Electron 和 VSCode 使用消息桥实现。

## 22.2 消息协议

所有跨边界消息使用版本化 Envelope：

    HostMessage
      protocolVersion
      messageId
      kind
      payload

消息类型分为：

- request；
- response；
- event；
- error。

要求：

1. 每条请求有唯一 messageId；
2. 响应引用原 messageId；
3. payload 使用 Zod 校验；
4. 未知 kind 被拒绝；
5. 不允许任意方法名调用；
6. 支持取消长任务；
7. 支持连接、日志和进度事件；
8. 消息协议版本可演进；
9. 错误通过结构化对象传递；
10. Uint8Array 采用明确可序列化格式传输。

> 多寄存器（ADR-030，2026-08-27 设计确认）：不加新 kind，扩展既有 payload 字段——
> `registerRowPayloadSchema` 增 `registerCount`（+ "string" 类型）、`batchReadRowPayloadSchema`
> 增 `quantity`、`poll-result` 结果支持 `values[]`、`writeOutcomePayloadSchema` verify 字段数组化；
> 三端 AppHost 已收整行对象天然透传。

## 22.3 Electron IPC

安全要求：

- contextIsolation 开启；
- nodeIntegration 关闭；
- sandbox 在可行范围内开启；
- Renderer 无通用 IPC 访问权；
- preload 仅暴露白名单 API；
- Main Process 校验所有输入；
- 不允许 Renderer 指定任意文件路径执行读写；
- 不允许 Renderer 执行任意命令；
- 不允许 Renderer 加载任意 Node.js 模块；
- 外部链接通过受控方式打开；
- Content Security Policy 明确配置。

## 22.4 VSCode Webview RPC

要求：

- Webview 使用严格 CSP；
- 资源使用 Webview 安全 URI；
- 使用 nonce；
- 不启用不需要的权限；
- 所有消息由 Extension Host 校验；
- 工作区未受信任时限制高风险能力；
- Webview 销毁时取消订阅；
- Extension 停用时释放连接；
- 不把任意文件系统能力暴露给 Webview；
- 插件能力由 Extension Host 控制。

---

# 23. 插件架构

## 23.1 设计原则

1. 插件不直接修改核心源代码；
2. 插件只通过稳定贡献点扩展；
3. 插件必须声明平台支持；
4. 插件必须声明权限；
5. 单个插件失败不能导致核心应用失败；
6. 插件不能绕过统一通信队列；
7. 插件不能直接取得底层串口句柄；
8. 插件通信请求必须生成日志；
9. 插件配置必须拥有独立命名空间；
10. 插件 API 采用版本化设计。

## 23.2 插件类型

定义两类插件：

### UI-safe 插件

可在三端运行，能力受限。

适合：

- 数据显示类型；
- 工具面板；
- 文档和寄存器手册；
- 地址显示；
- 纯计算工具；
- 受控命令按钮。

不得执行任意 Node.js 代码。

### Host 插件

仅在 Electron 或 VSCode Host 中运行。

适合：

- 厂商私有协议；
- 特殊通信封装；
- 本地文件处理；
- 受控设备操作。

Host 插件需要更严格的安装、权限和兼容性控制。

浏览器端不加载 Host 插件。

## 23.3 MVP 插件装载范围

> 已确认（2026-08-23，PRD §20.6）：MVP 仅预留架构、不对用户开放插件安装能力——维持「内置 / 受信任」边界（Manifest 驱动启停、错误隔离、平台能力声明已具备），浏览器端已有最小插件注册表保留为内部扩展验证；本地安装、安川示例插件、插件开发文档均延后到 V1.0 评估。

为降低任意代码执行风险，MVP 优先支持：

1. 随应用构建的内置插件；
2. 开发模式下的受信任本地插件；
3. Manifest 驱动的启用和禁用；
4. 插件加载错误隔离；
5. 平台能力检查；
6. 插件贡献点注册。

不在 MVP 默认开放从互联网下载并执行任意第三方插件。

## 23.4 Manifest

插件 Manifest 至少包含：

    PluginManifest
      id
      name
      version
      apiVersion
      author
      description
      license
      entry
      supportedPlatforms
      requiredCapabilities
      permissions
      contributes

permissions 可能包括：

- communication；
- workspace-read；
- workspace-write；
- file-read；
- file-write；
- network；
- ui-contribution。

MVP 不一定开放所有权限，但 Schema 应预留明确扩展方式。

## 23.5 贡献点

建议支持：

- command；
- toolbarAction；
- sidebarView；
- bottomPanel；
- contextMenu；
- dataType；
- addressTransform；
- protocolExtension；
- documentation；
- settings。

插件按钮执行后调用受控 command，不直接访问 UI 内部 Store。

## 23.6 通信能力

插件发起通信时必须通过 PluginCommunicationApi。

该 API：

- 校验插件权限；
- 校验当前平台；
- 创建 source 为 plugin 的请求；
- 进入统一 RequestScheduler；
- 记录 pluginId；
- 应用超时和取消；
- 不暴露 Transport；
- 不允许插件自行并发写串口。

## 23.7 插件错误隔离

插件 Hook 执行时：

1. 设置独立错误边界；
2. 捕获同步和异步异常；
3. 记录 pluginId；
4. 禁用故障贡献点；
5. 保持核心工作区可用；
6. 向用户展示可理解的加载失败原因；
7. 不因单个插件失败阻止其他插件加载。

## 23.8 插件版本兼容

插件声明 apiVersion。

Host 根据兼容范围决定：

- 可加载；
- 可加载但警告；
- 禁止加载。

插件 API 的破坏性修改必须提升主版本，并通过适配层保留必要的过渡期。

---

# 25. 安全设计

## 25.1 基础原则

1. 最小权限；
2. UI 与本地系统能力隔离；
3. 所有跨边界输入校验；
4. 插件权限可见；
5. 不自动上传数据；
6. 不自动执行未知插件；
7. 不自动连接设备；
8. 不把设备通信能力暴露给不受控脚本；
9. 日志导出由用户主动触发；
10. 开源示例不得包含私有资料。

## 25.2 写入安全边界

Mamep2026 不理解所有寄存器的业务风险，但技术上仍需要确保：

- 只有用户明确操作或已授权插件命令可以写入；
- 轮询任务不得产生写请求；
- 工作区恢复不得自动执行写入；
- 插件启用不得自动执行设备写入；
- 写入地址和实际发送地址进入日志；
- 地址插件转换必须可见；
- 禁止因重试策略对非幂等私有写入进行未经声明的重复执行；
- 标准 0x10 写入重试行为由明确策略控制。

## 25.3 内容安全策略

Browser、Electron Renderer 和 VSCode Webview 均配置 CSP。

默认要求：

- 不执行 inline script；
- 不使用 eval；
- 不从不受信任远程地址加载脚本；
- 图标和字体优先随应用打包；
- Webview 资源限制在授权 URI；
- 插件 UI 不允许注入共享页面 DOM；
- 外部链接经过 Host 确认后打开。

---

# 26. 测试架构

## 26.1 测试层级

测试分为：

1. 领域单元测试；
2. 协议编解码测试；
3. 通信调度测试；
4. 持久化测试；
5. React 组件测试；
6. 平台适配集成测试；
7. 跨端契约测试；
8. 端到端测试；
9. 真实设备验收测试。

## 26.2 单元测试

重点测试：

- CRC-16；
- 功能码 03 编解码；
- 功能码 0x10 编解码；
- TCP MBAP；
- 地址校验；
- HEX 和 Binary；
- Signed 和 Unsigned；
- 十进制缩放；
- 精度错误；
- 工作区迁移；
- 错误映射；
- 插件 Manifest；
- 状态机转换。

纯函数测试不得依赖真实时间或真实设备。

## 26.3 协议测试向量

协议测试应使用固定请求和响应向量。

每组向量至少包含：

- 输入领域请求；
- 预期字节；
- 输入响应字节；
- 预期领域结果；
- 错误变体。

错误变体包括：

- CRC 错误；
- 响应地址错误；
- 功能码错误；
- 数据长度错误；
- 异常响应；
- TCP Transaction ID 错误；
- Unit ID 错误；
- 部分帧；
- 粘包。

## 26.4 通信调度测试

使用 Virtual Clock 和 Fake Transport 测试：

- 同一时刻只有一个请求；
- 手动操作优先于轮询；
- 轮询不积压；
- 请求超时；
- 重试次数；
- 取消；
- 断开；
- 迟到响应；
- 写后回读；
- 全表读取继续执行；
- 插件请求进入同一队列；
- 修改地址后旧结果被丢弃；
- 删除行后不再发送请求。

不得使用真实等待时间编写调度单元测试。

## 26.5 持久化测试

覆盖：

- 正常保存和加载；
- Schema 版本迁移；
- 损坏 JSON；
- 缺失字段；
- 插件字段未知；
- 保存中断；
- 主文件损坏后从备份恢复；
- 保存失败后内存状态保留；
- 串口号恢复规则；
- 恢复后保持离线；
- 轮询配置恢复但不自动发送请求。

## 26.6 组件测试

覆盖：

- 地址提交和错误展示；
- Data 单元格直接编辑、读取结果强制覆盖、读取失败不改动内容；
- Type 切换；
- 轮询状态；
- 连接状态；
- 全表读取进度；
- 日志导出；
- 对话框焦点；
- 多行复制粘贴；
- 键盘导航；
- 自动保存静默（不对外展示保存状态）；
- 插件加载错误。

组件测试使用 Application Service Fake，不连接真实串口。

## 26.7 浏览器端到端测试

当前实现（2026-08）：浏览器 E2E 使用 Playwright（系统 Edge，`channel: "msedge"`），通过 dev 内置模拟 Modbus RTU 传输 `?mockTransport=1`（生产构建不包含）完成主要 UI 验收（tests/e2e-web，配置见 [浏览器端自动化测试方法指南](浏览器端自动化测试方法指南.md)）；真实 Web Serial 验收留待后续。

自动化覆盖：

- 首次工作区；
- 新建标签页；
- 编辑地址；
- 读取；
- 写入；
- 轮询；
- 日志；
- 保存和恢复；
- 浏览器不支持时的能力提示；
- 浏览器端不出现 TCP 入口。

## 26.8 Electron 端到端测试

覆盖：

- 启动；
- Main 和 Renderer IPC；
- 串口列表；
- TCP 连接；
- 文件持久化；
- 窗口重启恢复；
- 断开释放；
- 插件加载失败隔离；
- Renderer 无直接 Node.js 权限。

> 实现状态（2026-08-21，ADR-016/017 扩展）：已建立 `tests/e2e-electron/`（Playwright + Electron，`pnpm test:e2e:electron` 自动先 `build:electron`）——已覆盖：启动加载同一共享 UI、Main/Renderer IPC（HostMessage v1 校验）、preload 白名单桥、能力矩阵（RTU 支持 / enumerated 下拉选择）、`debug:get-state` 探针、剪贴板、Renderer 无直接 Node.js 权限、无 console 错误、关窗退出，以及串口下拉选择 + RTU 读写闭环（`serial-rtu-loop.spec.ts`：注入自包含可控 fake `navigator.serial` + 内联 CRC16 RTU responder，覆盖下拉空态/取消、下拉选择、FC03 读/FC10 写；主进程 `select-serial-port` 转发与 `resolvePendingSelection` 逻辑由 `apps/electron` 单测覆盖）。**TCP 闭环已覆盖（2026-08-23，ADR-022）**：`tcp-loop.spec.ts` 在测试进程内启动本地回环 MBAP TCP Server，经 Connection Settings TCP 表单连接主进程会话 → FC03 读/FC10 写闭环 + 无 console 错误。未覆盖（待后续版本落地）：文件持久化、窗口重启恢复、断开释放、插件加载失败隔离。

## 26.9 VSCode 集成测试

覆盖：

- 扩展激活；
- 命令注册；
- Webview 打开；
- Extension 与 Webview RPC；
- 工作区存储；
- TCP；
- RTU Adapter；
- 主题切换；
- 工作区信任限制；
- 扩展停用时释放连接；
- VSCode 重载后保持离线并恢复工作区。

## 26.10 虚拟 Modbus 设备

测试工具应提供 Scripted Modbus Device。

支持配置：

- 正常响应；
- 响应延迟；
- 不响应；
- CRC 错误；
- 异常码；
- 地址不匹配；
- 功能码不匹配；
- 响应长度错误；
- 分片响应；
- 多响应粘连；
- 连接中断；
- 写入后值一致；
- 写入后值不一致；
- 写入成功但回读失败。

虚拟设备必须能够记录收到的原始请求，以验证实际发送地址和功能码。

## 26.11 真实设备测试

自动化模拟不能完全替代真实设备验收。

发布前至少验证：

- Windows COM1 至 COM9；
- USB 转串口设备插拔；
- 串口占用；
- 实际 RTU 03；
- 实际 RTU 0x10；
- Electron TCP；
- VSCode TCP；
- 浏览器授权和断开；
- 不同波特率；
- 超时与重试；
- 长时间轮询资源释放。

真实设备测试结果应记录环境信息，但具体执行清单放入测试文档或发布流程，不写入 AGENTS.md 以外的代理执行细节。

## 26.12 真实端口 e2e（com0com + 真实从站，ADR-024）

2026-08-24 落地（ADR-024）：三端「真实端口」e2e 作为**默认真实路径**的自动化闭环，
与 MOCK/FAKE（`?mockTransport=1`、`MAMEP_FAKE_SERIAL/TCP=1`）正交（MOCK 保留为显式可选
dev 手段）。统一编排 `scripts/e2e-real.mjs <web|electron|vscode|all>`：预检（RTU 用
serialport `list()` 检查主站口 rtu-com4-master.port 与从站口 modbus-slave.config.json.port
均存在；TCP 探测 tcp-local-slave 端口可监听）→ 设 `MAMEP_REAL=1` → 拉起从站（RTU: COM5 /
TCP: 127.0.0.1:1502，均来自 `config/connections.json` / 从站自身配置，不硬编码）→ 跑对应端
命令 → 回收。缺环境 → SKIP 提示、退出码 0（不失败）。命令：`pnpm test:e2e:real`（all）、
`pnpm test:e2e:web:real` / `:electron:real` / `:vscode:real`。

- **从站**：`scripts/modbus-slave/lib/modbus-core.mjs`（RTU/TCP 单一事实源：7 区 DEFAULT_RULES、
  行为归一化、CRC、日志、响应投递）+ `modbus-rtu-slave.mjs`（COM5，重构复用 lib，`--self-test`
  保回归）+ `modbus-tcp-slave.mjs`（MBAP，默认 host/port/unitId 取 config tcp-local-slave）。
  扩展行为（真实从站配置，不在 DEFAULT_MOCK_RULES）：`delayedResponse`（0x0700 延迟 2500ms →
  超时/迟到丢弃；2026-08-25 从 1500ms 上调——1500ms 落在 1000ms×2 重试窗口内会被重试消费，
  RTU 无事务 ID 无法区分）与 `splitResponse`（0x0800 拆段 2B/5ms → 半包/粘包组帧）。
- **浏览器**（`tests/e2e-web/tests-real/real-serial.spec.ts`，系统 Edge 有头）：Connection
  Settings → 系统 Web Serial picker（用户手势，启动时选择 COM4 一次）→ 记录 localStorage
  （`mamep:real-serial-port`）→ `test.describe.serial` 共享 page/连接复用；跨运行打印上次选择。
- **Electron**（`tests/e2e-electron/tests-real/real-serial.spec.ts` / `real-tcp.spec.ts`，
  生产构建路径，全自动）：RTU 走串口下拉枚举（用户手势）→ 自动选 config 指定串口 COM4；
  TCP 走切 Modbus TCP → 按 config tcp-local-slave 填表。
- **VSCode**（`tests/e2e-vscode/real/real-rtu.spec.ts` / `real-tcp.spec.ts`，
  vscode-test-playwright 0.0.1-beta2，UI 级断言）：extensionDevelopmentPath 加载扩展 → 生产
  webview（未设 MAMEP_DEV_URL → getProdHtml）→ `workbox.frames()` 定位承载共享 UI 的 webview
  内容 frame（VSCode 1.134 为两层：容器 index.html + 内容 fake.html，2026-08-25 修复；该库
  经 pnpm patch 绕过已移除的 playwright._toImpl）→ RTU 串口下拉 serial-enumerate（RPC）选
  COM4；TCP 按 config 填表。
  fixture 每测试新建 VS Code 实例 → 每协议单测试 + `test.step()` 控制启动次数。
- **场景矩阵（三端一致，RTU/TCP）**：连接 Online → FC03 读（0x0000=0x04D2）/ FC10 写 + 读回
  → 写值门控 0x0400（0x8000 拒/0x1234 成）→ 异常区 0x0100/0x0200/0x0300→0x02、0x0500→0x01
  → no-response 0x0600 超时且后续正常 → 边界 0x0000/0xFFFF → 扩展 0x0800 分片 / 0x0700 延迟
  → 通信日志帧字节 → 断开/重连（浏览器仅断开一次，重连稳定性由桌面端覆盖）→ 无 console 错误。
- 能力矩阵如实声明（modbusRtu/serialPorts/modbusTcp；`connectionConfig` 能力位已于 2026-08-29 移除，ADR-034）；无新增 HostMessage
  kind；浏览器不追加 TCP；测试参数不硬编码（读 `config/connections.json`）。
- **2026-08-25 修正（ADR-028）**：ADR-024 落地后真实端口 e2e 实际从未真正跑通（「已落地」≠
  「已跑通」），首次全量回归暴露并修复多层问题（从站 LOG_LEVELS 未导入、real 套件 setRadixHex
  用错 .ant-select、fill+Enter React 受控组件竞态（UI 根治：EditableCellValue 用 draftRef 同步草稿）、通信日志虚拟列表断言、HostMessage 错误投影
  bug（两端 ipc errorEnvelope 硬编码 userMessageKey/category）、vscode-test-playwright _toImpl
  补丁、VSCode webview 两层 frame 定位、串口下拉误点连接对象下拉、electron-smoke 白名单等），
  三端真实端口 e2e 首次全绿（web 12 / electron 24 / vscode 3）。详见 ADR-028。

---

# 27. 构建和发布设计

## 27.1 构建产物

Browser：

- 静态 HTML、CSS 和 JavaScript；
- 可部署到静态站点；
- 不包含 Node.js 依赖；
- 不包含 TCP 功能代码入口。

Electron：

- Windows 安装包（MVP 落地为免安装绿色版：`pnpm dist:portable` 产出 `release/win-unpacked/` 整个文件夹拷贝即用，ADR-018；后续升级 `win.target: nsis` 产正式安装包）；
- macOS 安装包（未落地）；
- Linux 安装包（未落地）；
- 对原生串口依赖执行目标平台构建（MVP 用 Web Serial，暂无原生依赖）；
- Renderer 与 Main 分离打包（ADR-016：`dist-electron/` + `apps/web/dist-electron/`）。

VSCode：

- VSIX；
- Extension Host Bundle；
- Webview 静态资源；
- 平台相关原生依赖按发布策略处理。

## 27.2 原生串口依赖

> 本节针对后续版本 Node 串口库替换阶段（ADR-017）；Electron MVP 使用 Web Serial API，不涉及原生串口模块。

串口库可能包含原生模块，需要处理：

- Electron ABI；
- Node.js ABI；
- VSCode 内置 Node.js 版本；
- Windows、macOS 和 Linux 构建；
- x64 与 arm64；
- 发布包体积；
- 原生模块签名。

为降低风险：

1. Node Serial Adapter 与具体库隔离；
2. 建立启动时原生模块自检；
3. CI 在目标平台构建；
4. Electron 和 VSCode 不直接共享已编译的二进制产物；
5. 按目标 Host 分别打包；
6. 原生依赖升级按用户要求执行真实连接回归。

## 27.3 CI 流程

持续集成阶段包括：

1. 依赖安装；
2. 格式检查；
3. ESLint；
4. TypeScript 类型检查；
5. 单元测试；
6. 协议测试；
7. 组件测试；
8. 包依赖边界检查；
9. Browser 构建；
10. Electron 构建；
11. VSCode 构建；
12. 端到端测试；
13. 安全和许可证检查；
14. 发布产物生成。

CI 应在 Windows、macOS 和 Linux 上执行必要的平台构建验证。

## 27.4 包依赖边界检查

使用静态依赖检查阻止：

- domain 引用 React；
- protocol-modbus 引用平台包；
- web 引用 Node.js Adapter；
- UI 引用 Electron；
- UI 引用 VSCode；
- Renderer 引用串口库；
- 插件直接引用核心内部未公开模块；
- 平台包形成循环依赖。

## 27.5 版本策略

建议：

- 应用采用语义化版本；
- 插件 API 拥有独立 apiVersion；
- 工作区拥有独立 schemaVersion；
- Host Message 拥有独立 protocolVersion；
- 三者不得共用同一个版本号表达不同兼容关系。

---

# 29. 可观测性与诊断

## 29.1 内部诊断事件

系统内部发布：

- connection-state-changed；
- request-enqueued；
- request-started；
- request-retried；
- request-completed；
- request-failed；
- request-cancelled；
- polling-lagged；
- workspace-save-started；
- workspace-save-completed；
- workspace-save-failed；
- plugin-load-failed。

这些事件用于日志和测试，不直接成为 UI 状态源。

## 29.2 诊断信息导出

后续可以提供诊断包导出，包含：

- 应用版本；
- 平台；
- 工作区 Schema 版本；
- 插件列表；
- 脱敏后的错误日志；
- 最近通信错误；
- 能力矩阵。

默认不包含：

- 完整寄存器数据；
- 完整工作区；
- 原始报文；
- 设备 IP；
- 用户文件路径。

如用户主动选择包含原始通信数据，应明确提示。

## 29.3 遥测

MVP 不接入默认云端遥测。

如果未来增加遥测，应通过独立技术设计明确：

- 采集字段；
- 用户同意方式；
- 脱敏；
- 关闭方式；
- 数据保留；
- 开源部署差异。

---

# 30. 关键技术难点

## 30.1 三端串口实现差异

难点：

- 浏览器使用授权式 Web Serial；
- MVP 阶段 Electron 与浏览器一致使用 Web Serial（ADR-017），后续版本 Electron 与 VSCode 改用 Node.js 串口；
- 串口参数支持程度不同；
- 设备标识方式不同。

方案：

- 统一 SerialPortPort；
- 使用 Capability Matrix；
- 不把端口路径作为领域规则；
- 不要求浏览器恢复端口；
- 建立三端共享的串口契约测试。

## 30.2 Electron 与 VSCode 原生模块兼容

> 本节针对后续版本 Node 串口库替换阶段（ADR-017）；Electron MVP 使用 Web Serial，不涉及原生模块。

难点：

- ABI 不同；
- 打包环境不同；
- 平台二进制不同。

方案：

- 隔离 Node Serial Adapter；
- 分平台构建；
- 启动自检；
- CI 覆盖目标系统；
- 不把已编译模块跨 Host 复用。

## 30.3 RTU 字节流分帧

难点：

- 数据分片；
- 噪声；
- 部分响应；
- 迟到响应；
- 无事务 ID。

方案：

- 单连接单请求；
- 根据当前请求推导响应长度；
- 使用 CRC 和响应字段校验；
- 超时后清理当前解析状态；
- 记录并忽略迟到数据；
- 真实设备验证。

## 30.4 轮询和手动操作冲突

难点：

- 多来源共享连接；
- 轮询可能积压；
- 手动写入需要及时执行；
- 读取结果按设计直接覆盖输入。

方案：

- 统一 RequestScheduler；
- 公平优先级；
- 轮询去重；
- generation 防止旧结果污染。

## 30.5 虚拟化表格编辑

难点：

- 行离开视口后组件卸载；
- 焦点跳转；
- 多行粘贴；
- 可访问性。

方案：

- 单元格值存放在 Store 行数据中，Input 受控，虚拟化卸载不丢失；
- 使用稳定 rowId；
- 原型先行；
- 建立键盘和焦点自动化测试。

## 30.6 工作区跨版本恢复

难点：

- 后续字段增加；
- 插件字段未知；
- 异常退出；
- 三端存储后端不同。

方案：

- 统一领域 Schema；
- Repository Adapter 分离；
- 版本化迁移；
- 原子保存；
- 备份恢复；
- 持久化契约测试。

## 30.7 插件安全

难点：

- 私有协议需要扩展；
- 任意插件代码具有设备风险；
- 三端能力不同。

方案：

- 区分 UI-safe 和 Host 插件；
- MVP 优先内置和受信任插件（2026-08-23 确认：MVP 仅预留架构、不对用户开放，见 PRD §20.6）；
- 权限声明；
- 统一通信 API；
- 平台能力检查；
- 错误隔离；
- 后续再开放公共安装。

## 30.8 浏览器后台限速

难点：

- 后台标签页 Timer 可能被限制；
- 轮询周期不精确。

方案：

- 不承诺精确实时轮询；
- 使用单调时钟计算实际间隔；
- 不用累计 Timer 假设；
- 页面隐藏时展示状态；
- 可以选择暂停或降低轮询；
- 记录实际刷新周期。

---

# 31. 关键架构约束

以下约束属于技术架构，应通过代码结构和自动化检查维护：

1. UI 不得直接操作 Transport；
2. 所有通信必须进入 RequestScheduler；
3. protocol-modbus 不得依赖平台 API；
4. Data Type 转换不得散落在 React 组件；
5. 工作区持久化不得保存连接句柄和 Timer；
6. Electron Renderer 不得直接访问 Node.js；
7. VSCode Webview 不得直接访问文件系统或串口；
8. 浏览器包不得依赖 Node.js 内置模块；
9. 插件不得访问私有核心模块；
10. 插件请求不得绕过权限和日志；
11. 所有跨进程消息必须经过 Schema 校验；
12. 所有工作区数据必须包含 schemaVersion；
13. 轮询任务必须可取消；
14. 断开连接后不得发送新请求；
15. 读取失败不得修改 Data 单元格内容；
16. 写入失败不得清空 Data 单元格内容；
17. Type 切换不得修改原始寄存器值；
18. 地址转换必须在日志中可追踪；
19. 三端共享相同协议测试向量；
20. 平台差异必须通过 Adapter 或 Capability 表达。

具体的代理检查命令和每次修改后的执行步骤不在本文档中定义，应写入 AGENTS.md。

---

# 34. 技术原型验证项

正式大规模开发前，应完成以下 Spike。

## 34.1 表格原型

验证：

- 1000 行；
- 虚拟滚动；
- 单元格编辑；
- 多行粘贴；
- 键盘导航；
- 实时值更新；
- 读取结果直接覆盖正在编辑的单元格；
- VSCode Webview；
- 深色主题。

## 34.2 Web Serial 原型

验证：

- 串口授权；
- 打开和关闭；
- 参数支持；
- 读取分片；
- 页面刷新；
- 设备拔出；
- 浏览器不支持提示；
- 后台标签页行为。

## 34.3 Node 串口原型

> 适用范围（ADR-017）：本原型服务于后续版本 Node 串口库替换阶段（Electron 替换 Web Serial、VSCode 自始使用），进入该阶段前完成。Electron MVP 串口走 Web Serial（§34.2 原型已覆盖浏览器路径，Electron 复用）。

> 实现状态（2026-08-23，ADR-020）：本原型已完成并入选型 ADR-020（serialport@13）+ 验证记录
> （docs/node-serial-prototype-验证记录.md）。Layer 1 Fake 57 用例、Layer 2 com0com COM4/COM5 7 用例
> 全绿；Electron/VSCode 独立探针就绪（`pnpm prototype:electron`、`pnpm probe:vscode:serial`）；
> macOS/Linux 平台、真实设备、打包后原生模块加载等为接线验证项，见 ADR-020 后续复审条件。

> 实现状态（2026-08-23，Node TCP Adapter）：`packages/platform-node` 新增 Node TCP Adapter
> （`NodeTcpTransport` + `SocketLike`/`NetFactoryLike` 注入面 + TCP 错误映射 + `NodeTcpCapabilities`），
> 遵循 §34.3.16 共享边界，复用串口侧错误映射/能力描述/Fake 测试模式；`TransportPort.kind` 新增
> `"node-tcp"`；domain 新增最小 `TcpConnectionProfile`（host/port/unitId 0~255，不入持久化）；
> Layer 1 Fake + Layer 2 本地回环用例全绿，详见 docs/node-tcp-adapter-验证记录.md。
> 能力矩阵未翻转（`modbusTcp` 仍 false）；会话层 TCP 帧解析、UI TCP 配置入口、
> Electron/VSCode TCP 接线属后续接线步骤（ADR-020 后续复审条件）。

目标：验证 Electron 主进程与 VSCode Extension Host 通过统一 Node Serial Adapter 实现 Modbus RTU 通信的可行性，重点确认跨平台串口枚举、原生模块兼容、资源释放及异常处理能力。

### 34.3.1 串口库验证

对候选 Node.js 串口库验证以下内容：

- 项目仍处于维护状态；
- 提供完整 TypeScript 类型；
- 支持 Windows、macOS 和 Linux；
- 支持 Electron 主进程；
- 支持 VSCode Extension Host；
- 支持当前目标 Node.js 版本；
- 支持目标 Electron ABI；
- 能够在 Windows x64 和 arm64 环境构建或安装；
- 能够在 macOS x64 和 arm64 环境构建或安装；
- 能够在主流 Linux x64 和 arm64 环境构建或安装；
- 许可证符合项目开源和二进制分发要求；
- 串口枚举、打开、读取、写入和关闭 API 稳定；
- 能够检测串口打开失败、设备拔出和读写异常；
- 不要求 UI 层直接依赖串口库。

候选库必须由 platform-node 中的适配器封装，不允许其类型或对象进入 Domain、Application、UI、工作区数据或插件公开 API。

### 34.3.2 串口枚举

验证系统串口枚举结果是否能够完整提供：

- 系统原始端口路径；
- 友好的显示名称；
- 厂商标识；
- 产品标识；
- USB Vendor ID；
- USB Product ID；
- 序列号；
- 即插即用标识；
- 所在路径或其他平台可用信息。

除端口路径外，其他字段均视为可选信息，不得假设所有操作系统或驱动都会提供。

枚举逻辑必须满足：

1. 空列表可以正常返回；
2. 单个端口可以正常显示；
3. 多个端口可以稳定排序；
4. 刷新后新增端口能够出现；
5. 刷新后已拔出的端口能够消失；
6. 枚举失败返回结构化错误；
7. 单个端口元数据缺失不影响整个列表；
8. 不通过猜测端口名称判断设备类型；
9. 不使用数组索引作为端口标识；
10. 不缓存已经失效的端口对象。

推荐将系统返回的原始端口路径作为运行时连接标识，将显示名称作为独立字段提供给 UI。

### 34.3.4 跨平台端口路径

验证不同平台的端口路径，包括但不限于：

- Windows：COM1、COM10 等；
- macOS：/dev/cu.* 和 /dev/tty.*；
- Linux：/dev/ttyUSB*、/dev/ttyACM* 和其他系统实际提供的路径。

设计要求：

1. 端口路径只由平台适配层处理；
2. Domain 层不解析路径格式；
3. UI 不根据路径前缀决定操作系统；
4. 工作区不依赖端口路径实现自动连接；
5. 路径比较遵循平台实际规则；
6. 不将 Windows 的 COM 规则应用于 macOS 或 Linux；
7. 不将 /dev 路径规则应用于 Windows；
8. 端口显示名称与用于打开的真实路径分离。

### 34.3.5 串口参数支持

验证以下基础参数：

- 波特率：1200；
- 波特率：2400；
- 波特率：4800；
- 波特率：9600；
- 波特率：19200；
- 波特率：38400；
- 波特率：57600；
- 波特率：115200；
- 数据位：7；
- 数据位：8；
- 停止位：1；
- 停止位：2；
- 校验位：None；
- 校验位：Even；
- 校验位：Odd；
- 流控：OFF；
- 流控：XON/XOFF；
- 流控：RTS/CTS。

另外验证：

- 1.5 位停止位是否被候选库和目标系统支持；
- 不支持的参数是否能在连接前被识别；
- 底层库是否会静默忽略不支持的参数；
- 实际打开参数是否与用户配置一致；
- Electron 和 VSCode 是否对相同配置产生一致行为；
- 参数变更后是否要求重新打开串口；
- 串口打开后修改配置对象是否会影响当前连接。

平台或驱动不支持的参数必须通过能力检测或连接错误反馈给上层，不得自动替换为其他值。

### 34.3.6 串口打开

验证以下打开场景：

- 使用有效配置正常打开；
- 使用不存在的端口打开；
- 端口已被其他程序占用；
- 当前用户没有访问权限；
- 配置参数不受支持；
- 打开过程中设备被拔出；
- 用户在打开过程中取消；
- 连续快速点击连接；
- 已连接时再次请求连接；
- 上一次关闭尚未完成时重新连接；
- 同一端口在 Electron 和其他程序之间产生竞争。

打开流程必须：

1. 先进入 connecting 状态；
2. 使用不可变的连接配置快照；
3. 防止重复打开；
4. 支持取消；
5. 将底层错误映射为结构化错误；
6. 失败后释放部分创建的资源；
7. 失败后返回 failed 或 disconnected 状态；
8. 保留用户配置；
9. 不启动通信请求队列；
10. 不创建遗留的 Reader、Writer、监听器或 Timer。

### 34.3.7 串口读取

验证底层串口数据事件能够被稳定转换为 Uint8Array。

必须覆盖：

- 一个事件收到完整响应；
- 一个响应拆分为多个事件；
- 多个响应数据连续到达；
- 单字节分片；
- 空数据；
- 大块数据；
- 接收噪声；
- 收到不完整帧后超时；
- 关闭过程中仍收到数据；
- 断开后出现迟到数据；
- 多次连接后监听器没有重复注册。

Node Serial Adapter 只负责传递字节数据，不负责：

- 解析功能码；
- 校验 CRC；
- 判断寄存器地址；
- 格式化 Data；
- 更新表格行；
- 执行重试。

这些职责分别属于协议层和通信会话层。

### 34.3.8 串口写入

验证以下写入场景：

- 写入完整 RTU 请求；
- 连续执行多次串行写入；
- 写入期间端口关闭；
- 写入期间设备拔出；
- 底层写入返回错误；
- drain 失败；
- 写入空字节数组；
- 未连接时写入；
- 断开后写入；
- 大量快速请求进入队列；
- 请求取消时写入已经开始；
- 重试时再次写入完整请求。

写入接口必须明确区分：

- 数据已提交给串口库；
- 数据已写入操作系统缓冲；
- drain 已完成；
- 设备已经响应。

不得把“本地写入调用成功”误认为“设备操作成功”。

传输层写入成功后，协议请求仍需等待并校验设备响应。

### 34.3.9 端口占用

验证端口已被其他程序占用时：

1. 连接失败；
2. 不进入已连接状态；
3. 返回可识别的 SERIAL_PORT_BUSY 或等价结构化错误；
4. UI 可以展示端口被占用的解决建议；
5. 用户关闭占用程序后可以直接重试；
6. 不需要重启 Mamep2026；
7. 失败后不保留无效句柄；
8. 失败后不启动轮询；
9. 失败后不清空寄存器表；
10. 失败后不丢失连接配置。

由于不同操作系统和驱动返回的原始错误不同，错误映射层应保留底层技术信息，同时向上层返回统一错误类别。

### 34.3.10 权限不足

验证：

- Linux 用户无串口访问权限；
- macOS 系统权限或设备权限限制；
- Windows 驱动或系统权限异常；
- VSCode 工作区信任限制；
- 沙箱或安全软件阻止访问。

错误处理应：

- 返回 SERIAL_PERMISSION_DENIED 或对应结构化错误；
- 提供平台适用的解决方向；
- 不把权限错误误报为端口不存在；
- 不自动提升权限；
- 不执行未经用户允许的系统配置修改；
- 保留底层错误码用于诊断。

### 34.3.11 设备拔出

连接成功后拔出设备，验证：

- 底层错误或关闭事件能够被捕获；
- 连接状态及时变为 interrupted 或 disconnected；
- 当前等待请求结束为失败；
- 尚未执行的请求被取消；
- 周期轮询停止；
- 不再发送新请求；
- 监听器被释放；
- 串口句柄被清理；
- UI 保持可操作；
- 寄存器表不被清空；
- Data 单元格内容保持不变；
- 重新插入设备后可以刷新端口列表；
- 用户可以重新连接；
- 不在用户未启用自动重连的情况下自动连接。

如果操作系统没有及时提供拔出事件，应通过读写错误和连接健康状态识别中断。

### 34.3.12 正常关闭

验证以下关闭场景：

- 用户主动断开；
- 应用窗口关闭；
- Electron 应用退出；
- VSCode 扩展停用；
- VSCode 重载窗口；
- 连接失败后的清理；
- 设备拔出后的清理；
- 读取等待期间关闭；
- 写入期间关闭；
- 重试等待期间关闭；
- 写后回读延迟期间关闭；
- 多次调用 close。

关闭操作必须幂等，并完成：

1. 禁止新请求进入；
2. 取消未执行请求；
3. 停止轮询；
4. 取消超时、重试和延迟；
5. 停止接收新的数据事件；
6. 移除监听器；
7. 等待或终止进行中的底层操作；
8. 关闭串口句柄；
9. 清理接收缓冲；
10. 将连接状态更新为 disconnected。

关闭失败时仍应尽可能清理本地引用，记录诊断错误，并避免 UI 永久停留在 disconnecting 状态。

### 34.3.13 重复连接与监听器泄漏

执行多轮连接和断开测试，例如连续执行 100 次：

- 枚举；
- 打开；
- 发送请求；
- 接收响应；
- 关闭；
- 再次打开。

验证：

- 数据监听器数量不持续增加；
- 错误监听器数量不持续增加；
- 每个响应只处理一次；
- 内存占用没有明显持续增长；
- 串口句柄能够重复释放和打开；
- 不出现重复日志；
- 不出现旧连接的数据更新新连接状态；
- 不出现 Node.js EventEmitter 监听器过多警告；
- 不遗留未取消的 Timer；
- 不遗留未完成 Promise。

每次连接创建新的 connectionId。旧连接产生的迟到事件不得影响新连接。

### 34.3.14 Electron 原型

在 Electron 中验证：

- 串口逻辑只运行于 Main Process 或受控后台进程；
- Renderer 不直接导入串口库；
- Preload 只暴露白名单 API；
- IPC 请求和响应经过 Schema 校验；
- 端口枚举结果能够传递到 Renderer；
- 连接状态事件能够传递到 Renderer；
- 原始字节日志能够安全传递；
- Renderer 刷新时不会遗留失控连接；
- 窗口关闭时能释放串口；
- 应用退出时能释放串口；
- 打包后原生模块能够加载；
- 开发环境和生产包行为一致；
- macOS 签名或权限设置不会阻止串口使用；
- Linux 打包后能够访问系统串口。

Electron 原型还应验证：

- nodeIntegration 关闭；
- contextIsolation 开启；
- Renderer 无法访问任意 Node.js API；
- Renderer 无法传入任意模块名或任意系统命令；
- 串口错误经过 Main Process 映射后再发送到 UI。

### 34.3.15 VSCode 原型

在 VSCode Extension Host 中验证：

- 扩展能够成功加载串口原生模块；
- 端口枚举可以执行；
- 串口可以打开；
- RTU 请求可以发送和接收；
- Webview 只通过类型化 RPC 请求串口操作；
- Webview 无法取得底层串口对象；
- VSCode 重载窗口时串口被释放；
- 扩展停用时串口被释放；
- Webview 关闭后连接策略符合设计；
- 工作区未受信任时能力限制符合设计；
- 扩展打包为 VSIX 后原生模块仍能加载；
- Windows、macOS 和 Linux 对应扩展包能够正确安装；
- VSCode 使用的 Node.js ABI 与原生模块兼容；
- 串口异常不会阻塞 Extension Host；
- 长时间轮询不会影响 VSCode 编辑器响应。

### 34.3.16 Electron 与 VSCode 共享边界

验证 Electron 和 VSCode 可以共享：

- SerialPortPort 接口；
- Node Serial Adapter 的业务无关部分；
- 串口配置模型；
- 错误映射；
- 字节事件模型；
- 资源释放逻辑；
- 测试用例；
- Fake Serial Transport；
- 能力描述。

不得强行共享：

- Electron IPC；
- VSCode Webview RPC；
- 应用生命周期代码；
- 打包配置；
- 原生模块二进制产物；
- Electron Main Process 初始化；
- VSCode Extension 激活代码。

共享源代码不等于共享已编译原生模块。Electron 和 VSCode 应针对各自运行环境分别安装、构建和打包原生依赖。

### 34.3.17 串口错误映射

原型需要建立底层错误到统一错误模型的映射，至少覆盖：

- 端口不存在；
- 端口已占用；
- 权限不足；
- 参数不支持；
- 打开失败；
- 读取失败；
- 写入失败；
- drain 失败；
- 设备拔出；
- 连接已关闭；
- 操作取消；
- 未知串口错误。

错误映射不得只依赖完整错误字符串。

应综合使用：

- 错误类型；
- 错误码；
- 操作系统错误码；
- 底层库提供的属性；
- 必要时的受控字符串匹配。

无法识别的错误映射为通用串口错误，同时保留原始技术信息用于诊断。

### 34.3.18 能力检测

Node Serial Adapter 应提供串口能力描述，包括：

- 是否支持端口枚举；
- 支持的数据位；
- 支持的停止位；
- 支持的校验位；
- 支持的流控；
- 是否支持设备拔出事件；
- 是否提供 USB 元数据；
- 当前平台；
- 当前 Host；
- 当前串口库版本。

能力信息用于 UI 展示和配置校验，不得用于绕过真实打开结果。即使声明支持某参数，具体设备或驱动仍可能拒绝，连接流程必须处理实际失败。

### 34.3.19 性能与稳定性

验证：

- 枚举 100 个虚拟端口时界面仍可操作；
- 1000 次短报文读写不出现内存持续增长；
- 长时间周期轮询不阻塞 Electron Main Process；
- 长时间周期轮询不阻塞 VSCode Extension Host；
- 原始数据事件处理不会生成过多临时对象；
- 通信日志达到上限后内存保持稳定；
- 大量错误不会导致未处理 Promise；
- 连续超时和重试后仍可正常断开；
- 串口关闭后进程能够正常退出；
- 串口通信不在 Renderer 或 Webview UI 线程执行。

### 34.3.20 测试方式

Node 串口原型采用三层测试。

#### 第一层：Fake Adapter 测试

使用 Fake Serial Transport 验证：

- 打开；
- 关闭；
- 读取；
- 写入；
- 超时；
- 取消；
- 设备拔出；
- 错误注入；
- 分片响应；
- 迟到响应；
- 重复连接。

#### 第二层：虚拟串口测试

使用操作系统支持的虚拟串口对验证：

- 实际端口枚举；
- 实际字节传输；
- 分片；
- 端口占用；
- 关闭；
- 重连；
- Electron 和 VSCode 原生模块加载。

虚拟串口仅用于验证操作系统和串口库集成，不能完全替代真实 USB 串口设备。

#### 第三层：真实设备测试

使用至少一种真实 USB 转串口设备和一个可控 Modbus RTU 设备验证：

- 03 功能码读取；
- 0x10 功能码写入；
- 不同波特率；
- 不同校验位；
- 超时；
- 重试；
- CRC 错误；
- 设备拔出；
- 串口占用；
- 长时间轮询；
- Electron 和 VSCode。

### 34.3.21 原型输出物

原型完成后应产出：

- 串口库选型 ADR；
- Node Serial Adapter 接口；
- Electron 串口最小原型；
- VSCode 串口最小原型；
- 各平台支持参数矩阵；
- 原生模块构建矩阵；
- 串口错误映射表；
- 资源释放测试记录；
- 连接与断开压力测试记录；
- 已知限制清单；
- 是否可以进入正式实现的结论。

原型代码如果不满足正式架构边界，不应直接复制进入生产代码。

### 34.3.22 通过标准

Node 串口原型满足以下条件后，才可进入正式实现：

1. Electron 和 VSCode 均能枚举、打开、读写和关闭串口；
2. macOS 和 Linux 的目标端口路径能够正常处理；
3. 端口占用和权限不足能够被区分；
4. 设备拔出后应用保持可操作；
5. 断开后不再发送请求；
6. 重复连接不会造成监听器或句柄泄漏；
7. Renderer 和 Webview 无法直接访问串口库；
8. 串口库能够在目标 Electron 和 VSCode 环境打包；
9. 不支持的串口参数不会被静默接受；
10. 底层数据能够稳定转换为 Uint8Array；
11. 分片响应可以由上层通信会话正确组帧；
12. 串口错误能够映射为统一错误模型；
13. Node Serial Adapter 不包含 Modbus 业务逻辑；
14. Electron 和 VSCode 能够复用相同的端口抽象和主要测试；
15. 真实 Modbus RTU 设备可以完成 03 读取和 0x10 写入；
16. 长时间轮询不存在阻断性稳定问题；
17. 原型结论和已知限制已记录到 ADR 或技术文档。

## 34.4 Modbus TCP 原型

验证：

- Electron 和 VSCode 中建立 TCP 连接；
- 主机名和 IP 地址解析；
- 连接超时；
- 对端拒绝连接；
- 半包和粘包；
- Transaction ID 匹配；
- Unit ID 匹配；
- 请求过程中断线；
- 主动断开；
- 自动重连期间主动取消；
- Electron 和 VSCode 是否能够复用同一 Node TCP Adapter。

## 34.5 工作区持久化原型

验证：

- 浏览器 IndexedDB 保存和恢复；
- Electron 原子文件写入；
- VSCode workspaceState 和工作区文件；
- 数据损坏恢复；
- Schema 迁移；
- 1000 行、多标签页工作区保存性能；
- 异常退出后的恢复能力；
- 插件配置不存在时的兼容行为；
- 三端导入同一工作区数据的可行性。

## 34.6 插件原型

验证：

- Manifest 解析；
- 插件启用和禁用；
- 平台能力声明；
- 工具栏贡献；
- 侧边栏贡献；
- 地址转换；
- 插件通信请求进入统一调度器；
- 插件异常隔离；
- Electron 和 VSCode Host 插件加载；
- 浏览器端拒绝不兼容插件；
- 插件 API 版本不兼容提示。

---

# 35. 待确认技术事项

以下事项需要在原型验证或产品决策完成后确定，不应在实现中自行假设。

## 35.1 串口库最终选型

> 该选型服务于后续版本 Node 串口库替换阶段（ADR-017）；Electron MVP 使用 Web Serial，不依赖此选型。

需要验证候选 Node.js 串口库的：

- Electron 支持；
- VSCode Extension Host 支持；
- macOS 和 Linux 支持；
- 原生模块构建稳定性；
- TypeScript 类型完整性；
- 维护状态；
- 许可证；
- 设备拔出事件；
- 流控参数支持；
- 1.5 位停止位支持；
- XON/XOFF 支持；
- RTS/CTS 支持。

最终选择应通过 ADR 记录。

## 35.2 浏览器停止位和流控能力

需要根据 Web Serial API 和目标浏览器实测确认：

- 1.5 位停止位是否可配置；
- XON/XOFF 是否可用；
- RTS/CTS 是否可用；
- 不支持时是隐藏选项还是显示禁用状态；
- 浏览器端通信配置如何与另外两端保持语义一致。

平台不支持的参数不得被静默忽略。

## 35.3 从站地址与 Unit ID 范围

RTU Slave Address 已确认（ADR-013）：允许范围 0~255，默认 1；地址 0 允许配置（广播语义，按标准无应答）；MVP 不实现广播写入。

TCP Unit ID 已确认（2026-08-23）：允许范围 0~255，允许 255，默认 0。MBAP Header 的 Unit Identifier 是 RTU Slave ID 的 TCP 版本：纯 TCP 通信中常被忽略（默认 0），经网关访问 RTU 从站时才是必要寻址字段。UI 字段名按协议动态显示：RTU 显示 "Slave Address"，TCP 显示 "Unit ID"（工具栏按协议切换已落地，2026-08-25，ADR-026；Unit ID 会话内可经工具栏动态修改，每表独立）。

仍待确认：

- 插件是否可以提供厂商专用范围校验；
- 地址 0 下除读写外哪些操作可用（RTU 0 为广播语义、不实现广播写入；TCP 0 为忽略寻址，语义不同，需分别说明）。

## 35.4 轮询间隔（已确认，2026-08）

已确认（ADR-013）：不设独立的全局轮询间隔配置，WP 轮询间隔使用 Connection Settings 中的 Rx Delay（interRequestDelayMs，默认 50 ms）。

仍待验证：

- Rx Delay 的 UI 输入形式（数值输入或固定档位）；
- 页面进入后台后的行为；
- 实际刷新速度低于配置速度时的提示方式。

内部统一使用毫秒，但 UI 可以根据数值显示 ms 或 s。

## 35.5 Data 单元格交互

已确定采用 Ant Design 表格默认交互：

- 读取值和待写值共用同一个单元格输入区域，内容即当前值；
- 无独立编辑模式、草稿或提交事务；
- 编辑不暂停该行轮询；
- 读取成功结果强制覆盖单元格内容，包括编辑中；
- 读取失败不改动单元格内容、不提示；
- 未启用回读时，写入完成后单元格保持用户输入值；
- 写后回读结果按读取规则覆盖单元格；
- 写入校验失败时提示且不清空单元格内容；
- Type 切换不改写单元格文本；
- Enter 无特殊提交行为（与 Ant Design 默认一致）。

## 35.6 工作区文件格式

需要确定：

- 是否在 MVP 提供工作区导出；
- 文件扩展名；
- 是否使用纯 JSON；
- 是否需要压缩；
- 是否包含最近读取值；
- 是否包含通信日志；
- 是否包含连接主机信息；
- 是否包含插件配置；
- 是否作为长期兼容的公开格式；
- 是否允许三端相互导入。

在正式发布文件格式前，应避免承诺永久兼容所有内部字段。

## 35.7 插件运行隔离

需要进一步评估：

- Electron Host 插件是否运行在独立 Utility Process；
- VSCode 插件是否允许运行第三方代码；
- 插件进程崩溃后的恢复方式；
- 插件超时；
- 插件资源限制；
- 插件签名；
- 本地开发插件的加载方式；
- 公共插件安装是否延后到 V1.0。

MVP 可以只开放受信任的内置插件，避免过早形成不安全的任意代码执行机制。

## 35.8 表格组件决策

已确定采用 Ant Design Table，并与 Ant Design 组件框架统一。

原型阶段重点验证：

- 受控输入与虚拟滚动的兼容性；
- 多单元格粘贴；
- 键盘导航；
- 屏幕阅读器支持；
- VSCode Webview 性能；
- 大量实时更新下的渲染表现；
- 列宽拖动和固定列。

替换表格组件不得影响领域层和工作区数据结构。

## 35.9 TM Trace 技术边界

PRD 中 TM Trace 的版本优先级存在需要澄清的地方。一方面寄存器表定义和状态恢复包含 TM，另一方面版本规划将 Register Trace 放在后续版本。

技术实现前需要确认：

- MVP 是否只保留 traceEnabled 数据字段和禁用入口；
- MVP 是否提供基础数据列表追踪；
- 完整曲线、缓冲和导出是否后续实现；
- Trace 是否属于核心或插件；
- Trace 采样是否复用普通轮询；
- 多个 Trace 是否允许同时运行；
- Continue 模式的内存上限；
- 平均值按原始值还是格式化值计算。

在确认前，不应实现无限缓存的 Trace 功能。

---

# 36. 推荐默认技术参数

以下参数是技术实现的初始默认值，不替代产品决策，可在原型后调整。

## 36.1 通信参数

- RTU 波特率：9600；
- 数据位：8；
- 停止位：1；
- 校验位：None；
- 流控：OFF；
- 请求超时：1000 ms；
- 重试次数：1；
- 请求间隔（Rx Delay）：50 ms（兼作 WP 轮询间隔）；
- TCP 端口：502；
- TCP 连接超时：5000 ms；
- 启动状态：离线；
- 自动重连：关闭。

## 36.2 轮询参数

- 轮询间隔：Connection Settings 的 Rx Delay（interRequestDelayMs），默认 50 ms；
- 每行最多一个等待中的轮询任务；
- 同一连接并发请求数：1；
- 轮询任务优先级低于用户手动读写；
- 页面或 Host 停止时取消所有后续轮询；
- 恢复工作区后不自动启动实际轮询。

## 36.3 日志参数

- 内存中的通信日志默认上限：10000 条；
- 应用消息默认上限：2000 条；
- 达到上限后删除最旧记录；
- 默认开启自动滚动；
- 用户手动滚动离开底部后暂停自动滚动；
- 导出默认使用 UTF-8；
- 原始报文使用大写十六进制字节串。

## 36.4 自动保存参数

- 普通编辑保存 debounce：500 ms；
- 标签页关闭或结构变更后立即安排保存；
- 同一时刻最多执行一个保存任务；
- 保存过程中发生新变更时，在当前保存完成后保存最新快照；
- Electron 至少保留一个最近有效备份；
- 保存失败后不丢弃内存中的未保存状态。

这些参数应集中定义，不得散落在 UI 和平台代码中。

---

# 37. 数据契约示例

本节仅用于明确数据边界，不代表完整实现代码。

## 37.1 读取命令

    type ReadHoldingRegisterCommand = {
      requestId: string;
      connectionId: string;
      source: RequestSource;
      slaveAddressOrUnitId: number;
      registerAddress: number;
      timeoutMs: number;
      retryCount: number;
      cancellationId: string;
    };

## 37.2 写入命令

    type WriteHoldingRegisterCommand = {
      requestId: string;
      connectionId: string;
      source: RequestSource;
      slaveAddressOrUnitId: number;
      registerAddress: number;
      rawValue: number;
      timeoutMs: number;
      retryCount: number;
      verify: ReadVerifyPolicy;
      cancellationId: string;
    };

## 37.3 平台能力

    type PlatformCapabilities = {
      platform: "browser" | "electron" | "vscode";
      supportsRtu: boolean;
      supportsTcp: boolean;
      supportsSerialEnumeration: boolean;
      supportsFileSystem: boolean;
      supportsHostPlugins: boolean;
      supportsWorkspaceFiles: boolean;
      supportedSerialOptions: {
        dataBits: number[];
        stopBits: number[];
        parity: string[];
        flowControl: string[];
      };
    };

## 37.4 请求结果

    type RequestResult<T> =
      | {
          ok: true;
          value: T;
          timing: RequestTiming;
          attemptCount: number;
        }
      | {
          ok: false;
          error: MamepError;
          timing: RequestTiming;
          attemptCount: number;
        };

## 37.5 写后回读结果

    type WriteOperationResult =
      | {
          kind: "write-failed";
          error: MamepError;
        }
      | {
          kind: "write-succeeded-no-verify";
          writtenValue: number;
        }
      | {
          kind: "write-succeeded-verify-matched";
          writtenValue: number;
          readValue: number;
        }
      | {
          kind: "write-succeeded-verify-mismatched";
          writtenValue: number;
          readValue: number;
        }
      | {
          kind: "write-succeeded-verify-failed";
          writtenValue: number;
          verifyError: MamepError;
        }
      | {
          kind: "cancelled-before-verify";
          writtenValue: number;
        };

---

# 38. 模块依赖规则

推荐依赖方向：

    apps
      -> ui
      -> register-table
      -> communication
      -> protocol-modbus
      -> domain

平台相关依赖：

    apps/web
      -> platform-web
      -> platform-api

    apps/electron/main
      -> platform-electron
      -> platform-node
      -> platform-api

    apps/vscode-extension
      -> platform-vscode
      -> platform-node
      -> platform-api

持久化依赖：

    platform adapters
      -> workspace
      -> domain

插件依赖：

    plugins
      -> plugin-api
      -> platform-api
      -> domain

禁止的反向依赖包括：

- domain 依赖 protocol-modbus；
- protocol-modbus 依赖 communication；
- communication 依赖 register-table；
- shared UI 依赖任一具体平台适配器；
- plugin-api 依赖具体插件；
- platform-node 依赖 Electron 或 VSCode；
- Browser 应用依赖 platform-node；
- Electron Renderer 依赖 Electron Main 内部模块。

如果两个包产生双向依赖，应重新划分数据契约或将共享契约下沉到更内层包，而不是通过循环引用解决。

---

# 39. 依赖库管理

## 39.1 依赖选择原则

关键依赖必须满足：

1. 社区主流；
2. 文档完整；
3. TypeScript 支持良好；
4. 许可证允许开源和分发；
5. 最近仍有维护；
6. 安全问题可追踪；
7. 支持目标 Node.js 和浏览器版本；
8. 不依赖不可控的云服务；
9. 不引入特殊 DSL；
10. 能够被自动化测试替代或封装。

## 39.2 依赖封装

以下关键依赖必须经过项目适配层：

- 串口库；
- IndexedDB 库；
- Electron IPC；
- VSCode API；
- 表格库；
- 国际化库；
- 插件加载器；
- 文件保存实现。

不得让第三方库对象成为领域模型或持久化格式。

## 39.3 版本策略

- 使用明确版本范围；
- 锁定文件进入仓库；
- 关键依赖升级单独评审；
- 串口、Electron、VSCode 和表格依赖升级按用户要求执行专项回归；
- 不自动接受关键依赖的主版本升级；
- 删除不再使用的依赖；
- 定期检查许可证和已知漏洞。

具体升级命令和代理执行步骤属于 AGENTS.md。

---

# 40. 兼容性设计

## 40.1 Node.js 运行环境

Electron 和 VSCode 可能使用不同 Node.js 版本。

共享 Node 平台包应：

- 避免依赖单一 Host 特有的全局变量；
- 声明最低 Node.js 版本；
- 通过构建目标分别输出；
- 对原生模块分别打包；
- 不假设 Electron 与 VSCode ABI 相同；
- 在启动时检查必要能力。

## 40.2 浏览器环境

Web 应用构建时：

- 不打包 Node.js polyfill；
- 不模拟 TCP；
- 不引用文件系统；
- Web Serial 不存在时仍允许打开只读工作区界面；
- 能力检测早于连接操作；
- 不支持的功能不创建无效入口；
- 页面刷新后保持离线。

## 40.3 工作区向后兼容

兼容策略：

- 新版本必须能够读取受支持范围内的旧 Schema；
- 旧版本不保证读取新 Schema；
- 导入较新 Schema 时显示明确错误；
- 迁移前保留原始数据；
- 插件未知字段尽可能保留；
- 删除字段需经过迁移；
- 字段语义变化不得只复用旧字段名。

## 40.4 插件兼容

插件兼容性由以下条件共同决定：

- apiVersion；
- 应用版本；
- 平台；
- 必需能力；
- 权限；
- 插件自身数据 Schema。

任何一个条件不满足时，不应尝试带病加载。

---

# 41. 资源释放设计

## 41.1 连接释放

断开连接时必须：

1. 停止接受新请求；
2. 取消队列；
3. 停止轮询；
4. 停止自动重连；
5. 取消超时和延迟 Timer；
6. 释放串口 Reader 和 Writer；
7. 关闭串口或 Socket；
8. 删除数据和错误监听器；
9. 清空帧缓冲；
10. 更新连接状态。

close 操作必须幂等。

## 41.2 页面和窗口释放

Browser 页面关闭或隐藏时：

- 页面关闭前尝试保存；
- 释放串口；
- 页面隐藏不默认断开，但应检测后台限速；
- 页面恢复后重新计算调度时间；
- 不补发后台积压的轮询任务。

Electron 窗口关闭时：

- Renderer 请求保存；
- Main Process 停止通信；
- 等待有限时间释放资源；
- 超时后记录诊断并继续退出；
- 不允许后台残留无界请求。

VSCode Webview 关闭时：

- UI 订阅释放；
- 是否保持连接由产品策略决定；
- MVP 建议 Webview 关闭时仍由 Extension Host 管理连接；
- Extension 停用或 VSCode 关闭时必须断开；
- 重新打开 Webview 时从 Host 获取当前状态快照。

## 41.3 插件释放

停用插件时：

- 禁止创建新命令；
- 取消插件待执行任务；
- 注销 UI 贡献；
- 注销事件监听；
- 清理插件 Timer；
- 调用 dispose；
- 插件 dispose 异常不得阻止其他资源释放。

---

# 42. 时间与时钟设计

所有领域时间通过 ClockPort 获取。

禁止在需要测试的调度逻辑中直接散落调用：

- Date.now；
- performance.now；
- setTimeout；
- setInterval。

ClockPort 提供：

- wallNow；
- monotonicNow；
- delay；
- schedule；
- cancel。

用途：

- 日志时间使用 wall clock；
- 超时和耗时使用 monotonic clock；
- 测试使用 Virtual Clock；
- 写后回读延迟可取消；
- 轮询不依赖不可控的真实等待。

系统时间被用户修改时，不应影响请求超时判断。

---

# 43. ID 设计

所有持久实体和运行时操作使用稳定 ID。

持久 ID：

- workspaceId；
- sheetId；
- rowId；
- connectionProfileId；
- pluginId。

运行时 ID：

- connectionId；
- requestId；
- attemptId；
- batchId；
- operationGroupId；
- cancellationId。

持久 ID 在保存和恢复后保持。

运行时 ID 不进入工作区，除非作为历史日志字段。

ID 通过 IdGeneratorPort 创建，测试中使用可预测 ID。

---

# 44. 配置设计

配置分为：

1. 产品内置默认配置；
2. 用户偏好；
3. 工作区配置；
4. 平台配置；
5. 插件配置；
6. 构建配置。

优先级建议：

    产品默认值
      < 平台默认值
      < 用户偏好
      < 工作区配置
      < 当前运行时临时设置

敏感配置不得写入普通工作区。

插件配置使用独立命名空间：

    plugins.<pluginId>.<settingKey>

插件不得读取其他插件配置，除非通过明确共享 API。

---

# 46. 导入导出扩展预留

工作区导入导出通过 WorkspaceSerializerPort 实现。

需要区分：

- 内部持久化格式；
- 公开工作区交换格式；
- CSV 寄存器表格式；
- 通信日志导出格式（CSV）；
- Trace 导出格式。

内部持久化格式可以包含 UI 状态。

公开交换格式应避免包含：

- 本机绝对路径；
- 临时连接 ID；
- 串口授权对象；
- 未声明的插件内部状态；
- 运行时错误；
- Timer 和任务状态。

CSV 导入导出不应直接成为领域数据源，必须先解析、校验并形成导入预览。

---

# 47. 架构验收标准

技术架构达到可进入全面实现阶段，应满足：

1. Monorepo 能够独立构建三个应用；
2. 核心包不依赖具体平台；
3. 功能码 03 和 0x10 的协议测试通过；
4. RTU CRC 和 TCP MBAP 测试通过；
5. 数据类型转换具备边界测试；
6. Fake Transport 能完成读、写、超时、重试和错误注入；
7. RequestScheduler 能保证单连接串行；
8. 轮询不会无限积压；
9. 断开后不再发送请求；
10. 迟到响应不会污染后续请求；
11. 工作区可以版本化保存和恢复；
12. 三端使用相同的工作区域模型；
13. Electron Renderer 与 Node.js 隔离；
14. VSCode Webview 通过受控 RPC 访问 Host；
15. 浏览器构建不包含 TCP 和 Node.js 依赖；
16. 插件请求不能绕过统一调度器；
17. 表格原型满足 1000 行基础性能目标；
19. 三端共同验收场景可以复用同一测试描述；
20. 关键架构决策已有 ADR。
