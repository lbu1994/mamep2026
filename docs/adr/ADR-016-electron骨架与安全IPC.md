# ADR-016：Electron 三端运行骨架与安全 IPC

- 状态：已确认
- 日期：2026-08-21
- 决策来源：用户指令（Electron 骨架任务）+ 用户对目录位置 / 剪贴板 / CSP 范围的三项澄清确认

## 背景

PRD §8.2 P0「三端运行骨架」要求 Electron 端可启动主进程窗口并加载与浏览器相同的共享 React UI，且 Main 与 Renderer 分离。此前 `electron/main.ts` 仅是最小 `BrowserWindow`（单文件，无 preload、无 IPC），仅保证编译不破坏。本轮补齐 Electron 侧骨架：Main / Preload / Renderer 三层 + 版本化安全 IPC + 加载同一套 UI。

技术约束（TECH_DESIGN §22.1/§22.3、docs/AGENTS.md §23）：contextIsolation 开启、nodeIntegration 关闭、可行范围开启 sandbox、Renderer 不获得通用 ipcRenderer、Preload 只暴露白名单 API、Main 校验所有输入、跨边界消息使用版本化 Envelope + Zod 校验 + kind 白名单。

勘察发现两个潜在问题：
1. Electron 生产 `loadFile` 加载渲染器产物时，若使用 Vite 默认绝对路径 `/assets/*`，在 `file://` 下会解析到盘根目录导致资源加载失败；且浏览器构建（`base: "/"`）与 Electron 构建（需 `base: "./"`）若共用同一 `apps/web/dist/`，后构建会覆盖先构建（此前生产模式从未被验证，冒烟验证时实测复现）。
2. `webRequest.onHeadersReceived` 对 `file://` 协议不触发，因此「headers CSP」对 `loadFile` 页面无效。

## 决策

1. **目录迁移到 `apps/electron/`**（对齐 TECH_DESIGN §6.2 目标结构；用户确认）。`apps/electron/src/main/main.ts`（窗口/生命周期/安全 IPC 分发）+ `apps/electron/src/preload/preload.ts`（contextBridge 白名单）。**Renderer 即 `apps/web` 共享 UI**，不建独立 renderer 应用：dev 经 `VITE_DEV_SERVER_URL`、生产经 `loadFile("apps/web/dist-electron/index.html")` 加载同一套 UI 源码（渲染器独立产物目录，见决策 9）。根 `electron/` 与遗留根 `vite.config.ts`（monorepo 前遗留，被 `apps/web/vite.config.ts` 取代）删除。
2. **版本化消息协议 HostMessage v1**，放共享包 `packages/platform-api/src/host-message.ts`（三端共享，后续 VSCode Webview 复用）：
   - Envelope：`protocolVersion=1` / `messageId` / `type`（request|response|event|error）/ `kind` / `payload`；
   - request kind 白名单：`get-capabilities`、`get-app-version`、`copy-text-to-clipboard`、`read-text-from-clipboard`、`debug:get-state`；event kind：`connection-state`；
   - 所有消息经 `parseHostMessage`（Zod）校验，未知 kind / 非法 payload 拒绝；错误用 `MamepError` 可序列化投影（`toErrorPayload` / `fromErrorPayload`）；
   - IPC 频道：invoke 用 `mamep:invoke`，事件用 `mamep:event`（分离）。
3. **Preload 只暴露白名单 `MamepHostApi`**（`window.mamepHost`）：`platform` / `getCapabilities` / `getAppVersion` / `copyTextToClipboard` / `readTextFromClipboard` / `onEvent` / `getDebugState`。不暴露通用 `ipcRenderer`；`sandbox: true`（因此 preload 以 **CJS** 输出，`entryFileNames: "[name].js"`）。
4. **骨架能力如实声明**：`electronSkeletonCapabilities`（modbusRtu/modbusTcp 均 false、serialPorts "unsupported"）由主进程 `get-capabilities` 返回，不显示虚假连接能力（AGENTS §22.3）。串口能力翻转策略随 ADR-017 调整：MVP 阶段 Electron 与浏览器一致使用 Web Serial API（Renderer `navigator.serial`，主进程配合 `select-serial-port` 权限处理），Web Serial 路径可用后 `serialPorts` 翻转为 "enumerated"（主进程转发端口列表 + 渲染进程 antd Select 下拉框选择，2026-08-21）；后续版本 Node Serial Adapter 落地后再翻转为系统枚举。
5. **真实能力（骨架内）**：剪贴板（copy/readText 经主进程 `electron.clipboard`，作为首个真实 IPC 往返验证）；`connection-state` 事件（主进程 `did-finish-load` 推送初始离线状态）；**dev-only 调试探针** `debug:get-state`（`app.isPackaged` 时禁用，返回 `DEBUG_PROBE_DISABLED`）——为后续 Playwright Electron E2E 提供主进程内部状态（窗口数 / 版本 / 连接状态 / uptime）。
6. **Renderer 装配**：`apps/web/src/App.tsx` 启动时运行时检测 `window.mamepHost`，存在则用新的 `ElectronAppHost`（实现共享 `AppHost` 契约），否则沿用 `BrowserAppHost`。同一 bundle 内分支，不维护两份页面。骨架桩：连接/读写/轮询/Trace 返回结构化 capability 错误；工作区用内存仓储（不声称持久化）。
7. **CSP（生产构建）**：构建期向 `index.html` 注入 CSP meta（`apply: "build"`，dev 不注入以保 HMR）——替代无效的 headers CSP。白名单：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'`（`unsafe-inline` 为 antd CSS-in-JS 所需）。
8. **修复 `base`**：Electron 模式构建 `base: "./"`（file:// 相对路径资源），浏览器模式保持 `"/"`。
9. **构建**：沿用 `vite-plugin-electron/simple`，`main.entry` 指向 `apps/electron/src/main/main.ts`、`preload.input` 指向 `apps/electron/src/preload/preload.ts`，产物 `dist-electron/main.js` + `dist-electron/preload.js`（根 `package.json` `main` 保持 `dist-electron/main.js`）。**Electron 渲染器独立产物目录 `apps/web/dist-electron/`**（`base: "./"` + 构建期 CSP），与浏览器构建（`apps/web/dist/`，`base: "/"`）分开——两者共用同一 `dist/` 会导致后构建覆盖先构建、`file://` 下绝对路径资源失效（冒烟验证时实测发现并修复）。新增根脚本 `start:electron`（`electron .`）。
10. **类型检查**：`apps/electron` 成为独立 workspace 包（`@mamep2026/electron`，含 `typecheck` 脚本），纳入 `turbo run typecheck`；根 `tsconfig.node.json` include 从 `["electron"]` 改为 `["apps/electron"]`。ESLint 增补 `@typescript-eslint/no-unused-vars` 的 `argsIgnorePattern: "^_"`（与 TS `noUnusedParameters` 一致，项目已有 `_` 前缀用法）。

## 备选方案

- Electron 代码保留根 `electron/`：被否决（用户确认迁移到 `apps/electron/` 对齐目标结构）。
- Preload 暴露高层方法 vs 通用 invoke：采用高层白名单方法（更符合「只暴露白名单 API」），消息 ID 由 preload 内部生成。
- CSP 用 `webRequest.onHeadersReceived`：被否决（`file://` 不触发），改用构建期 meta 注入。
- Renderer 独立入口文件：被否决（生产加载同一 `index.html`，只有运行时检测可行）。
- 骨架声明虚假能力（modbusRtu true 但连接返回未实现）：被否决，如实声明未实现。

## 理由

- 复用 `apps/web` 同一套 UI 与 `AppHost` 契约，零页面重复，符合「三端共享同一套 React UI 源码」；
- 消息协议放共享包，Electron 与后续 VSCode 复用同一契约与校验；
- 探针/剪贴板作为骨架内最小真实能力，验证 IPC 往返与事件通道，为 e2e-electron 铺路；
- CSP 与 base 修复解决此前从未被验证的生产模式加载问题。

## 正面影响

- Electron 三端骨架达成 MVP 交付形态：窗口启动、加载同一 UI、离线可操作、关闭干净退出；
- 安全 IPC 从第一天起按规范落地（Envelope + Zod + 白名单 + sandbox + CJS preload）；
- 主进程有 dev 探针，后续 Playwright Electron E2E 可直接读取主进程状态；
- 生产模式资源路径与 CSP 问题在骨架阶段即修复。

## 负面影响

- `apps/electron` 新增 workspace 包与依赖（platform-api / domain / communication），`pnpm install` 需重跑；
- ESLint 配置增补 argsIgnorePattern（全仓生效，风险低、与 TS 一致）；
- 骨架阶段 Electron 端无串口/TCP/文件持久化，连接相关 UI 按能力矩阵禁用（属预期，非缺口）；MVP 串口方向（Web Serial，ADR-017）落地前维持该状态；
- 主进程 `get-app-version` 用 `app.getVersion()`，打包后版本来源为打包配置（本轮不涉及打包）。

## 后续复审条件

- Web Serial 路径落地时（ADR-017）：`electronSkeletonCapabilities` 翻转 modbusRtu/serialPorts（"enumerated"，2026-08-21），串口经 Renderer `navigator.serial` + 主进程 `select-serial-port` 权限处理；新增 request kind `select-serial-port`（回传选择结果）与 event kind `serial-ports-available`（转发端口列表），均纳入 HostMessage v1 白名单与 Zod 校验；
- Node Serial Adapter 落地时（后续版本，ADR-017）：`serialPorts` 翻转为系统枚举，串口 request kind 随实现演进，`debug:get-state` 扩展串口状态；
- 文件持久化落地时：`ElectronAppHost` 内存仓储替换为文件仓储（经主进程 IPC）；
- 建立 `e2e-electron`（Playwright + Electron）：直接使用 `debug:get-state` 探针与 `window.mamepHost` 断言；
- 若打包引入：校验 `app.getVersion()` 与 CSP 在 asar 下行为，考虑自定义 `app://` 协议硬化；
- VSCode 端骨架：复用 `packages/platform-api` 的 HostMessage v1 契约（Webview RPC 通道不同）。
