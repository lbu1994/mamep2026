# ADR-022：两端 Modbus TCP 接线（Electron + VSCode，含 UI TCP 配置入口）

- 状态：已确认
- 日期：2026-08-23
- 决策来源：用户指令（按 P0 顺序补齐能力：补 Electron TCP → VSCode TCP，含 UI 的 TCP 配置入口）

## 背景

- `packages/platform-node` 的 Node TCP Adapter（`NodeTcpTransport` / MBAP 编解码 / `TcpConnectionProfile`）
  已在 ADR-020 后续验证记录落地（仅传输适配层，能力矩阵未翻转）。
- 本 ADR 记录「两端 TCP 接线」：补齐会话层 TCP 分帧/Transaction ID、两端 Host 接线、
  UI TCP 配置入口，并把 Electron / VSCode 能力矩阵 `modbusTcp` 翻转为 `true`（浏览器保持 `false`）。

## 已确认决策（用户 2026-08-23，7 项）

1. **Electron TCP 会话位置：仅 TCP 走主进程**（`ElectronSessionHost` = NodePlatformHost +
   `TcpSessionHost`，HostMessage v1 远程代理）；RTU 维持 Renderer Web Serial（ADR-017）不动，
   两套会话并存，改动面最小、RTU 零回退。
2. **TcpConnectionProfile 入 workspace 持久化**（恢复 host/port/unitId/超时/重试；保持离线、不自动连接）。
3. **unitId 默认 0、范围 0~255**（与 TECH_DESIGN §18.4 一致；0=广播，MVP 不实现广播写入）。
4. **autoReconnect：UI 展示但禁用**（灰显 + 说明属 P1），profile 字段默认 false。
5. **TCP 表单字段精简**：host / port / unitId / 请求超时 / 重试；connectTimeoutMs / autoReconnect 不入表单。
6. **e2e 假 TCP 设备**：VSCode Extension Host 进程内 `DevFakeTcpServer`（`MAMEP_FAKE_TCP=1` 门控，
   127.0.0.1:1502）+ Electron e2e 测试进程内本地回环 net server。
7. **readAllRows cancel 接受 no-op**（P0 单次往返；批任务流式取消留后续）。

## 决策

1. **会话层协议抽象（communication）**：`CommunicationSession` 增加 `protocol: "rtu" | "tcp"`
   （默认 rtu，RTU 行为零回退）。TCP 用新增 `TcpFrameParser`（MBAP 按 Length 分帧：半包/粘包/
   多响应/非法 Length/迟到响应 tid 不匹配丢弃重同步，无 CRC）；Transaction ID 由会话层维护
   （16 位递增回绕、连接时重置、**每次尝试含重试使用新 tid**，§8.7/§12.2）。日志 `protocol` 字段
   rtu/tcp 判别，`slaveAddress` 字段对 TCP 记录 unitId。
2. **领域/工作区**：`TcpConnectionProfile` 补全字段（id/name/protocol/connectTimeoutMs/
   requestTimeoutMs/retryCount/autoReconnect + 内部 interRequestDelayMs 默认 50 兼作轮询间隔）；
   workspace `connectionProfiles` 改为 `protocol` 判别联合（RTU 分支原样，旧数据兼容，schemaVersion 不变）。
3. **会话宿主泛化（application）**：抽取协议无关 `SessionHostCore`（会话/轮询/追踪/批量/设备拔出），
   `RtuSessionHost` 保留公开 API 变薄封装，新增 `TcpSessionHost`（unitId 连接时确定，会话内不动态修改）。
4. **契约（platform-api）**：新增 `session-tcp-connect` request kind（payload = TCP profile，
   无串口句柄），复用 session 其余 kinds 与事件（comm-log/poll-result/trace-sample/app-message/
   connection-state）；`tcpConnectionProfilePayloadSchema` 投影；两端 HostApi 均暴露
   `sessionTcpConnect` 与全部会话 RPC 方法。
5. **VSCode 端（ADR-021 扩展）**：`VscodeSessionHost` 增加 `connectTcp`，按活动协议路由
   读/写/轮询/Trace/断开；`ipc.ts` 分发 `session-tcp-connect`；`DevFakeTcpServer`（`MAMEP_FAKE_TCP=1`）。
6. **Electron 端**：主进程 `ElectronSessionHost`（TCP 会话 + 事件转发 Renderer）；`ipc.ts` 异步化并
   分发会话 kinds（RTU kinds 维持能力错误——RTU 在 Renderer）；Renderer `ElectronAppHost` 变
   混合（RTU 本地 inner / TCP 远程代理，按 `activeProtocol` 路由，会话事件合并转发订阅者）；
   preload 暴露完整会话 RPC 桥。`ipc.ts` 的穷尽守卫同时修复了 ADR-021 遗留的未接线 kind 类型缺口
   （turbo 缓存曾掩盖）。
7. **UI（packages/ui）**：`ConnectionSettingsModal` 增加协议 `Segmented`（RTU/TCP，按能力矩阵
   `modbusTcp` 门控——浏览器不显示 TCP 入口）+ TCP 分组（antd `Input`/`InputNumber` + React Hook Form +
   Zod；host/port/unitId/超时/重试 + autoReconnect `Switch` 灰显）；CONNECT 按协议路由
   `host.connect` / `host.connectTcp`；`CommProperties` 增加 `protocol`/`unitId`，BottomPanel 按
   协议渲染摘要（TCP：host:port/Unit ID/超时/重试/状态）；i18n en-US/zh-CN 补齐。
8. **能力矩阵翻转**：`electronCapabilities` / `vscodeCapabilities` → `modbusTcp: true`；
   `browserCapabilities` 保持 `false`（无 TCP 入口）；`nodeHostCapabilities` 同步 true。
9. **文档同步**：本 ADR + TECH_DESIGN/AGENTS.md 实现状态/能力矩阵 + node-tcp-adapter 验证记录
   「待接线项」标记落地。

## 备选方案

- **Electron 整体切换主进程远程会话（RTU 也搬主进程）**：被否决。需同步把 RTU 从 Web Serial 迁到
  Node 串口，改动面大、超出本任务；用户确认「仅 TCP 走主进程」。
- **新增加 TcpSessionHost 复制 RtuSessionHost 编排**：被否决。违反 §32 ㉑；改为抽取共享
  `SessionHostCore`。
- **session kind 参数化（让 session-connect 支持 protocol）**：被否决（实现选择）。既有 RTU kinds
  已接线且有测试，新增独立 `session-tcp-connect` 零回归。
- **Electron Renderer 复用 VscodeAppHost 式远程代理类（共享 RemoteSessionProxyAppHost）**：
  实现选择。VSCode 全远程代理与 Electron 混合（RTU 本地/TCP 远程）形态不同，提取共享类收益有限、
  重构风险高；Electron TCP 远程代理按 VscodeAppHost 同构内联实现，后续可再抽取。

## 正面影响

- 打通 Electron / VSCode 两端 Modbus TCP 的 P0 闭环（UI 配置 → FC03 读 / FC0x10 写）；
- TCP 会话层分帧/Transaction ID 与 RTU 分离（`TcpFrameParser` + tid 管理），RTU 行为零回退；
- `SessionHostCore` 单一事实源：会话编排不再按协议复制；
- HostMessage v1 契约复用：新 kind 全部 Zod 校验 + 白名单 + 穷尽守卫；
- 浏览器能力矩阵如实声明且无 TCP 入口（组件测试断言）。

## 负面影响

- Electron 为混合形态（RTU 本地 / TCP 远程），`ElectronAppHost` 按 `activeProtocol` 路由，
  比纯远程代理（VSCode）稍复杂；
- TCP 通信属性摘要复用 RTU 形状字段（baudRate=0 等占位），UI 按 `protocol` 分支渲染；
- VSCode/Electron TCP 端 `readAllRows` cancel 为 no-op（P0 单次往返）；
- TCP unitId 会话内不动态修改（与 RTU 每表从站地址语义不同），工具栏「当前从站地址」对 TCP 无效
  （宿主 setSlaveAddress 已对 TCP 守卫为 no-op）。

## 后续复审条件

- 真机验证：IPv6 / 真实设备 / 大报文 / 长时间轮询 / 打包后运行（Windows 免安装绿色版）；
- VSCode VSIX 打包发布时 Node TCP 模块分发规则（当前 e2e 走 extensionDevelopmentPath）；
- 批任务流式取消（batch id + 事件）替代单次往返；
- 自动重连（P1）落地；
- Electron RTU 迁移 Node Serial（ADR-017 演进）后可整体切主进程远程会话，届时可抽取共享远程代理。
