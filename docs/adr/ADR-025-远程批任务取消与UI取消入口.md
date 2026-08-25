# ADR-025：远程批任务取消（session-batch-cancel）与 UI 取消入口

- 状态：已确认
- 日期：2026-08-25
- 决策来源：用户任务（TCP `readAllRows` cancel 语义补全：当前单次往返 no-op；UI 无取消
  入口；保留接口契约一致性 + 批任务流式取消前置，见 README ToDoList / ADR-021/022 已知
  限制 / docs/AGENTS.md §15 注记）

## 背景

- **本地路径**（浏览器 RTU，`BrowserAppHost` → `SessionHostCore.readAllRows` →
  `packages/communication/src/batch-read-coordinator.ts`）：`BatchReadCoordinator` 用共享
  `CancellationToken` 对每一行 `readRegister`（经 `request-scheduler.enqueue` 的
  `cancelToken`）做真取消——排队未发送任务取消、在飞任务停止等待；`cancel()` 调
  `cancelToken.cancel("batch-cancelled")`，汇总统计 `cancelledCount`。
- **远程路径**（Electron TCP 主进程 / VSCode Extension Host 的 `session-batch-read`）：
  **单次往返 RPC**。渲染端 `ElectronAppHost` / `VscodeAppHost.readAllRows` 的
  `BatchReadHandle.cancel` 为 `() => undefined`（no-op）——宿主侧批任务在响应返回后即被丢弃，
  渲染端无法中途发送取消信号；UI 无取消入口。
- 已记录设计方向（docs/AGENTS.md §15 注记）：以「批任务流式取消（batch id + 事件）」补全，
  保持 `BatchReadHandle` 接口契约一致性（`{ promise, cancel }` 不变）。

## 决策

1. **batchId 归属：渲染端生成**。`ElectronAppHost` / `VscodeAppHost.readAllRows` 在创建
   handle 时生成唯一 batchId（`packages/platform-api` 提供 `createBatchId()` 工具），随
   `session-batch-read` 请求 payload 传入宿主（payload 由 `{ rows }` 扩展为
   `{ batchId, rows }`）。宿主侧 `BatchReadCoordinator` 支持显式 batchId（汇总 batchId 与
   请求一致，便于跨边界关联）。
2. **新增 request kind `session-batch-cancel`**（payload = `{ batchId }`）：加入
   `HOST_REQUEST_KINDS` 白名单 + Zod schema + `HostApi`/`VscodeHostApi` 类型化方法 +
   Electron preload / vscode-bridge 桥。宿主侧按 batchId 登记活动批任务句柄
   （`SessionHostCore.activeBatches: Map<batchId, BatchReadHandle>`），`session-batch-cancel`
   查表调用 `handle.cancel()`；批任务完成/失败后注销（promise finally 清理）。
   **不新增事件 kind**——行结果已通过既有 `poll-result` 事件流推送（「事件」部分已满足），
   取消只需请求 kind，协议改动最小。
3. **UI 取消入口**（仅 `packages/ui` 一层）：`RegisterTable` 的 Read All 按钮在运行态保持
   `loading`，旁边出现独立「取消」按钮（antd `Button` + `StopOutlined` 图标 + i18n 双语
   文案）。点击立即调用 `handle.cancel()` 并退出运行态（不等 promise resolve）；promise
   之后 resolve 时仍照常显示汇总消息（`table.batchSummary`，文案扩展为含 cancelledCount），
   用递增序号守卫「取消后重新读取」的竞态（过期 promise 不再改运行态）。
4. **取消语义与本地路径一致**（docs/AGENTS.md §12.4）：取消=软件停止等待，不保证设备未
   执行；排队未发送读取消、在飞请求停止等待；`cancelledCount` 准确；cancel 幂等（完成/
   失败/未连接/未知 batchId 均为安全 no-op）；断开/dispose 时批任务自动取消（现有
   `disconnect` 路径已覆盖，不回归）。

## 备选方案

- **宿主生成 batchId，经 `batch-started` 事件或早期响应回传**：渲染端需在 promise resolve
  前拿到 batchId，需新增事件 kind 或改变 `session-batch-read` 响应语义（先返回 batchId 再
  异步补汇总），协议改动更大、时序更复杂。未选。
- **不新增 UI 入口，仅补远程 cancel 契约**：取消能力无用户可达路径，无法满足「UI 无取消
  入口」的收尾目标。未选。
- **渲染端本地仅丢弃等待、不通知宿主**（维持 no-op）：批任务在宿主继续执行，浪费带宽与
  设备请求，且与本地路径语义不一致。未选。

## 选择理由

- **渲染端生成 batchId**：创建 handle 时即可 cancel（无需等待宿主回传），协议保持
  request/response 单次往返模型（`session-batch-read` 仍返回汇总），改动集中、可测。
- **不新增事件 kind**：行结果流式已由 `poll-result` 事件覆盖，取消是低频命令，请求 kind
  足够；避免事件-请求双通道的关联复杂度。
- **`SessionHostCore` 统一登记/取消**：三端共享同一核心，Electron/VSCode 远程宿主只转发
  `cancelBatch`，不复制取消逻辑（AGENTS.md §32 ㉑）；本地路径复用同一实现（batchId 缺省时
  行为不变）。
- **独立取消按钮**：运行态 Read All 保持 `loading` 可见 + 邻近取消按钮，交互明确，基于
  antd 既有组件（§25 框架优先原则），不手写交互控件。

## 正面影响

- 远程（Electron TCP / VSCode）全表读取可中途取消，与本地 RTU 语义一致。
- `BatchReadHandle` 接口形态不变，UI 层对本地/远程路径无感知差异。
- 汇总含 cancelledCount，用户可确认取消结果；取消幂等、边界安全。

## 负面影响

- HostMessage v1 新增 request kind + `session-batch-read` payload 扩展（`batchId`）——
  属协议演进，协议版本不 bump（追加式兼容：新增 kind、新增可选字段语义为「必须提供」，
  但两端同步发布，无旧版互操作面）。
- 渲染端/宿主侧各多一处登记/转发逻辑；需保证批任务完成后的注销不泄漏（promise finally
  清理，断开时由调度器取消触发）。

## 复审条件

- 三端真实端口 e2e（ADR-024 矩阵）回归通过后，远程取消语义纳入常规回归。
- 若后续引入「批任务流式结果事件」（而非仅 poll-result 行结果）或批任务持久化/恢复，
  需复审 batchId 生成与登记机制是否满足新语义。
