# ADR-041：插件 Phase C —— 安川插件 + 表类型（tableType 消费方 + 分组菜单 + ROM/RAM Enter）

- 状态：**已确认（2026-08-31）**
- 日期：2026-08-31
- 决策来源：用户任务（docs/插件功能设计.md §4.2 / §4.3 / §10 / §11；6 项确认：①1A 内置同进程 ②分组菜单细节 ③ROM/RAM 确认保留 + 不实现行禁止读 ④不触发轮询刷新 ⑤能力矩阵 + 插件改名 ⑥跨类型禁止复制粘贴）

## 背景

- **Phase A（ADR-039）已落地**：贡献点注册表（`tableType` / `protocolExtension` / `toolbarAction` / `command` 等 10 点已注册 schema，其中 tableType/protocolExtension 为空消费方）；Manifest v2；内置同进程最小执行面（`register(input, { runtime: { activate } })`，仅内置插件可用）。
- **Phase B（ADR-040）已落地**：`ProtocolCodec` + `CodecRegistry` + `CommunicationSession` codec 注入 + 日志 protocol 放宽（`string`）；安川 codec（67/010D 非连续读 ≤120、67/010E 非连续写 ≤60）随**插件包**存放（决策 B：厂商功能码全在插件，软件仅提供调用接口）；`SessionHostCore.getCodecRegistry()`。
- **本阶段（Phase C）**：接通 `tableType` / `protocolExtension` / `toolbarAction` / `command` 消费方，落地安川插件 + 表类型 + Workspace 分组父级菜单 + ROM/RAM Enter，让安川表在 UI 上可用。

## 决策

### 1. 安川插件执行方式（决策①，1A）：内置同进程

- 安川插件以 **`source:"builtin"`** 注册，走 Phase A 最小执行面（`runtime.activate(ctx)` **in-process**）；`executablePlugins` / `hostPlugins` 维持 `false` 如实声明。
- codec 经 `protocolExtension` 消费方在 `activate` 时注册进会话 `CodecRegistry`（复用 Phase B `createCodecRegistry`）。
- 隔离机制（Web Worker / `worker_threads` / `vm`）属 **Phase F**，落地前不加载第三方可执行代码、不扩展安装入口。

### 2. 协议/插件命名（决策⑤）：改名 + 能力矩阵翻转

- 插件文件夹 `plugins/yaskawa-memobus/` → **`plugins/yaskawa-memobus-67h-010dh-010eh/`**（Phase B 交付物对齐；包名 `@mamep2026/yaskawa-memobus-67h-010dh-010eh`；codec `protocolId` → `"yaskawa-memobus-67h-010dh-010eh"`；相关测试/文档引用同步）。
- 能力矩阵（5 处 `Object.freeze` 声明点同步）：
  - `protocolExtensions` → `["yaskawa-memobus-67h-010dh-010eh"]`
  - `tableTypes` → `["holding-register", "yaskawa-memobus-67h-010dh-010eh:holding-register"]`

### 3. 表类型机制（`tableType` 消费方）

- 贡献点 payload：`{ id, protocolId, titleKey, columns?, rowActions?, createDefaultRow? }`（设计文档 §4.2）。
- `RegisterSheet.type` 判别联合：`"holding-register" | "<pluginId>:<tableTypeId>"`；安川表 = `"yaskawa-memobus-67h-010dh-010eh:holding-register"`（核心 holding-register 表，仅协议层换 MEMOBUS codec）。
- workspace schema v4→v5：`schema.ts` 开放 `type` 字符串 + 格式校验；**迁移**（复刻 v1→v2 浅层遍历范本）旧 sheet 补 `type:"holding-register"`；`serializeWorkspace` / `parseWorkspace` / `exchange.ts` 自动跟进。
- `undo-redo.ts`：`SheetEditSnapshot` 增 `type`，`sheetFromSnapshot` 携带；`createRegisterSheet(name, order, type?)` 工厂扩展。

### 4. 跨类型复制粘贴限制（决策⑥）

- 不同类型的表之间**不可**复制粘贴（剪贴板/拖拽复制均校验类型一致）；同一类型内维持既有语义。

### 5. 新建表 + Workspace 分组父级菜单（决策②）

- 侧边栏 Workspace 按协议分组为父级菜单（antd `Collapse`，可折叠；分组头**只读**——不可拖拽/删除）：
  - 「用 03H/10H 读写寄存器」——核心 `holding-register` 表；
  - 「用 67H 010DH/010EH 读写寄存器」——安川表（`protocolExtension` 插件安装/启用后**动态加载**该组，未启用不出现）。
- 「新建表」入口放**分组头右侧 `+`**（antd Dropdown 选表类型，按当前选中分组新建）。

### 6. 安川表渲染

- `MamepApp` / 表渲染注册表按 `sheet.type` 装配（核心 holding-register 走既有组件；安川表复用核心列/编辑/轮询/追踪/写后回读，仅协议层换 codec）。
- `PollingCoordinator` / `BatchReadCoordinator` / `TraceCoordinator` / `WriteVerifyCoordinator` 以 `CommunicationSession` 为依赖 → codec 注入后零改动复用。

### 7. ROM/RAM Enter（决策③④，`toolbarAction` + `command`）

- 贡献点：`toolbarAction { id:"yaskawa.enter-rom" / "yaskawa.enter-ram"; titleKey; icon; scope:"table-toolbar"; requiresConfirm:true }` + `command` handler。
- 执行：确认后经 `PluginCommunicationApi.write`（`source:"plugin"`，记 `pluginId`）写 **0 到 0x0900(ROM) / 0x0910(RAM)**（手册已确认）。
- 保留 antd `Modal.confirm`（写入 EEPROM/RAM 语义 + **EEPROM 10 万次写入限制提示**）。
- **不实现 0900/0910 行禁止读守卫**（用户决策）。
- **执行完成后不触发该表轮询刷新**（用户决策，否决设计文档 §10#2 的「允许」建议）。
- 权限 `device-write`；日志完整记录（pluginId + 报文）。

### 8. `protocolExtension` 消费方接线 + 会话路由

- `getContributions<protocolExtension>` → 插件 `activate` 时 `codecFactory` 产出 `ProtocolCodec` → 注册进会话 `CodecRegistry`。
- 连接按活动表类型/协议路由：安川表 → `protocol:"yaskawa-memobus-67h-010dh-010eh"` 的 `CommunicationSession`（传输仍为 RTU 串口），经 `SessionHostCore` 注入 registry（复用 `getCodecRegistry`）。
- 会话/连接层的具体接线形态（Connection Settings 协议入口是否本轮加入口）在实施前按「进一步考虑 1」确认。

## 明确顺延（后续阶段）

- 主题色（`theme` 贡献点 + 用户设置）与表级 Address Adjust（`addressTransform` + Connection Settings 移除 + 新 kind）——**Phase D**；
- P3 精选（线圈/离散/输入寄存器表、自定义功能码、Memory Access、设备描述、寄存器手册、数据解析）——**Phase E**；
- 可执行插件正式化（隔离 Worker/worker_threads/vm、安装入口扩展、插件市场预留）——**Phase F**。

## 影响与边界

- **改动**：
  - `plugins/yaskawa-memobus-67h-010dh-010eh`（改名 + 补 manifest v2 + 贡献点声明 + entry）；
  - `packages/plugin-api`（tableType / protocolExtension / toolbarAction / command 消费方接线，registry/聚合）；
  - `packages/workspace`（schema v4→v5 + 迁移 + exchange）、`packages/register-table`（undo-redo type）、`packages/domain`（capabilities 翻转、工厂扩展）；
  - `packages/ui`（新建表 Dropdown + 分组 Collapse + 表渲染注册表 + ROM/RAM 工具栏/确认 + 复制粘贴类型校验 + i18n 双语）；
  - `packages/application`（codec 会话路由）、三端装配。
- **不影响**：communication 协议层零改动（Phase B 已就绪）；HostMessage 不新增 kind（内置同进程、无跨边界 RPC；如后续需要另立 ADR）；地址调整（Phase D）。
- **红线遵守**：厂商功能码不进核心；浏览器不实现 TCP；插件不经 UI 直触传输；跨边界消息经 schema 校验。

## 测试

- 单测：workspace v4→v5 迁移 / plugin-api 消费方（聚合、校验、错误隔离）/ ui（分组菜单、新建表、ROM/RAM 确认、表渲染注册表、跨类型复制粘贴被拒）/ application（codec 会话路由）/ 插件包（改名后 protocolId）。
- typecheck（23 包）/ lint 全绿。
- 三端 mock e2e：新建安川表 → 67/010D 读 + 67/010E 写 + 轮询闭环；ROM/RAM 确认流（确认 → 写 0 → 不回读、不刷新）；分组父级菜单（折叠、动态显示、分组头 `+` 新建）；跨类型复制粘贴被拒；全程无 console 错误。
- **Phase B 收尾**：全量单测 + 三端 e2e 无回归（用户同意后执行；此前被暂停）。

## 后续复审条件

- Phase C 验收：单测全绿 + typecheck/lint + 三端 mock e2e 无回归 + 冒烟（浏览器建安川表 → 读写 → ROM/RAM）。
- Phase F 隔离机制落地前：`executablePlugins` / `hostPlugins` 维持 `false`，安装入口维持仅清单注册。
- Phase C 实施第 0 步：插件文件夹/包名/protocolId 改名（需终端操作，与 Phase B 交付物对齐）。

## 进一步考虑（实施前确认）

1. **安川表连接协议路由**：Connection Settings 是否本轮加入「协议 = yaskawa-memobus-67h-010dh-010eh」入口（按能力矩阵门控），还是安川表复用既有 RTU 连接仅换 codec？建议后者（最小侵入，表类型驱动会话协议），待确认。
2. **0900/0910「禁止读取区」完整清单**：用户已确认不实现行禁止读守卫；完整清单仍以手册原文为准（参考文档 §7 待核实项），仅作文档记录。
3. **既有 `registerExamplePlugin`（example-panel）与安川插件的并存/演示定位**：安川插件作为内置示例插件（source:"builtin"）注册，example-panel 维持现状。
