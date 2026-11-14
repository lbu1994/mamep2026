# Node 串口原型验证记录（2026-08-23，TECH_DESIGN §34.3）

对应 ADR-020。验证方法遵循 §34.3.20 三层测试；未执行项如实标注，不得以 Mock 冒充真机。

## 1. 范围与方法

| 层               | 手段                                                                                    | 位置                                                                                                   | 结果                           |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Layer 1 Fake     | 注入式 `FakeSerialPort` / `FakeSerialPortFactory` + `ScriptedModbusRtuDevice`           | `packages/platform-node/src/*.test.ts`                                                                 | 57 用例全绿                    |
| Layer 2 虚拟串口 | com0com **COM4↔COM5**（只读写、未做任何配置/提权）+ `scripts/modbus-slave`（COM5 从站） | `virtual-serial.integration.test.ts` / `virtual-serial-loopback.test.ts`（`pnpm test:serial:virtual`） | 7 用例全绿                     |
| Layer 3 真实设备 | 真实 USB 转串口 + 可控 Modbus RTU 设备                                                  | —                                                                                                      | **未执行（如实标注：待真机）** |

- 默认运行（无环境变量）：Layer 2 用例 skip（`describe.skipIf`），不影响常规 CI。
- 运行 Layer 2：`pnpm test:serial:virtual`（自动拉起/关闭从站，串行执行两个文件避免抢端口）。
- 探针（Electron / VSCode，用户手动运行）：`pnpm prototype:electron`、`pnpm probe:vscode:serial`，
  详见 `scripts/prototype/README.md`。

## 2. Layer 1 测试清单（Fake，57 用例摘要）

- **打开**：成功 / 打开失败映射结构化错误（EACCES→SERIAL_PERMISSION_DENIED）/ 未知打开错误→
  SERIAL_OPEN_FAILED / 重复打开守卫。
- **写入**：未打开→TRANSPORT_NOT_OPEN / 字节转发 / 写失败映射（EIO→SERIAL_ERROR）。
- **数据**：分片投递 / 空数据不投递 / RTU 请求-响应闭环（ScriptedModbusRtuDevice）/
  端口错误映射 onError / 关闭后错误不投递。
- **关闭/拔出**：onClose 恰好一次 / 多次 close 幂等 / simulateClose 被动拔出通知 /
  关闭后迟到数据不投递 / 关闭后可重开。
- **监听器卫生（§34.3.13）**：100 轮连接-断开每次恰一次数据投递 / 20 轮每次恰一次 onClose。
- **参数映射（§34.3.5）**：profile→库选项（含 rts-cts→rtscts、xon-xoff→xon/xoff、off→全 false）；
  高编号 COM 路径不透明原样传递（COM10/COM99）；POSIX 路径原样。
- **参数校验**：零/负/非整数/NaN 波特率在连接前拒绝（SERIAL_PARAMETER_UNSUPPORTED）。
- **错误映射表（§34.3.17，12 类）**：DisconnectedError→SERIAL_DEVICE_DISCONNECTED；ENOENT/ENXIO/
  ENODEV 与 "no such file/not found"→SERIAL_NOT_FOUND；EACCES/EPERM→SERIAL_PERMISSION_DENIED；
  EBUSY/EAGAIN 与 "Access denied/already open/in use/resource busy"→SERIAL_PORT_IN_USE；
  canceled→SERIAL_CANCELLED；"unsupported/invalid baudRate"→SERIAL_PARAMETER_UNSUPPORTED；
  未知→SERIAL_ERROR（retryable，保留原始信息）；打开兜底→SERIAL_OPEN_FAILED。
- **能力描述（§34.3.18）**：枚举/数据位 7·8/停止位 1·2/校验 none·even·odd/流控 off·rts-cts·xon-xoff/
  拔出检测/USB 元数据/平台/Host=node/库名与版本。
- **Host**：枚举→句柄（原始 path 作 id、显示名独立 label）/空列表 / 枚举失败结构化错误 /
  requestSerialPort 原型语义（首个端口/null）/ openSerialTransport 建传输（选项映射、无效参数先拒绝）。

## 3. Layer 2 真实验证记录（com0com COM4↔COM5 + modbus-slave）

| #   | 场景                                                                                                                      | 结果 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 真实枚举包含 COM4 与 COM5（serialport 原生绑定 + Windows 系统枚举）                                                       | ✅   |
| 2   | 打开 COM4（9600/8N1/无流控，lock）→ FC03 读 0x0000 返回 1234（0x04D2），CRC 正确                                          | ✅   |
| 3   | FC10 写 0x0001=0x1234 → 回执 8 字节 → FC03 回读确认持久化                                                                 | ✅   |
| 4   | 从站占用 COM5（lock=true）时打开 COM5 → 失败映射 **SERIAL_PORT_IN_USE**（Windows 实报 "Access denied"，经受控字符串匹配） | ✅   |
| 5   | 关闭后重连同一 COM4 可再次读写                                                                                            | ✅   |
| 6   | COM4→COM5 与 COM5→COM4 原始字节双向透传（含 0x00/0xFF）                                                                   | ✅   |
| 7   | 5 次连续写入 + 端口对关闭后重开再透传                                                                                     | ✅   |

> 运行方式：`pnpm test:serial:virtual`（自动 spawn/杀 modbus-slave；串行执行两个测试文件，
> 因二者共用 COM4/COM5，并行会抢端口导致 Access denied——已通过 `vitest.config.ts` 的
> `fileParallelism:false` 解决）。

## 4. 端口路径处理（§34.3.4）

串口路径作为不透明字符串原样传递，不假设端口名称长度、不截断数字、不从界面文本重新拼接。

## 5. 各平台支持参数矩阵（文档级 + 本地 Windows x64 实测）

| 参数                                                | 支持              | 说明                                                                      |
| --------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| 波特率 1200/2400/4800/9600/19200/38400/57600/115200 | ✅                | serialport 官方清单；本地实测 9600                                        |
| 数据位 7 / 8                                        | ✅                | 类型面 `5                                                                 | 6   | 7                  | 8`；领域模型仅 7/8 |
| 停止位 1 / 2                                        | ✅                | 类型面 `1                                                                 | 1.5 | 2`；领域模型仅 1/2 |
| 停止位 1.5                                          | ⚠️ 待确认         | 类型面支持；真实设备/驱动支持情况待真机验证（AGENTS §35 待决项）          |
| 校验 none / even / odd                              | ✅                | 类型面（Windows 另含 mark/space，领域模型不使用）                         |
| 流控 OFF / RTS/CTS / XON/XOFF                       | ✅（类型面）      | `rtscts`/`xon`/`xoff` 旗标；实际能力矩阵待真机验证回填（§35 待决项）      |
| lock（独占，防重复打开）                            | ✅                | 默认 true；Windows 不支持 lock=false                                      |

> 未执行项：macOS（/dev/cu._、/dev/tty._）、Linux（/dev/ttyUSB*、/dev/ttyACM*）平台实测，
> 需目标平台环境，如实标注。

## 6. 原生模块构建矩阵

| 平台                  | 结论          | 依据                                                                                              |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| Windows x64           | ✅ 本地实测   | 本机 `@serialport/bindings-cpp@13.0.0` 原生绑定构建/加载成功（Node 24），com0com 真实验证通过     |
| Windows arm64         | 文档级        | serialport 官方声明支持；未在本机验证                                                             |
| macOS x64 / arm64     | 文档级        | 同上                                                                                              |
| Linux x64 / arm64     | 文档级        | 同上                                                                                              |
| Electron 43（Main）   | ⚠️ ABI 待验证 | 原生绑定按 Node ABI 构建；探针 `pnpm prototype:electron` 将如实报告，可能需要 `@electron/rebuild` |
| VSCode Extension Host | ⚠️ ABI 待验证 | 探针 `pnpm probe:vscode:serial` 将如实报告                                                        |

## 7. 串口错误映射表（§34.3.17）

| 底层信号                                                                       | 统一错误码                   | 类别                   |
| ------------------------------------------------------------------------------ | ---------------------------- | ---------------------- |
| `DisconnectedError`                                                            | SERIAL_DEVICE_DISCONNECTED   | connection             |
| ENOENT / ENXIO / ENODEV / "no such file" / "not found"                         | SERIAL_NOT_FOUND             | connection             |
| EACCES / EPERM                                                                 | SERIAL_PERMISSION_DENIED     | permission             |
| EBUSY / EAGAIN / "Access denied" / "already open" / "in use" / "resource busy" | SERIAL_PORT_IN_USE           | permission             |
| canceled 标记                                                                  | SERIAL_CANCELLED             | cancellation           |
| "unsupported" / "invalid baudRate" 等                                          | SERIAL_PARAMETER_UNSUPPORTED | validation             |
| 打开未知错误                                                                   | SERIAL_OPEN_FAILED           | transport（retryable） |
| 读写未知错误                                                                   | SERIAL_ERROR                 | transport（retryable） |

## 8. 资源释放与压力记录

- 100 轮「枚举→打开→收发→关闭→再开」监听器无累积、每轮恰一次投递（Layer 1，Fake）。
- 真实 com0com 上「关闭→重开同一端口」与「端口对关闭后重开」均成功（Layer 2）。
- 探针验证「关闭后进程可退出」由用户运行 Electron 探针确认（`pnpm prototype:electron`）。
- 长时间轮询阻塞 / 100 虚拟端口枚举性能 / 1000 次短报文内存稳定等（§34.3.19）属接线后专项，
  未在本原型执行（如实标注）。

## 9. 已知限制清单

1. **原生模块 ABI**：Node 构建的绑定与 Electron/VSCode 宿主 ABI 可能不匹配，需分开重建（见
   `scripts/prototype/README.md`）。
2. **macOS/Linux 平台**、**真实 USB 设备**、**1.5 停止位 / XON-XOFF / RTS-CTS
   实际能力**：待真机与目标平台验证。
3. **打包后原生模块加载**：需改 `scripts/package-electron.mjs` 纳入 node_modules（接线阶段）。
4. 原型 `requestSerialPort` 语义为「返回首个端口」，正式接线由各端 UI picker 承担。

## 10. 结论

**可以进入正式实现**（按 §34.3.22 的 14 条通过标准）：

1. Electron/VSCode 枚举、打开、读写、关闭——✅（Node 环境经真实 com0com 验证；宿主 ABI 见限制 1）
2. macOS/Linux 目标路径处理——✅（设计层不透明路径；平台实测待验）
3. 端口占用与权限不足可区分——✅
4. 设备拔出后应用保持可操作——✅（事件模型 + Layer 1；真机待验）
5. 断开后不再发送请求——✅（传输层语义，会话层既有）
6. 重复连接无监听器/句柄泄漏——✅（100 轮 Layer 1）
7. Renderer/Webview 无法直接访问串口库——✅（安全边界由既有 ADR-016/019；接线时保持）
8. 目标 Electron/VSCode 环境打包原生模块——⚠️ 接线阶段验证（限制 1/3）
9. 不支持的参数不静默接受——✅（连接前校验 + 能力描述）
10. 底层数据稳定转 Uint8Array——✅
11. 分片响应由上层通信会话组帧——✅（传输层语义，既有会话层负责）
12. 串口错误映射为统一错误模型——✅
13. Node Serial Adapter 不含 Modbus 业务逻辑——✅（只传字节）
