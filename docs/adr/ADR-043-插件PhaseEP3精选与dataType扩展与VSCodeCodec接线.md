# ADR-043：插件 Phase E —— P3 精选（基础表类型 + 自定义功能码 + 寄存器手册 + dataType 扩展 + VSCode codec 接线）

- 状态：**已确认（2026-09-01）**
- 日期：2026-09-01
- 决策来源：用户任务（docs/插件功能设计.md §4.6/§10/§11）；用户确认：①Phase E 范围=核心子集（线圈/离散/输入寄存器表 + 自定义功能码 + 寄存器手册 documentation 面板）②FC01/02/04 **直接进核心 protocol-modbus**（区别于设计文档「插件/独立包」建议）③dataType 扩展纳入 ④VSCode codec 接线纳入；插件卸载随 Phase F 处理

## 背景

- **Phase A~~D 已落地（ADR-039~~042）**：贡献点注册表（`tableType`/`protocolExtension`/`dataType`/`documentation` 等 10 点，其中 dataType/documentation 仍为空/占位消费方）；Manifest v2 + 内置同进程执行面；`ProtocolCodec` + `CodecRegistry` + `CommunicationSession` codec 注入（Phase B）；安川表类型 + ROM/RAM（Phase C）；主题色 + 表级 Address Adjust（Phase D）。
- **现状缺口（2026-09-01 代码调研）**：
  - `protocol-modbus` 仅 FC03/FC0x10，功能码硬编码；无 FC01/02/04/0F 任何实现；
  - test-kit `ScriptedModbusRtuDevice`、platform-web `MockTransport`、从站（modbus-core + rtu/tcp slave）均只支持 03/10（其余回异常 0x01）；
  - `dataType` 为 domain/workspace/platform-api 三处闭集枚举；data-conversion 四处 `switch(type)` 硬编码；插件 dataType 贡献点仅 `{id,titleKey}` 无解析能力；`buildDataTypeRegistry` 零调用；
  - `documentation` 贡献点 schema 仅 `{id,titleKey}`、零消费方；
  - **VSCode codec 未接线**：`VscodeSessionHost` 无 codecRegistry 注入点、`sessionConnectPayloadSchema` 无 protocol 字段、`vscodeCapabilities.protocolExtensions=[]`、`VscodeAppHost.connect` 不透传 protocol（对比浏览器/Electron 完整链：App.tsx → AppHost.connect{protocol} → rtu-session-host → CommunicationSession）。

## 决策

### 1. 基础表类型（coil / discrete-input / input-register）为核心内置表类型（非插件）

- 功能码 **FC01（读线圈）/ FC02（读离散输入）/ FC04（读输入寄存器）/ FC0F（写多线圈）直接进核心 `protocol-modbus` 帧层**（用户决策）：`rtu-frame.ts`/`tcp-frame.ts` 新增请求类型 + encode + 响应解码分派（**关键差异：FC01/02/04 读响应 byteCount=ceil(q/8) 逐位解包为 0/1；FC0F 写多线圈字节打包 byteCount=ceil(n/8)**）+ `expectedResponseLength` 分派。
- 核心实现 **`BasicTablesRtuCodec`（`ProtocolCodec`，RTU 承载，protocolId="modbus-basic-tables"）**，注册进 `CodecRegistry`（三端装配时），表类型经 `protocolForSheetType` 映射到该 codecId——复用 Phase B 安川表模式，`CommunicationSession` codec 路径**零改动**。
- 新表类型为**核心内置**（非插件贡献，与「功能码进核心」一致）：`SheetType` 扩展 `"coil" | "discrete-input" | "input-register"`（`RegisterSheet.type` 已是开放字符串 + schema 正则，仅需扩展内置字面量/默认）。侧边栏分组核心组扩为多组（核心 Modbus 组：holding-register + 三个基础表），新建表入口同步。
- **只读语义由表类型决定**（不加模型字段）：coil 可读写（FC01 读 / FC0F 写）；discrete-input、input-register 只读（FC02/FC04）——UI WriteCell 与写路径按表类型守卫（核心表类型元数据表）。
- 值语义：coil 用 dataType **`"bool"`**（0/1，registerCount 恒 1，见决策 3）；discrete-input/input-register 复用既有 16 位类型（默认 hex）。
- **已知限制**：基础表先做 **RTU 承载**（浏览器/Electron/VSCode RTU）；TCP 承载基础表需第二个 codec（MBAP）与更多接线，列为后续（能力矩阵如实声明基础表仅 RTU 时按 protocolExtensions 门控）。

### 2. 自定义功能码（示例插件）

- 新建示例插件 `plugins/custom-function-code`：一个 `ProtocolCodec` 实现展示自定义 FC（如 0x65 读 / 0x66 写），注册 `protocolExtension` + `tableType` + `toolbarAction` 演示，作为插件开发文档示例（source:"builtin" 同进程，Phase F 前不加载第三方可执行代码）。

### 3. dataType 开放注册（单寄存器插件类型；组合/范围行延后）

- **范围收敛**：仅开放**单寄存器插件类型**（registerCount 恒 1）；组合/范围行解析（`formatRawValues`/`parseCompositeText`）保持内置闭集，插件类型不可用于范围行（`allowedRegisterCounts` 对未知类型返回 `[1]` 并在范围输入时校验拒绝）。
- domain：`DataType` 联合开放（`内置字面量 | (string & {})`，对齐 SheetType 模式）；`dataTypes` 数组保留为内置事实源；新增内置 **`"bool"`**（值 0/1，registerCount 1）。
- workspace：`dataTypeSchema` 由 enum 改 `z.string()`（内置 + 自定义格式校验）；`rowSchema`/`registers[].dataType` 跟随；**workspace schemaVersion 6→7**（无数据转换，仅版本；迁移 v6→v7 仅升版本）。
- platform-api：`dataTypeEnumSchema` 改 `z.string()`（RPC 边界承载插件类型行）。
- data-conversion：`parseCellText`/`formatRawValue`/`allowedRegisterCounts`/`isValidRegisterCount` 由 `switch(type)` 改为「**内置查找 + 可注入 resolver**」——新增 `DataTypeResolver` 接口（`parse`/`format`/`registerCounts`）+ `createDataTypeResolver()`（内置实现 + `register(pluginType)`）；`isScaled`/`isSigned` 的前缀推断改为查内置表（避免插件类型名误判）。
- plugin-api：新增 **`DataTypeRegistry`**（仿 `AddressTransformRegistry`/`CodecRegistry`：`register/get/list`，函数经插件 `activate` 注册，payload 仍为声明式 `{id,titleKey}`）。
- 接线：register-table 的 `cell-text.ts`/`child-register.ts`/`table-service.ts` 单寄存器解析调用点经注入的 resolver（缺省=仅内置）；UI Type/Scale 下拉 = 内置 + 已注册插件类型（插件类型无 radix/scale，渲染单类型下拉）；`row-clipboard.ts` CSV 类型白名单 = 内置 + 已注册插件类型并集。

### 4. 寄存器手册（`documentation` 贡献点）

- `documentation` 贡献点 schema 扩展 `{id, titleKey, markdown}`（字符串可序列化）。
- UI 新消费方：Help/文档弹窗或面板渲染 markdown（轻量渲染——标题/段落/列表/代码块子集，不引重库；antd Typography + 简单解析）。
- 示例：安川插件贡献寄存器手册（基于 `docs/安川MEMOBUS公开协议参考.md` 摘要）。

### 5. VSCode codec 接线（复刻浏览器/Electron 完整链）

- `VscodeSessionHostOptions` 增 `codecRegistry?`；`VscodeSessionHost.connect` 增 `protocol?` 参数（透传 `rtu.connect({protocol, codecRegistry})`）。
- `sessionConnectPayloadSchema` 增可选 `protocol?: string`（codecId）；`ipc.ts` `session-connect` 分支透传；`VscodeAppHost.connect` 增 `options?: {protocol?}` 透传。
- `extension.ts` 装配 `createCodecRegistry()`（注册核心 BasicTablesRtuCodec + 安川 codec）注入 session host。
- 能力矩阵翻转：`vscodeCapabilities.protocolExtensions` 含 `"modbus-basic-tables"`（+ 安川，若有声明）；`tableTypes` 含 3 个基础表（+ holding-register）。
- 三端 `protocolExtensions`/`tableTypes` 同步（browser/electron 已有安川声明，追加基础表）。

## 影响面

- **新增**：protocol-modbus 帧层（FC01/02/04/0F，RTU+TCP 纯函数）、核心 `BasicTablesRtuCodec`、核心表类型元数据（coil/discrete-input/input-register + 只读/协议映射）、dataType 开放（`DataTypeResolver` + `DataTypeRegistry` + bool）、documentation 消费方、示例插件 `plugins/custom-function-code`、workspace v6→v7 迁移。
- **扩展**：test-kit `ScriptedModbusRtuDevice`（线圈/离散/输入存储 + FC01/02/04/0F 分支）、platform-web `MockTransport`（新功能码 + 场景区）、侧边栏分组/新建表/`protocolForSheetType`、Type/Scale 下拉、`row-clipboard` 白名单、sessionConnectPayload 与 VSCode 全链、能力矩阵 5 处声明点。
- **零改动**：`CommunicationSession` codec 路径、调度器、`RequestScheduler`、Address Adjust/主题/工作区导入导出等既有功能。
- 从站（scripts/modbus-slave）与真实端口 e2e 的基础表支持列为本阶段**可选扩展**（不影响 mock 验证）；如做，modbus-core 加常量 + rtu/tcp slave 加分支 + 配置区。

## 测试

- 单测：protocol-modbus（FC01/02/04/0F 帧编解码/异常/边界/byteCount=ceil(q/8)）、communication（BasicTablesRtuCodec 会话闭环）、data-conversion（resolver + bool + 未知类型）、workspace（v6→v7）、plugin-api（DataTypeRegistry）、register-table（cell-text 经 resolver + 插件类型）、platform-api（dataType 开放 + protocol 字段）、ui（Type 下拉/只读/侧边栏分组/新建表）、两端 ipc 透传。
- e2e：e2e-web（基础表读写/轮询/只读守卫/bool + 自定义功能码插件 + 寄存器手册）、e2e-electron/e2e-vscode（codec 会话 + 基础表闭环，VSCode 经 `session-connect` protocol 字段真实 RPC）、全程无 console 错误。

## 已知限制 / 后续

- 基础表 **TCP 承载**未做（需第二个 codec + 接线，列为后续）。
- dataType 开放**仅单寄存器**插件类型；组合/范围行插件类型延后（`formatRawValues`/`parseCompositeText` 保持内置）。
- 插件卸载（`PluginRegistry.unregister` + UI）随 **Phase F** 处理。
- 从站/真实端口 e2e 的基础表支持为可选扩展，mock 验证不受影响。

## 实施注记（E-1/E-2 落地，2026-09-01）

- **基础表 codec protocolId 为每表类型后缀**：`BasicTablesRtuCodec` 按表类型构造，
  protocolId = `modbus-basic-tables:<tableType>`（coil/discrete-input/input-register 各一实例）。
  原因：`CodecReadRequest`/`CodecWriteRequest` 不携带表类型（仅 slaveAddress+addresses/entries），
  单一 protocolId 无法区分 FC01/FC02/FC04；每表类型独立 protocolId 保持 `CommunicationSession` codec 路径零改动。
  `protocolForSheetType`/能力矩阵 `protocolExtensions` 均按该后缀声明。
- E-2 已落地：domain（SheetType 3 基础表 + DataType `bool` + `CORE_TABLE_TYPES` 元数据 + `basicTablesProtocolId`）、
  data-conversion（bool 解析/格式化 + registerCount [1]）、communication（`BasicTablesRtuCodec` +
  `registerBasicTablesCodecs`）、workspace schema（sheet 类型 + bool）、platform-api（bool）、
  UI（侧边栏基础表分组 + `protocolForSheetType` + WriteCell 只读守卫 + Type 下拉 bool + i18n）、
  能力矩阵（browser/electron 追加基础表协议与表类型；VSCode 待 E-6）、e2e-web `basic-tables.spec.ts`（4 用例全绿）。
- 只读语义由表类型决定（无模型字段）：coil 可读写（FC01/FC0F）；discrete-input/input-register 只读（FC02/FC04），WriteCell 按表禁用。
- coil 表默认 dataType `bool`；discrete-input/input-register 默认 `hex`（ADR 决策，值仍为位/16 位）。
- E-3 已落地：domain（`DataType` 开放 = `BuiltinDataType | (string & {})` + `isBuiltinDataType`）、
  data-conversion（`DataTypeResolver`/`createDataTypeResolver` + `PluginDataTypeHandlers` + `isSigned` 改查内置表 +
  `allowedRegisterCounts` 未知类型 → [1]）、plugin-api（`DataTypeRegistry`/`createDataTypeRegistry`）、
  workspace（`dataTypeSchema` → `z.string()` + **schemaVersion 6→7** + `migrationV6ToV7` 仅升版本）、
  platform-api（`dataTypeEnumSchema` → `z.string()`）、register-table（`commitCellText`/`commitChildCellText`/
  `table-service` 单寄存器解析经可选 resolver；`decodeClipboardCsv` 增 `knownTypes`）、
  UI（app-store `dataTypeResolver` 状态 + `TypeCell` 插件类型选项（贡献 + resolver.list 并集）+ `row-io` 读取格式化经 resolver）。
  插件 dataType 运行时由插件 `activate` 经 resolver.register 注入；范围收敛：插件类型仅单寄存器（registerCount 恒 1）。

## 实施注记（E-4/E-5/E-6 落地，2026-09-01）

### E-4 自定义功能码示例插件（已落地）

- 新包 `plugins/custom-function-code`：`CustomFunctionCodec`（protocolId="custom-function-code"，FC 0x65 读 / 0x66 写，复用 protocol-modbus `appendCrc`/`crc16Modbus`）、
  `registerCustomFunctionPlugin(registry, {codecRegistry, dataTypeResolver})`（manifest 含 protocolExtension+tableType+toolbarAction+command+dataType 贡献，
  activate 注册 codec + dataType handlers `custom-function-code:scaled`）、codec.test.ts 9 用例 + plugin.test.ts 3 用例全绿。
- `apps/web/src/App.tsx` import + registerCustomFunctionPlugin；i18n `plugins.customFunctionTitle`/`table.customZero/customScaled`（en/zh）。
- 能力矩阵：browserCapabilities + electronCapabilities 追加 `"custom-function-code"` 协议 + `"custom-function-code:holding-register"` 表类型。
- `packages/platform-web/src/mock-transport.ts` 增 FC65/66 分支（与 FC03/10 同构）+ 测试 3 用例。
- e2e-web `custom-function-code.spec.ts`（2 用例全绿）：侧边栏分组新建自定义表 + FC65 读/FC66 写闭环 + comm log 帧 "01 65 00 01 00 01" + 插件 dataType 可编辑 "12.5"。
- **踩坑**：Vite dev server 缓存模块图，新增 workspace 包后 500 → kill 5173 重启 `pnpm dev`。

### E-5 寄存器手册（documentation 贡献点，已落地）

- `packages/plugin-api/src/builtin-contribution-points.ts`：`DOCUMENTATION_CONTRIBUTION_SCHEMA` 扩展 `{id, titleKey, markdown: z.string()}`。
- `packages/ui/src/components/DocumentationPanel.tsx`（组件）+ `documentation-markdown.tsx`（`renderMarkdown` 轻量渲染 + `DocumentationContribution` 接口，拆分因 react-refresh only-export-components）：
  `#`/`##`/`###` 标题、段落（行内 code/bold）、`-`/`*` 无序列表、``` 围栏代码块（antd Typography + pre）。
- `MamepApp.tsx`：`usePluginContributions<DocumentationContribution>(host, "documentation")` + Help Modal 增 `<Divider/> + <DocumentationPanel>`。
- 安川插件 manifest 增 `documentation: {id:"yaskawa.register-manual", titleKey:"plugins.yaskawaManualTitle", markdown: 安川 67H/010DH/010EH 手册摘要}`。
- 测试：DocumentationPanel.test.tsx 4 用例（getByText 用正则匹配行内拆分文本）+ yaskawa plugin.test 增 documentation 断言；
  e2e-web `documentation.spec.ts`（1 用例全绿，Help 弹窗渲染手册 + 关闭重开）。
- **坑**：段落文本被行内元素拆分 → `getByText(/A paragraph with/)` 正则。

### E-6 VSCode codec 接线（已落地，e2e-vscode 全绿）

- `packages/platform-api/src/host-message.ts`：`sessionConnectPayloadSchema` 增可选 `protocol: z.string().optional()`。
- `apps/web/src/vscode-app-host.ts`：`connect(profile, handle, options?: {protocol?})`，bridge.sessionConnect 仅非 rtu 时携带 protocol。
- `apps/vscode-extension/src/session-host.ts`：`VscodeSessionHostOptions` 增 `codecRegistry?`；`connect` 增 `options?: {protocol?}`，
  透传 `rtu.connect({protocol, codecRegistry})`（非 rtu 且注入时）。
- `apps/vscode-extension/src/ipc.ts`：`session-connect` 分支解构 protocol 并透传（非 rtu 才传）。
- `apps/vscode-extension/src/extension.ts`：createSessionHost 内 `createCodecRegistry()` + `registerBasicTablesCodecs` + `codecRegistry.register(new MemobusCodec())` 注入 `VscodeSessionHost`。
- `vscodeCapabilities` 翻转：`protocolExtensions` 含 yaskawa + 3 基础表 + custom-function-code；`tableTypes` 含 holding-register + 3 基础表 + 2 插件表。
- `apps/vscode-extension/package.json` 增 `@mamep2026/yaskawa-memobus-67h-010dh-010eh` 依赖。
- **DevFakeSerialFactory 扩展 FC01/FC0F**（基础表 e2e）：`devFakeSerialState.coils` Map + 读线圈位打包/写多线圈位解包分支。
- e2e-vscode `run.test.ts` 新增 `runBasicTableLoop`（真实 RPC：session-connect protocol="modbus-basic-tables:coil" → FC0F 写 ON → FC01 读回 1 → 帧计数 1:1 → 断开），`pnpm test:e2e:vscode` 全绿。
- 测试：ipc.test.ts（connect 4 参 + protocol 透传用例）、vscode-app-host.test.ts（protocol 透传/rtu 不携带 2 用例）补充；
  typecheck 24/24、lint 0、单测全绿（vscode-extension 75 / web 75 / ui 301 / platform-api 70 / application 46 / communication 124）。
- **坑**：ESLint 10 `no-fallthrough` 对「case 间注释」误报（注释被当作上一 case 内容）→ 注释并入 case 组首行注释块；
  react-refresh `only-export-components` → 纯函数/接口与组件拆分文件。
