# ADR-026：TCP Unit ID 会话内动态修改（打通工具栏「从站地址对 TCP 无效」已知限制）

- 状态：已确认
- 日期：2026-08-25
- 决策来源：用户任务（README ToDoList / ADR-022 已知限制「TCP unitId 会话内不动态修改，
  工具栏「当前从站地址」对 TCP 无效（宿主 setSlaveAddress 已对 TCP 守卫为 no-op）」的收尾）

## 背景

- ADR-022（2026-08-23 两端 TCP 接线）把 TCP unitId 设计为「连接时由 profile 确定，会话内
  不动态修改」，`CommunicationSession.unitId` 为 readonly，`TcpSessionHost` 无 setUnitId，
  `VscodeSessionHost.setSlaveAddress` 与 Renderer `ElectronAppHost.setSlaveAddress` 对 TCP
  守卫为 no-op——工具栏从站地址输入框对 TCP 连接无效（显示了但改了不生效）。
- RTU 侧已有「从站地址每表独立」模型（2026-08-19 决策）：`RegisterSheet.slaveAddress` 随表
  持久化，MamepApp effect 按活动表同步 `host.setSlaveAddress(...)`，工具栏 InputNumber 受控
  编辑，对后续所有请求（读/写/轮询/追踪）生效。
- Modbus TCP 网关场景下，一个 TCP 连接可透传多个从站（MBAP Unit ID），会话内修改 Unit ID
  与 RTU 每表从站地址同构，具备现实需求。

## 已确认决策（用户 2026-08-25，3 项）

1. **语义模型：每表独立**。TCP 的 unitId 动态修改复用 RTU 模型——工具栏按表编辑
   `RegisterSheet.slaveAddress`，MamepApp effect 按活动表同步到会话。接受「TCP 连接恢复时
   profile.unitId 为初始值、被工具栏当前值覆盖」的语义（连接建立后 MamepApp effect 按当前
   活动表值覆盖，profile.unitId 仅作连接初始值）。
2. **HostMessage v1 契约：新增独立 request kind `session-set-unit-id`**（payload =
   `{ unitId }`），不破坏既有 `session-set-slave-address` 契约；渲染端按活动协议路由，宿主
   ipc 按 kind 分发（RTU → `setSlaveAddress` / TCP → `setUnitId`）。
3. **工具栏呈现：启用 + label 按协议切换**。TCP 连接时 InputNumber 启用并生效，label /
   hint / aria-label 切换为「Unit ID」（新增 i18n 键 `table.unitId` / `table.unitIdHint`，
   en-US / zh-CN）；RTU / 未连接时维持「Slave Address」。max 255 不变。

## 决策

1. **communication**：`CommunicationSession.unitId` 由 readonly 改为内部可变字段（构造初值
   仍为 `profile.unitId`），新增 `setUnitId(unitId)`（对齐 `setSlaveAddress` 模式，2026-08-19）；
   所有 TCP 帧构建（读/写/批量/轮询/Trace）统一读内部字段，一处改动全端生效。RTU
   `setSlaveAddress` 与 TCP `setUnitId` 互不影响。
2. **application**：`SessionHostCore` 新增 `setUnitId(unitId)`（协议无关：只把「当前地址」
   同步到 session，由协议宿主决定调用 setSlaveAddress / setUnitId）；`TcpSessionHost` 新增
   `setUnitId(unitId)` 委托 core。不复制核心会话逻辑（AGENTS.md §32 ㉑）。
3. **契约（platform-api）**：新增 `session-set-unit-id` request kind——加入
   `HOST_REQUEST_KINDS` 白名单 + Zod schema + `HostApi` / `VscodeHostApi` 类型化方法 +
   Electron preload / vscode-bridge 桥；不新增事件 kind。
4. **VSCode 端**：`VscodeSessionHost.setUnitId(unitId)`（仅 TCP 活动时生效，RTU 守卫保持），
   `ipc.ts` 分发 `session-set-unit-id`；Renderer `VscodeAppHost.setSlaveAddress` 按
   `currentProfile.protocol` 路由——TCP → `sessionSetUnitId`，RTU → `sessionSetSlaveAddress`
   （原无条件走 slave-address 的守卫由渲染端路由取代，宿主守卫保留为防御）。
5. **Electron 端**：主进程 `ElectronSessionHost.setUnitId`（→ `TcpSessionHost.setUnitId`），
   `ipc.ts` 分发新 kind（`session-set-slave-address` 维持能力错误——RTU 在 Renderer）；
   preload 暴露 `sessionSetUnitId`；Renderer `ElectronAppHost.setSlaveAddress` 按
   `activeProtocol` 路由——TCP → `bridge.sessionSetUnitId`，RTU → `inner.setSlaveAddress`
   （原 TCP 守卫移除）。
6. **UI（packages/ui）**：`RegisterTable` 工具栏按活动协议切换 label（`connectionState` +
   `host.getCommProperties().protocol` 派生，协议只在连接时变化，订阅 connectionState 即可
   保持响应式）；`MamepApp` 同步 effect 增加 `connectionState` 依赖——连接建立时按活动表值
   覆盖 profile.unitId 初始值（「每表独立 + 工具栏覆盖」语义落地）。InputNumber 仍为 antd
   既有组件，不新造控件。
7. **测试与验证**：communication（setUnitId 后请求帧 unitId 变化 + 响应匹配）、application
   （TcpSessionHost.setUnitId）、platform-api（新 kind schema / 白名单）、Electron ipc /
   preload、VSCode ipc / bridge、apps/web 两端 Renderer 代理路由、packages/ui（工具栏 label
   切换 + MamepApp 同步）单测；`tests/e2e-vscode` `runUnitIdLoop`（新 kind 经真实 RPC 路径 +
   会话改后读写不破坏）、`tests/e2e-electron` `tcp-unit-id.spec.ts`（假 TCP 服务器记录请求帧
   Unit ID，UI 改工具栏值后断言帧 unitId 变化 + 无 console 错误）；浏览器 RTU 不回归
   （`slave-address.spec.ts` 既有用例）。

## 备选方案

- **连接级语义（编辑 TcpConnectionProfile.unitId，所有表共享）**：未选。与「每表独立」既定
  语义不一致，需新增 store 字段与持久化语义，改动面更大；TCP 网关多从站场景下每表独立更贴合
  「一表一从站」的产品模型。
- **泛化既有 `session-set-slave-address` 为通用地址设置**：未选。破坏既有 kind 语义/兼容，
  需处理旧 payload 迁移；新增独立 kind 符合 ADR-016 版本化演进，两端同步发布无互操作面。
- **宿主侧单通道路由（渲染端仍只发 slave-address，宿主按 active 协议分发）**：实现上可更小，
  但会模糊「从站地址」与「Unit ID」的协议语义；渲染端已持有活动协议信息（currentProfile /
  activeProtocol），按协议路由更清晰、可测。

## 选择理由

- **每表独立**：与 RTU 从站地址模型完全同构，复用 `setSheetSlaveAddress` / MamepApp effect /
  工具栏 InputNumber 全部既有路径，改动集中、零新状态。
- **新增独立 kind**：语义清晰、零回归，符合 v1 版本化契约演进（ADR-016/025 同模式：
  白名单 + Zod + 穷尽守卫）。
- **渲染端按协议路由**：渲染端已持有活动协议（VscodeAppHost.currentProfile /
  ElectronAppHost.activeProtocol），路由放在最靠近 UI 的宿主边界，宿主侧仅按 kind 分发，
  各层职责单一。

## 正面影响

- 打通 ADR-022 已知限制：TCP 连接后可经工具栏修改 Unit ID，对后续所有请求生效，RTU 行为
  零回退（既有 `slave-address.spec.ts` / 每表从站地址测试不回归）。
- 能力矩阵 / 产品红线不变：浏览器仍无 TCP 入口；TCP Address Adjust 恒 off 语义不受影响。
- 契约演进追加式：新增 kind + 新增方法，既有 kind payload 全部兼容。

## 负面影响

- HostMessage v1 新增 request kind（`session-set-unit-id`）——属协议演进，协议版本不 bump
  （追加式兼容，两端同步发布）。
- TCP 连接恢复语义变化：连接建立后按活动表值覆盖 profile.unitId（用户已确认接受）；
  BottomPanel 通信属性摘要展示的 unitId 仍取 profile 值（连接时快照），与工具栏当前值可能
  短期不一致——已知限制，见后续复审条件。
- Renderer 两端各多一处协议路由分支（VscodeAppHost / ElectronAppHost.setSlaveAddress）。

## 后续复审条件

- BottomPanel 通信属性摘要的 unitId 是否跟随会话内动态修改（当前为 profile 连接时快照）；
- VSCode / Electron 真机验证 TCP 网关多从站透传场景（改 Unit ID 后读写）。
