# ADR-044：插件 Phase F —— 可执行插件正式化（卸载 + 隔离机制 + 单文件 JS 安装）

- 状态：**已确认（2026-09-01）**
- 日期：2026-09-01
- 决策来源：用户任务（docs/插件功能设计.md §6/§10/§11 Phase F）；用户确认：①**完整 Phase F（含线程隔离）**（web → Web Worker，host → `worker_threads` + 能力白名单）②内置插件**不可卸载**（仅 installed 可卸载）③「内置插件后续移出为独立插件」加入 README 待办

## 背景

- **Phase A~~E 已落地（ADR-039~~043）**：贡献点注册表（10 点）+ Manifest v2 + 生命周期骨架 + PluginCommunicationApi（read/write）+ 插件持久化（IndexedDB / plugins.json / globalState）+ 安装入口（仅清单注册，零代码执行）+ 可执行化扩展（builtin 同进程 runtime activate/deactivate + 错误隔离）+ P3 精选（基础表/自定义功能码/手册/dataType 开放/VSCode codec）。
- **Phase F 预留（ADR-038/039）**：插件第三方代码隔离机制（Worker / worker_threads / vm + 能力白名单，§35 待确认）；可执行插件安装形态（单文件 JS → zip 扩展位）；`executablePlugins`/`hostPlugins` 落地前维持 false（如实声明）。
- **ADR-043 已知限制**：插件卸载（`PluginRegistry.unregister` + UI）随 Phase F。

## 关键架构约束（决定隔离机制形态）

**`ProtocolCodec` 与 `FrameParser.push` 是硬同步的**（`packages/communication/src/codec.ts`）：transport 收 chunk 时在主线程同步调用 `push` → `decodeResponse`，读/写请求发出前同步 `encodeRead`/`encodeWrite`。`CodecRegistry.get` 返回同步接口，`CommunicationSession` 编解码零异步点。**该约束不可动摇**（异步化 = 重构分帧模型 + 全部 codec + 三端会话，另立 ADR 才可评估）。

推论：**codec / dataType（同步纯函数）不能线程隔离**——主线程无法同步调用 Worker 中的函数（浏览器无 `Atomics.wait`，worker_threads 阻塞等待亦为反模式）。这是技术约束，非产品决策。

## 决策

### 1. 插件卸载（ADR-043 已确认随 Phase F）

- `PluginRegistry.unregister(pluginId)`：**仅 installed 来源可卸载**（builtin 随应用构建、不可卸载，UI 不显示按钮）：
  - runtime 存在 → 执行 `deactivate`（异常 → `PLUGIN_HOOK_FAILED` 错误隔离，仍继续卸载）；
  - `contributionRegistry.removePluginContributions(pluginId)` 回收贡献点；
  - 从内部 map 删除 → emit `{type:"unregistered", pluginId}` → version++；
  - 未注册 / builtin → 返回 `PLUGIN_NOT_FOUND` / `PLUGIN_BUILTIN_NOT_REMOVABLE` 错误。
- 持久化：`PluginPersistenceCoordinator` 订阅 `unregistered` → 重存（store 不再含该插件，`plugin-store-save` 全量落盘既有路径，**无新 kind**）。
- UI：PluginManagerModal 每行「卸载」按钮（仅 installed 显示）+ antd Modal.confirm（展示插件名 + 风险提示：贡献点/配置将移除）+ i18n 双语。
- 三端：浏览器 IndexedDB / Electron plugins.json / VSCode globalState 均经 `plugin-store-save` 落盘删除，零新增桥。
- **e2e**：安装 → 卸载 → 贡献点消失（如 Type 下拉插件类型消失）→ reload 不再出现。

### 2. 隔离机制：分层（声明式 / 同步纯函数 / 异步执行面）

按「代码是否可跨线程同步调用」分层，避免伪隔离：

| 层            | 内容                                                                                                                          | 隔离方式                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| L1 声明式     | manifest `contributes`（tableType/protocolExtension/documentation/theme/addressTransform defaultConfig/toolbarAction 声明等） | 主线程直接解析（纯数据，无代码执行，现状已如此）                                                                          |
| L2 同步纯函数 | codec（encode/decode/parser）、dataType（parse/format）、addressTransform apply                                               | **builtin/受信任插件同进程**（现状）；installed 第三方**不开放**（同步约束，能力矩阵如实声明 `codec 插件贡献仅内置`）     |
| L3 异步执行面 | entry 的 `activate` 任意代码、PluginCommunicationApi 调用、未来 command/settings                                              | **线程隔离**：web → Web Worker；host（Electron 主进程 / VSCode Extension Host）→ `worker_threads`；能力白名单桥经消息往返 |

- **L3 线程隔离**：插件 entry（单文件 JS，见决策 3）在隔离线程加载执行；线程内暴露受限 PluginContext（无 DOM / 无 Node 全局 / 无 I/O / 无网络），唯一外部通道为 **PluginCommunicationApi 代理**（postMessage 往返 → 主线程统一调度器 `RequestScheduler`，source:"plugin" + pluginId，权限门 communication/device-write）。激活结果（贡献点注册仍走 manifest 声明，不回传函数）。
- **错误隔离**：加载/激活失败 → `PLUGIN_LOAD_FAILED` / `PLUGIN_HOOK_FAILED` → 禁用故障插件贡献 → 核心保持可用（现状语义延续）。
- **能力矩阵翻转**（按平台如实声明）：`executablePlugins:true`（三端）、`hostPlugins`（Electron/VSCode true / 浏览器 false）；**新增/明确** `codecPluginExecution:"builtin-only"` 语义（能力矩阵以 `nodePlugins`/`webPlugins` + 文档说明 L2 约束）。
- 已知限制（如实记录）：L2 同步纯函数第三方化需 codec 异步化（另立 ADR）；浏览器端 Worker 内插件无法贡献 codec/dataType。

### 3. 可执行插件安装形态（单文件 JS）

- 安装入口扩展：**单文件 JS（`.mjs`）**——一个文件内 `export const manifest = {...}` + `export function activate(ctx){}`（+ 可选 `deactivate`），文件同时承载 manifest 与 entry。
- 加载路径安全：entry 内容经 `pluginManifestSchema` 校验后，L3 隔离线程加载（浏览器 `new Worker(Blob URL)`；host `new Worker(path, {eval:false})` / `worker_threads`）。**不执行字符串 eval 于主线程**。
- zip 多文件形态为**扩展位预留**（不实现）。

### 4. README 待办（用户要求）

- 根 README 分阶段 ToDoList 增加待办：「内置插件（example-panel / yaskawa / custom-function-code / builtin-address-adjust）后续移出为独立插件」。

## 影响面

- **新增**：plugin-api（`unregister` + `unregistered` 事件 + entry 加载/隔离运行时 `PluginRuntime.entry` + 线程桥 + 单文件 JS 解析）、三端隔离宿主（web Worker / worker_threads + 能力白名单桥）、安装入口扩展（单文件 JS）。
- **扩展**：PluginPersistenceCoordinator（unregistered 落盘删除）、PluginManagerModal（卸载按钮 + 确认）、能力矩阵（executablePlugins/hostPlugins 翻转 + 注释）、i18n。
- **零改动**：协议层/会话/调度器/工作区/既有贡献点消费方（卸载仅回收，不改变消费语义）。
- 测试：plugin-api（unregister / entry 解析 / 隔离桥 / 能力白名单）、persistence（删除）、ui（卸载交互）、三端 ipc/宿主（桥 + 能力翻转）、e2e（安装→卸载→reload；单文件 JS 插件加载执行闭环；无 console 错误）。

## 已知限制 / 后续

- L2 同步纯函数（codec/dataType）第三方化需 codec 异步化（另立 ADR）；本期 installed 插件不可贡献 codec/dataType（能力矩阵如实声明）。
- 线程隔离下插件 UI 交互贡献（command/settings 面板）为后续扩展（本期隔离执行面 + communication 桥）。
- zip 多文件 / 签名校验均不实现（预留）。

## 实施注记（F-1/F-2/F-3 落地，2026-09-01）

### F-1 插件卸载（已落地）

- `PluginRegistry.unregister(pluginId)`：仅 installed 可卸载（builtin 返回 `PLUGIN_BUILTIN_NOT_REMOVABLE`、未注册 `PLUGIN_NOT_FOUND`）；
  deactivate runtime（异常 → PLUGIN_HOOK_FAILED 隔离）→ `contributionRegistry.removePluginContributions` 回收 → 删除 → emit `unregistered`。
- 持久化：PluginPersistenceCoordinator 订阅全部 registry 事件（含 unregistered）→ 重存快照即删除（无新 kind，复用 `plugin-store-save`）。
- UI：PluginManagerModal 每行卸载按钮（仅 installed 显示，`aria-label="Uninstall"`）+ Modal.confirm + i18n 双语（plugins.uninstall*/errors.pluginNotFound/pluginBuiltinNotRemovable）。
- 测试：plugin-api registry.test 4 用例 + ui PluginManagerModal.test 3 用例 + e2e-web plugin-install.spec 2 用例（卸载 + 卸载后 reload 不出现）全绿。

### F-2 隔离机制（已落地）

- **plugin-api**：`PluginRemoteRuntime` 接口（load/activate/deactivate/dispose）+ `PluginRuntime.dispose?`；registry 支持 `remoteRuntime` + `entrySource` 选项、
  `attachRemoteRuntime`（hydrate 恢复后重新附加并激活）、`getEntrySource`、快照携带 entrySource（StoredPlugin 增可选字段，schemaVersion 保持 2）。
- **浏览器（platform-web）**：`WebPluginRemoteRuntime` + `PLUGIN_WORKER_BOOTSTRAP`（Blob URL Worker 动态 import entry 提取 manifest + 执行 activate + 通信桥）；
  通信面按 pluginId 动态工厂（`PluginCommunicationApiFactory`），Worker 消息携带真实 pluginId（日志正确记录）。
- **Node（platform-node）**：`NodePluginRemoteRuntime` + `PLUGIN_NODE_WORKER_BOOTSTRAP`（`worker_threads` eval + data URL import entry），
  集成测试真实端到端（load/activate/通信桥/deactivate/dispose）5 用例全绿。
- **能力矩阵**：`executablePlugins` 三端翻转 true（web 插件隔离执行落地）；`hostPlugins` 维持 false（宿主插件执行面未装配，如实声明）。
- **装配**：AppHost 增 `getSession()`（BrowserAppHost=rtu 会话 / ElectronAppHost=RTU 本地 / VscodeAppHost=null）+
  `createPluginRemoteRuntime(entrySource)`（三端均 Web Worker，通信面经统一调度器；VSCode 无本地会话 → 通信降级能力错误）；
  BrowserAppHost hydrate 完成后 `restoreRemotePluginRuntimes`（带 entrySource 的 installed 插件重新 load + attach 激活）。

### F-3 单文件 JS 安装（已落地）

- PluginManagerModal 安装入口扩展：accept 加 `.mjs`；内容以 `{` 开头 → 清单 JSON（既有路径），否则 → 单文件 JS（隔离加载）。
- 单文件 JS 流程：`host.createPluginRemoteRuntime(entrySource)` → `load()`（Worker 内提取 manifest）→ §6.10.4 安全确认
  （新增「Isolated worker」运行位置 Tag + 隔离执行提示 `plugins.executableEntryNotice`）→ 确认注册（`{source:"installed", remoteRuntime, entrySource}`）；取消 → dispose 关闭线程。
- e2e-web `plugin-exec.spec.ts` 4 用例全绿：真实 Web Worker 安装/激活、reload 持久化恢复、卸载后 reload 消失、activate 抛错错误隔离（无 console 错误）。

### 验证

- typecheck 24/24、lint 0、单测全绿（plugin-api 59 / platform-web 57 / platform-node 102 / application 46 / ui 307 / web 75 / electron 89 / vscode-extension 75 等）、
  e2e-web plugin-install 6 + plugin-exec 4 全绿。

### 实施注记补充（与 ADR 正文差异）

- **host 插件（Electron 主进程 / VSCode Extension Host worker_threads）宿主装配未做**：现有架构三端 PluginRegistry 均在
  Renderer/Webview（浏览器环境），Web Worker 隔离执行三端天然可用；`hostPlugins` 维持 false（诚实声明）。
  待 Extension Host 另建插件执行面 + IPC 桥（后续迭代）。
- **VSCode/Electron TCP 场景插件通信降级**：VscodeAppHost/ElectronAppHost TCP 无本地 CommunicationSession → 插件
  read/write 返回 PLUGIN_RUNTIME_NOT_AVAILABLE 能力错误（不崩溃）。
