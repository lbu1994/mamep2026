# ADR-020：Node 串口库选型（serialport@13）与 Node Serial Adapter 原型结论

- 状态：已确认（原型验证通过；正式接线待后续版本）
- 日期：2026-08-23
- 决策来源：用户指令（2026-08-23 Node 串口原型，TECH_DESIGN §34.3；候选库范围=仅深度验证 serialport@13）

## 背景

TECH_DESIGN §34.3 要求：启动 Node 串口原型，验证候选串口库在 Electron 主进程与 VSCode Extension
Host 的可行性（跨平台枚举、参数支持、错误映射、资源释放、原生模块兼容），产出串口库选型 ADR。
这是 VSCode RTU 与两端（Electron/VSCode）TCP 的共同地基，也是 TECH_DESIGN 明确的前置门槛。

- serialport@13.0.0 已在根 node_modules（scripts/modbus-slave 在用），`@serialport/bindings-cpp@13.0.0`
  已进 `pnpm-workspace.yaml` 的 `allowBuilds` 白名单；
- 本原型交付：`packages/platform-node`（Node Serial Adapter：`NodeSerialTransport` +
  `NodePlatformHost` + 错误映射 + 能力描述 + 注入式 `SerialPortLike` 隔离面 + Fake 测试）、
  com0com COM4↔COM5 虚拟串口闭环、Electron / VSCode 独立探针（不动生产代码）；
- 原型代码不直接复制进生产（§34.3.21）；本 ADR 是「是否可以进入正式实现」的结论载体。

## 决策

1. **串口库选型：serialport@13**（`serialport` + `@serialport/bindings-cpp` + `@serialport/stream`）。
   Node Serial Adapter 由其封装，`serialport` 的具体类型/对象/依赖**不得**泄漏进 Domain、Application、
   UI、工作区数据或插件公开 API（§34.3.1 末尾）。注入面为 `SerialPortLike` / `SerialPortFactoryLike`
   （`packages/platform-node/src/serial-port-like.ts`），真实封装只在 `real-serial-port.ts`。

2. **共享边界（§34.3.16）**：Electron 主进程与 VSCode Extension Host 共享 `SerialPortLike`、
   `NodeSerialTransport`（业务无关）、`NodePlatformHost`、错误映射、字节事件模型、资源释放逻辑、
   Fake/虚拟串口测试用例与能力描述；不共享 Electron IPC、VSCode Webview RPC、生命周期、打包配置、
   原生二进制（两端分别安装/构建/打包原生依赖）。

3. **能力矩阵不翻转（本原型范围）**：Electron 维持 Web Serial 路径（ADR-017）、VSCode 维持骨架声明
   （ADR-019）。`electronCapabilities` / `vscodeCapabilities` 的翻转属于接线阶段，见后续复审条件。
   `packages/platform-node` 提供原型默认 `nodeHostCapabilities` 与 `NodeSerialCapabilities`
   （§34.3.18 能力描述，只用于 UI 展示与配置校验，不得绕过真实打开结果）。

4. **`TransportPort.kind` 扩展**：`packages/communication/src/transport-port.ts` 的封闭联合新增
   `"node-serial"`（现为 `"web-serial" | "node-serial" | "mock" | "fake"`）。已排查全部消费点，
   无对 kind 的穷尽 switch，扩展无破坏（全仓 typecheck 通过）。

5. **错误码（§34.3.17）**：复用既有码（`SERIAL_PORT_IN_USE` 对应文档的 `SERIAL_PORT_BUSY`、
   `SERIAL_PERMISSION_DENIED`、`SERIAL_DEVICE_DISCONNECTED`、`TRANSPORT_NOT_OPEN`、
   `TRANSPORT_WRITE_FAILED`、`SERIAL_ERROR`）；新增最小集 `SERIAL_NOT_FOUND`（端口不存在）、
   `SERIAL_PARAMETER_UNSUPPORTED`（参数不支持）、`SERIAL_OPEN_FAILED`（打开兜底）、
   `SERIAL_CANCELLED`（取消，复用 `errors.cancelled`）。新增码已补 `packages/ui` i18n（en-US/zh-CN）。
   映射综合错误类型 / 错误码 / OS errno / 受控字符串匹配，未知错误映射为通用错误并保留原始信息。

## 备选方案

- **usb（node-usb）自建串口协议**：被否决。属底层库，串口语义（打开参数、流控、断开检测、平台差异）
  需自维护，风险与成本高；serialport 已覆盖 Windows/macOS/Linux 与 COM10+，且本仓库已有 v13 使用与
  原生绑定白名单，无需新增构建面。
- **其他高层候选**：文档级对比均未在「维护状态 + 完整 TS 类型 + 三平台 + Electron/VSCode 支持 +
  枚举元数据（`PortInfo` 的 path 保证字段与厂商/序列号/PnP/USB 元数据）+ 断开检测 + 许可证」上
  同时满足。serialport 的 `PortInfo` 字段与 §34.3.2 要求一一对应。

## 理由

- §34.3.1 证据矩阵全部满足（详见《node-serial-prototype-验证记录.md》）：MIT 许可证、三平台、
  Windows/macOS/Linux x64+arm64 构建（文档级）、Electron Main / VSCode Extension Host 目标 ABI
  （文档级 + 探针验证，见下）、API 稳定、断开检测（`DisconnectedError` / `close` 事件）、
  不要求 UI 直接依赖。
- **Layer 1（Fake，57 用例）全绿**：打开/关闭/读/写/超时/取消/拔出/错误注入/分片/迟到/重复连接、
  COM10+ 不透明路径、100 轮重连监听器无累积、错误映射表、能力描述、参数映射（含 rts-cts / xon-xoff）。
- **Layer 2（com0com COM4↔COM5 + modbus-slave，7 用例）全绿**：真实枚举（COM4/COM5 出现）、
  FC03 读 0x0000=1234、FC10 写 0x0001 后回读确认、从站占用 COM5 时打开映射
  `SERIAL_PORT_IN_USE`（Windows 实报 "Access denied" → 受控匹配）、关闭后重连可读写、
  0x00/0xFF 原始字节双向透传、多次写入与端口对重开。
- 仓库已有 serialport@13 绑定构建与白名单，新包无额外原生构建成本。

## 正面影响

- 三端 RTU 共同地基确定：Node Serial Adapter 接口与错误模型先行落地，VSCode RTU / 两端 TCP 接线
  只需在既有共享边界上加能力，不重复选型；
- 注入式 `SerialPortLike` 隔离面使 Layer 1 测试不依赖真实设备，CI 稳定；
- 错误码与 i18n 已就位，UI 展示占用/权限/不存在等场景可直接消费。

## 负面影响

- **原生模块 ABI**：serialport 原生绑定默认按当前 Node ABI 构建；Electron 43 / VSCode 扩展宿主的
  ABI 不同，首次加载可能报 ABI 不匹配，需用 `@electron/rebuild` 为对应宿主重建（重建会改变 ABI，
  与 Node 侧测试互斥，须分开环境处理）。这是接线阶段必须解决的前置项。
- macOS / Linux 平台矩阵目前为文档级 + 本地 Windows x64 实测，需目标平台环境补验。

## 后续复审条件

- **Electron 接线**：Node Serial Adapter 替换 Web Serial（ADR-017 演进），`electronCapabilities`
  翻转为系统枚举；先验证打包后原生模块可加载（需改 `scripts/package-electron.mjs` 将 serialport
  及其原生绑定纳入 staging，`asar:false` 下可直接加载）。
- **VSCode 接线**：`vscodeCapabilities` 翻转 `modbusRtu:true` / `serialPorts:"enumerated"`，
  `select-serial-port` 由 `SERIAL_UNSUPPORTED` 改为真实实现；Webview 仍只走类型化 RPC。
- **Node TCP Adapter**：复用本 ADR 的共享边界与错误映射，新增 `TransportPort.kind: "node-tcp"`。
- **待用户最终确认（AGENTS §35）**：1.5 停止位支持（serialport 类型面声明 `1|1.5|2`，真机待验）、
  XON/XOFF 与 RTS/CTS 的实际能力矩阵（真机验证后回填 `NodeSerialCapabilities`）。
- **真机验证**：至少一种真实 USB 转串口 + 可控 Modbus RTU 设备（FC03/FC10、不同波特率/校验、超时/
  重试/CRC 错误/拔出/占用/长轮询/Electron/VSCode）。
- `tests/e2e-electron` / `tests/e2e-vscode` 随接线持续扩展覆盖。
