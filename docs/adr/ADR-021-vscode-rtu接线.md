# ADR-021：VSCode 端 RTU 接线（三端 RTU P0 闭环）

- 状态：已确认
- 日期：2026-08-23
- 决策来源：用户指令（2026-08-23 按 P0 顺序补齐能力：VSCode RTU 接线 → 完成「三端 RTU」硬性 P0）

## 背景

ADR-019（VSCode 骨架）与 ADR-020（Node 串口库选型 + Node Serial Adapter 原型）均已落地。
本 ADR 记录「VSCode 端 RTU 接线」的实现决策：Extension Host 串口 → HostMessage v1 RPC →
能力矩阵翻转 `modbusRtu:true`，打通浏览器 / Electron / VSCode 三端 RTU 闭环（PRD P0 硬性项）。

前置门槛验证：`pnpm probe:vscode:serial`（com0com COM4/COM5 + modbus-slave，真实 VSCode
扩展宿主）**通过**——serialport@13（NAPI 绑定）在 Extension Host 无需重建即可加载/枚举/打开/
FC03 闭环（node 24.18.1 / electron 42.8.1），ADR-020 的 ABI 前置项解除（无需为 VSCode ABI 重建）。

## 决策

1. **通信位置：Extension Host 全量承载（TECH_DESIGN §28.3）**。Modbus 会话/调度/轮询/Trace 全部
   在 Extension Host 执行，Renderer（Webview）的 `VscodeAppHost` 作为「远程会话代理」——connect/
   读/写/批量/轮询/Trace/日志/消息全部经 HostMessage v1 类型化 RPC 委托 Extension Host。
   与 Electron（复用 Web Serial，通信在 Renderer，ADR-017）路径不同：VSCode Webview 无
   `navigator.serial`，串口必须位于宿主侧。

2. **共享编排层 `packages/application`（RtuSessionHost）**。为避免三端复制核心会话逻辑
   （AGENTS.md §32 ㉑），把 BrowserAppHost 的「连接后会话编排」抽取为传输无关的
   `RtuSessionHost`（组合 CommunicationSession + Polling/Trace/BatchRead 协调器 +
   RegisterTableService 地址调整 + 设备拔出策略，事件经回调外抛；`openTransport` 由调用方注入，
   不依赖 platform-api / platform-node）。浏览器/Electron（BrowserAppHost）与 VSCode
   Extension Host（VscodeSessionHost）共用。该层归属 Application 层（TECH_DESIGN §5.1.2）。

3. **HostMessage v1 契约扩展**（`packages/platform-api/src/host-message.ts` +
   `session-payloads.ts`）。新增 request kind：`serial-enumerate`、`session-connect`、
   `session-disconnect`、`session-get-state`、`session-set-slave-address`、`session-read-row`、
   `session-write-row`、`session-batch-read`、`session-update-polling-targets`、
   `session-polling-start|stop`、`session-trace-start|stop`；新增 event kind：`comm-log`、
   `poll-result`、`trace-sample`、`app-message`（复用既有 `connection-state`）。全部进白名单 +
   Zod schema；领域对象用「可序列化投影」（`session-payloads.ts`：profile/row/bytes↔hex 等），
   品牌化 ID / RegisterAddress / RawRegisterValue 由 FromPayload 重建。`session-batch-read`
   单次往返（行结果经 poll-result 事件流推送，响应只带汇总）。

4. **能力矩阵翻转**：`vscodeCapabilities` → `modbusRtu:true`、`serialPorts:"enumerated"`
   （modbusTcp/filesystem/nodePlugins 维持如实声明，AGENTS.md §32 ㉒）。UI 侧 `ConnectionSettingsModal`
   修正：`!supportsSerial` 警告与「先选口」校验均纳入 `isEnumerated`（VSCode/Electron 走 antd Select
   下拉路径，不显示「不支持 Web Serial」误导）。

5. **串口选择流程（无手势约束）**：VSCode 无浏览器授权手势，`serial-enumerate` 请求直接返回端口
   列表 → 共享 UI antd Select 下拉 → `selectSerialPort(portId)` 本地暂存句柄 → `session-connect`
   由 Extension Host `NodePlatformHost.openSerialTransport` 打开。不走 Electron 的
   `select-serial-port` 授权流程（该 kind 在 VSCode 返回能力错误）。

6. **e2e 假串口注入（`MAMEP_FAKE_SERIAL=1`）**：Extension Host 在 `isDev && MAMEP_FAKE_SERIAL=1`
   时装配 `DevFakeSerialFactory`（`apps/vscode-extension/src/dev-fake-serial.ts`，实现公开注入面
   SerialPortFactoryLike/SerialPortLike，内联 CRC16 Modbus RTU responder：FC03 读/FC0x10 写）。
   参照 e2e-electron fake navigator.serial 模式，在宿主进程内注入（VSCode Webview 无此路径）；
   仅 dev/test 门控，生产打包不装配。`tests/e2e-vscode` 的 RTU 闭环经 dev-only `debug:rpc` 命令
   （复用真实 `handleVscodeInvoke` 路径）驱动：枚举 → 连接 → FC10 写 → FC03 读 → 状态 → 断开，
   并覆盖面板关闭释放（重连成功 = 串口无 EBUSY 残留）。

7. **Webview 关闭即断开 + 扩展停用释放**：面板 dispose 与 `deactivate()` 均调用
   `session.dispose()`（断开连接/释放串口）。§35 待确认项「Webview 关闭后是否保持连接」按安全默认
   （关闭即断开）实现并在此记录；若产品策略变化需改 ADR。

8. **探针门控修正**：`@vscode/test-electron` + extensionTestsPath 下 `context.extensionMode` 为
   `ExtensionMode.Test`（非 Development）。探针/`debug:*` 门控从「=== Development」改为
   「!== Production」（dev/test 可探测，生产打包禁用），否则 e2e 探针被误关。

## 备选方案

- **Renderer 复用 BrowserAppHost + 远程字节传输代理**（`TransportPort` 代理，只透传字节）：被否决。
  改动面最小，但 Modbus 协议解析/调度跑在 Webview，偏离 §28.3「通信在 Extension Host 执行」，
  且与代码库向 Node Host 迁移的既定方向不一致。
- **Extension Host 侧复制 BrowserAppHost 编排**：被否决。违反 §32 ㉑（为三端复制核心业务逻辑），
  设备拔出策略等会出现多份实现。改为抽取共享 `RtuSessionHost`。

## 正面影响

- 「三端 RTU」硬性 P0 闭环：浏览器 / Electron / VSCode 均能下拉选择串口并完成 FC03 读/FC0x10 写；
- 通信位置与文档一致（§28.3），后续 Electron Node Serial 替换、两端 TCP 只需在既有共享边界加能力；
- `RtuSessionHost` 单一事实源：会话编排、设备拔出策略不再分叉；
- HostMessage v1 契约复用：新增 kind 全部 Zod 校验 + 白名单 + 穷尽性处理，安全边界不变；
- e2e 确定性：假串口注入无需真实设备/COM10+，CI 稳定。

## 负面影响

- `VscodeAppHost` 通信方法为远程代理：`getConnectionState`/`getCommProperties` 用本地缓存
  （connection-state 事件 + connect 响应刷新），非实时宿主状态；
- `readAllRows` 在 VSCode 端为单次往返：`BatchReadHandle.cancel()` 为 no-op（无法中途取消宿主
  批任务），P0 可接受，后续可改为批任务流式（batch id + 事件）；
  **补充（2026-08-25）**：UI 当前无取消入口（`RegisterTable.handleReadAll` 不调用 cancel），
  此限制不影响现有用户操作；保留待办系保持与浏览器端 `BatchReadCoordinator` 真取消语义的接口
  契约一致性，并为批量任务/写后回读（PRD §8.3 P1）与批任务流式取消前置。
  **已解决（2026-08-25，ADR-025）**：远程批任务取消落地——渲染端生成 batchId 随
  `session-batch-read` 传入，新增 `session-batch-cancel` kind 取消宿主批任务，UI 提供取消
  入口；`BatchReadHandle` 接口不变，取消语义与本地路径一致。
- `debug:rpc` dev-only 命令暴露真实 RPC 路径：仅扩展宿主进程内代码可调用（Webview 无法调用），
  isDev 门控，无安全风险但发布前需复核（与 `debug:getPanel` 同级别）。

## 后续复审条件

- Electron Node Serial 替换 Web Serial（ADR-017 演进）：复用 `RtuSessionHost` 与 platform-node；
- VSCode TCP / Electron TCP：新增 `session-tcp-connect` 等 kind，`modbusTcp` 翻转；
- VSCode 文件持久化：`filesystem` 能力翻转（workspaceState/globalState）；
- VSCode 主题完整适配（ui-theme）：颜色映射升级；
- 真机验证（接线后）：真实串口（含 COM10+）在 VSCode 端枚举/连接/读写；
- VSIX 打包发布：serialport 原生模块的正式分发规则（当前 e2e 走 extensionDevelopmentPath）。
