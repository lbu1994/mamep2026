# ADR-040：插件 Phase B —— 协议扩展（ProtocolCodec + codec 注入 + protocol-memobus）

- 状态：**已确认（2026-08-31）**
- 日期：2026-08-31
- **修订（2026-08-31，用户决策 B）**：决策 3 承载位置由 3A（独立包 `packages/protocol-memobus`）改为**插件包 `plugins/yaskawa-memobus-67h-010dh-010eh/`**——厂商专用功能码随插件存放，软件（core）仅保留 `ProtocolCodec` 接口 / codec 注册表 / 会话注入等调用接口；`packages/protocol-memobus` 已迁移删除。Phase B 范围与其余决策不变。
- 决策来源：用户任务（[插件契约与架构](../architecture/ports/plugin-api/插件契约.md)；5 项确认：①通用 codec 注册表（1B）②实现 67/010D、67/010E（2）③独立包 `packages/protocol-memobus`（3A）④`SessionHostCore` codec 工厂注入（4A）⑤仅通信层改造 + 新包 + 单测，不接 UI / 不接 `protocolExtension` 贡献点消费方（5A））

## 背景

- **Phase A（ADR-039）已落地**：贡献点注册表（含 `protocolExtension` schema，空消费方）、Manifest v2、PluginCommunicationApi、日志 `pluginId`、能力矩阵 `protocolExtensions: []` 等如实声明。
- **现状缺口**（2026-08-31 代码核实）：`CommunicationSession.SessionProtocol = "rtu" | "tcp"` 封闭联合；`buildReadAttempt` / `buildWriteAttempt` / `startExchange` 内嵌 Modbus 编解码与分帧（`RtuFrameParser` / `TcpFrameParser` 私有类）；协议不可注入。
- **参考资料落档**：`docs/安川MEMOBUS公开协议参考.md`（源：安川 GA500 技术手册 SICP C710617 54B，用户 2026-08-31 提供），本次实现 67/010D（非连续读）与 67/010E（非连续写）。

## 决策

### 1. ProtocolCodec 抽象接口（支持连续与非连续地址列表）

设计文档 §4.1 的雏形接口扩展为支持**非连续寄存器列表**（67/010D、67/010E 的核心价值）。接口落 `packages/communication`（协议无关，不依赖 protocol-modbus / protocol-memobus）：

```ts
export interface CodecReadRequest {
  /** 要读取的寄存器编号列表（可连续可不连续；FC03 要求连续，67/010D 任意） */
  addresses: number[];
}
export interface CodecWriteRequest {
  entries: { address: number; value: number }[];
}
export type CodecDecodedResponse =
  | { kind: "read"; values: number[] } // 与指令 addresses 顺序一一对应
  | { kind: "write" }
  | { kind: "exception"; exceptionCode: number };

export interface FrameParser {
  push(
    chunk: Uint8Array,
  ):
    | { done: false }
    | { done: true; outcome: Result<CodecDecodedResponse>; frame: Uint8Array };
}

export interface ProtocolCodec {
  protocolId: string; // 如 "yaskawa-memobus-67h-010dh-010eh"
  encodeRead(req: CodecReadRequest): Uint8Array;
  encodeWrite(req: CodecWriteRequest): Uint8Array;
  decodeResponse(
    frame: Uint8Array,
    expect: unknown,
  ): Result<CodecDecodedResponse>;
  parserFactory(expect: unknown): FrameParser; // 分帧 / 半包粘包 / 重同步
  expectedLength(
    kind: "read" | "write",
    expect: unknown,
  ): { normal: number; exception: number };
}
```

- `expect` 为 codec 自定义期望描述（如 MEMOBUS：从站地址 + 寄存器列表 / 写入项），用于解码一致性校验（对齐 docs/AGENTS.md §10.2 语义）。
- 解码结果 `CodecDecodedResponse` 与现有 `DecodedRtuResponse` / `DecodedTcpResponse` **判别名不同**（`read`/`write` vs `read-holding`/`write-multiple`），避免与协议包判别类型混用。

### 2. 通用 codec 注册表 + 会话注入（决策 1B）——内置协议双轨、零回归

- 新增 `CodecRegistry`（`register` / `get` / `list`，落 `packages/communication`）；`CommunicationSession.SessionOptions` 增 `codecRegistry?`，`protocol` 语义开放为「`"rtu" | "tcp"`（内置）或注册表 codecId」。
- **双轨策略**：`"rtu"` / `"tcp"` 维持现有内置实现路径**零改动**（不把内置路径重构为 codec，规避高风险区大范围重构——§32-19 / §34）；codecId 走新的 `ProtocolCodec` 委托路径（`startExchange` 增加 codec parser 分支）。内置协议统一走 codec 路径的收敛重构列为后续事项评估。
- codec 路径复用既有调度语义：`RequestScheduler` 串行、超时/重试/取消/迟到响应、`source`/`pluginId`/`userAddress`/`sentAddress` 日志字段全沿用（§43 不变量不破）。
- 未知 codecId → 构造/连接期报错（`CODEC_NOT_FOUND`，category `configuration`），不静默回退。

### 3. 安川插件包 `plugins/yaskawa-memobus-67h-010dh-010eh`（承载位置修订为决策 B，2026-08-31）

- **不进 `protocol-modbus`、与核心零耦合**（红线 §5.3 / §10.1）：不 import protocol-modbus 任何符号；软件（core）只提供调用接口。
- 实现功能码 **67/010D（非连续读，≤120）** 与 **67/010E（非连续写，≤60）**（帧结构见 `docs/安川MEMOBUS公开协议参考.md` §1~§2）：
  - `encodeRead`：地址列表 → 67/010D 指令帧（从站地址 + 67 + 010D + 数据个数 + 寄存器编号×N + CRC-16）；
  - `encodeWrite`：写入项列表 → 67/010E 指令帧（… + 数据个数 + 字节数(＝个数×2) + （编号+数据）×N + CRC-16）；
  - `decodeResponse`：正常读（字节数 + 数据×N）/ 正常写（数据个数回显）/ 异常（功能码 `E7` + 错误代码），按 `expect` 做从站地址 / 辅助功能码 / 字节数 / 个数一致性校验；
  - `parserFactory`：RTU 式期望长度分帧 + CRC 校验 + 噪声重同步（复用既有 RtuFrameParser 语义，**自带实现**）；
  - `expectedLength`：正常/异常帧长按寄存器数计算。
- **CRC-16 自带实现**（标准 CRC-16/MODBUS poly 0x8005 init 0xFFFF），不 import 核心 crc16；实现时用参考文档 §6 手册向量复核，**若手册 CRC 与标准算法不一致则视为待核实项、不得假设**（§32-2）。
- **错误映射**：异常响应 → `MamepError`（category 沿用 `modbus-exception` 语义的「设备异常」，code `MEMOBUS_EXCEPTION_${HEX}`，i18n key 映射留 Phase C UI）；`userMessageKey` 沿用 `errors.modbusException`。
- 数量上限守卫：读 ≤120、写 ≤60（表 6.20 错误码 03）；`QUANTITY_OUT_OF_RANGE`（沿用会话既有错误码形态）。

### 4. 日志 protocol 字段放宽

- `CommunicationLogEvent.protocol: "rtu" | "tcp"` → `string`（语义 = 内置协议或 codecId）；
- `packages/platform-api/src/session-payloads.ts:356` `commLogEventPayloadSchema.protocol` `z.enum(["rtu","tcp"])` → `z.string()`（跨边界契约同步，Phase A 已加的 `pluginId` 不动）。

### 5. 会话层接入：`SessionHostCore` 支持 codec 工厂注入（决策 4A）

- `SessionHostCore` 增可选 codec 解析/注入，构造 `CommunicationSession` 时透传 `codecRegistry`；**不新建 `MemobusSessionHost`**（避免每个协议一个 Host）。
- `getAddressAdjustMode` 复用既有注入抽象，不变。

### 6. Phase B 边界（决策 5A，如实声明）

- **不做**：UI 协议入口（Connection Settings 不加 MEMOBUS 选项）、三端接线、`protocolExtension` 贡献点消费方接线（插件经贡献点注册 codec）、HostMessage 新 kind（Phase A 插件桥 kind 维持能力错误占位语义）。
- **能力矩阵不变**：`protocolExtensions` 维持 `[]`（`protocol-memobus` 为独立库，未被插件/UI 消费，如实声明）。
- 协议层 / 工作区 schema **零改动**；三端除日志 schema 联动外零改动。

## 明确顺延（后续阶段）

- `protocolExtension` 贡献点消费方接线（插件 manifest 声明 codec → 注册进会话）——**Phase C**；
- 安川表类型（`tableType` 消费方 + schema v4→v5 + 新建表选类型 UI + 67/010D、010E 在表读写/轮询/追踪/写后回读中的接入）——**Phase C**；
- 确定指令 Enter（0900/0910，归类已按用户 2026-08-31 决策确认）与禁止读取区守卫——**Phase C**；
- 内置 rtu/tcp 统一走 codec 路径的收敛重构——后续评估；
- MEMOBUS over TCP 承载（是否 MBAP / 是否支持 67）——待核实，当前仅 RTU/串口承载。

## 影响与边界

- **改动**：
  - `packages/communication`：`codec.ts`（接口 + 注册表 + FrameParser）+ `session.ts`（protocol 开放、codec 路径、startExchange codec 分支）+ `log-event.ts`（protocol 放宽）；
  - `plugins/yaskawa-memobus-67h-010dh-010eh`（**新插件包**，决策 B）：codec 实现 + CRC16 + parser + 错误映射 + 单测 + 会话集成闭环；
  - `packages/application`：`SessionHostCore` codec 注入；
  - `packages/platform-api`：`commLogEventPayloadSchema.protocol` 放宽；
  - 文档：`docs/安川MEMOBUS公开协议参考.md`（新增，ADR-040 引用）。
- **不影响**：`protocol-modbus` 零改动；RTU/TCP 内置路径零回归（双轨）；工作区 schema / 迁移零改动；能力矩阵不变；三端应用代码零改动。
- **红线遵守**：安川协议不进核心、零耦合；不接 UI/插件消费；浏览器不实现 TCP；插件不得直取传输句柄（codec 仅编解码，不触传输）。

## 测试

- `communication`：codec 路径（FakeTransport + 伪 codec：读/写/异常/超时/重试/取消/迟到响应/串行调度）、未知 codecId 报错、**内置 rtu/tcp 全量既有测试零回归**；
- `plugins/yaskawa-memobus-67h-010dh-010eh`：编解码向量（参考文档 §6 手册表 6.11/6.12 示例帧）、CRC16 向量、分帧（半包/粘包/CRC 损坏重同步/异常帧）、一致性校验（从站地址/辅助功能码/字节数/个数不匹配）、数量上限（读 120/写 60）与边界、异常错误码映射、**真实 codec 注入会话的读/写/异常集成闭环**；
- `application`：`SessionHostCore` codec 注入透传；
- `platform-api`：`commLogEventPayloadSchema` protocol 放宽校验；
- e2e：三端 mock e2e **无回归**（无新 UI/无三端接线，不新增 e2e 用例）。

## 后续复审条件

- Phase B 验收：单测全绿 + typecheck/lint 通过 + 三端 mock e2e 无回归；
- Phase C 落地前：`protocolExtensions` 维持 `[]` 如实声明；`plugins/yaskawa-memobus-67h-010dh-010eh` 不接 UI/插件。
