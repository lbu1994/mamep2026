# Node TCP Adapter 验证记录（2026-08-23）

> 范围：`packages/platform-node` 新增 Node TCP Adapter（docs/TECH_DESIGN.md §34.3.16 共享边界），
> 与既有 Node Serial Adapter（ADR-020）统一。仅传输适配层；能力矩阵未翻转。

## 现状核对结论

- `packages/platform-node` 的 Node Serial 部分已存在且全绿（ADR-020，serialport@13）：
  `NodeSerialTransport` / `NodePlatformHost` / `SerialPortLike` 注入面 / 错误映射 / 能力描述 /
  Layer 1 Fake 57 用例 + Layer 2 com0com 7 用例。
- `packages/communication/src/transport-port.ts` 的 `kind` 原为 `"web-serial" | "node-serial" | "mock" | "fake"`；
  全仓无对 kind 的穷尽 switch（仅定义处与测试断言），扩展安全。
- `packages/protocol-modbus` 原只有 RTU（`crc16.ts` / `rtu-frame.ts`），无 MBAP/TCP 帧。
- `packages/domain` 只有 `RtuConnectionProfile`，无 TCP 连接配置模型。
- 能力矩阵 `modbusTcp` 全仓为 `false`（本任务不翻转）。

## 已确认决策（用户 2026-08-23）

1. 仅传输适配层：不做 communication/session 的 TCP 帧解析闭环（`RtuFrameParser` 为 RTU 专用，保持不动）。
2. 新增最小 `TcpConnectionProfile`（host/port/unitId），**不入 workspace 持久化**，仅作打开参数载体。
3. **unitId 0~255**（MBAP 全范围，宽松校验）。
4. 能力矩阵 `modbusTcp` 不翻转；UI TCP 配置入口、`select-port` 类 request kind 不在范围。

## 新增 / 修改文件

| 文件                                                        | 说明                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/tcp-profile.ts`（新增）                | `TcpConnectionProfile` + `createTcpConnectionProfile` 校验（host 非空、port 1~~65535、unitId 0~~255）                                                                  |
| `packages/domain/src/tcp-profile.test.ts`（新增）           | 校验用例                                                                                                                                                               |
| `packages/protocol-modbus/src/tcp-frame.ts`（新增）         | MBAP 头编解码（事务标识 / 协议标识=0 / 长度 / 单元标识），无 CRC；`encodeTcpReadHoldingRegistersRequest` / `encodeTcpWriteSingleRegisterRequest` / `decodeTcpResponse` |
| `packages/protocol-modbus/src/tcp-frame.test.ts`（新增）    | 编解码 + 错误分支用例                                                                                                                                                  |
| `packages/platform-node/src/socket-like.ts`（新增）         | `SocketLike` / `NetFactoryLike` / `TcpConnectLike` 注入面（与 `SerialPortLike` 同构）                                                                                  |
| `packages/platform-node/src/real-socket.ts`（新增）         | Node `net` 真实封装（本包唯一直接 import node:net 的模块）；error→close 时序用一次性监听 + 常驻监听分离                                                                |
| `packages/platform-node/src/node-tcp-transport.ts`（新增）  | `NodeTcpTransport implements TransportPort`，`kind="node-tcp" as const`，镜像 `NodeSerialTransport`                                                                    |
| `packages/platform-node/src/tcp-capabilities.ts`（新增）    | `NodeTcpCapabilities` + `describeNodeTcpCapabilities`（§34.3.18 模式）                                                                                                 |
| `packages/platform-node/src/testing/fake-socket.ts`（新增） | `FakeSocket` / `FakeNetFactory`（Layer 1 注入）                                                                                                                        |
| `packages/platform-node/src/error-mapping.ts`（扩展）       | `mapTcpError` / `mapTcpOpenError`（§34.3.17 模式）                                                                                                                     |
| `packages/platform-node/src/node-platform-host.ts`（扩展）  | `NodePlatformHost.openTcpTransport` + `netFactory` / `tcpCapabilities` 构造选项                                                                                        |
| `packages/platform-api/src/host.ts`（扩展）                 | `PlatformHost` 新增 `openTcpTransport`                                                                                                                                 |
| `packages/platform-web/src/web-serial-host.ts`（扩展）      | `BrowserPlatformHost.openTcpTransport` 返回 capability 错误（`TCP_UNSUPPORTED`）                                                                                       |
| `packages/communication/src/transport-port.ts`（扩展）      | `kind` 联合新增 `"node-tcp"`                                                                                                                                           |
| `packages/ui/src/i18n/index.ts`（扩展）                     | 新增 7 个 TCP 错误码文案（en-US / zh-CN）                                                                                                                              |

## Layer 1 Fake 用例（vitest，默认执行）

- `node-tcp-transport.test.ts`：kind；打开/数据转发/关闭；写入透传；未打开写入 `TRANSPORT_NOT_OPEN`；
  重复打开 `TCP_OPEN_FAILED`；连接拒绝映射 `TCP_CONNECTION_FAILED`；未知打开错误 → `TCP_OPEN_FAILED`；
  写错误映射并保留 cause；错误事件映射上抛；未打开时丢弃数据/错误；被动关闭 close 事件仅一次；
  退订不泄漏；100 轮重连监听器无累积（§34.3.13）。
- `error-mapping.test.ts`（TCP 分支）：ECONNREFUSED/EHOSTUNREACH/ENETUNREACH/ENOTFOUND/EAI_AGAIN/ETIMEDOUT/
  ECONNRESET/EPIPE → `TCP_CONNECTION_FAILED`（connection, retryable）；EADDRINUSE → `TCP_PORT_IN_USE`
  （permission, 不重试）；受控字符串兜底；未知 io 错误 → `TCP_CONNECTION_FAILED` 保留原始信息；
  未知打开错误 → `TCP_OPEN_FAILED`。
- `tcp-capabilities.test.ts`：host="node"、library="node:net"、ipv4/ipv6、tls=false、
  unitId 0~~255、port 1~~65535。
- `node-platform-host.test.ts`（TCP 分支）：`openTcpTransport` 透传 host/port 且 kind="node-tcp"；
  非法 profile 在创建连接前拒绝；默认能力描述。

## Layer 2 本地回环用例（Node `net` 临时回环服务器，默认执行）

- 真实字节收发（echo）；0x00/0xFF 原始字节双向透传；
- 分片响应跨 data 事件重组成完整字节序列；
- 服务器断开 → transport 触发 close 且 open 状态清除、重复 close 幂等；
- 同一 transport 关闭后 5 轮重连读写；
- 连接拒绝（无监听端口）→ `TCP_CONNECTION_FAILED`。

## 错误映射表（§34.3.17）

| 底层信号                                                                                           | 错误码                  | category   | retryable | userMessageKey             |
| -------------------------------------------------------------------------------------------------- | ----------------------- | ---------- | --------- | -------------------------- |
| ECONNREFUSED / EHOSTUNREACH / ENETUNREACH / ENOTFOUND / EAI_AGAIN / ETIMEDOUT / ECONNRESET / EPIPE | `TCP_CONNECTION_FAILED` | connection | true      | errors.tcpConnectionFailed |
| EADDRINUSE / "address already in use"                                                              | `TCP_PORT_IN_USE`       | permission | false     | errors.tcpPortInUse        |
| 未知打开错误（兜底）                                                                               | `TCP_OPEN_FAILED`       | transport  | true      | errors.tcpOpenFailed       |
| 未知 io 错误（兜底）                                                                               | `TCP_CONNECTION_FAILED` | connection | true      | errors.tcpConnectionFailed |
| 未打开即写入                                                                                       | `TRANSPORT_NOT_OPEN`    | transport  | false     | errors.transportNotOpen    |
| 浏览器平台 TCP 能力缺失                                                                            | `TCP_UNSUPPORTED`       | capability | false     | errors.tcpUnsupported      |

## 能力描述（§34.3.18，`describeNodeTcpCapabilities`）

host=`"node"`、library=`"node:net"`、libraryVersion=注入（默认 `process.versions.node`）、
ipv4/ipv6=true、tls=false、unitId 0~~255、port 1~~65535。只用于 UI 展示与配置校验，不得绕过真实打开结果。

## 已知限制与后续接线项

> **接线状态（2026-08-23，ADR-022）**：以下「能力矩阵未翻转」「会话层 TCP 帧解析未做」
> 两项已在「两端 TCP 接线」落地：`communication` 新增 `TcpFrameParser`（MBAP 分帧/半包粘包/
> Transaction ID 匹配，§8.6），`CommunicationSession` 支持 `protocol:"tcp"`（tid 16 位递增回绕、
> 重试换新 tid）；Electron / VSCode 能力矩阵 `modbusTcp:true`，UI TCP 配置入口（Connection
> Settings TCP 分组）就绪。剩余项如下：

- **unitId 语义**：0~~255 为 MBAP 全范围；0 为广播（MVP 不实现广播写入）、248~~255 保留，后续会话层再约束。
- **真实设备**：IPv6 / 真实设备 / 大报文 / 长时间轮询 / 打包后运行待接线阶段补验。
- **i18n**：新增错误码文案已同步 en-US/zh-CN；协议层错误码（TCP_*_MISMATCH 等）沿用
  `errors.<lowercase>` 回退模式，无需显式条目。
