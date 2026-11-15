# Android 传输适配

## 1. Capacitor 传输适配（Android，ADR-050）

Android 端不使用 Node 串口/TCP 库，而是经 Capacitor 原生插件提供字节流。

Android 是独立的第四平台，不是浏览器能力矩阵的变体。它拥有独立
`androidCapabilities`、`--mode android` 构建产物和 `AndroidAppHost`。浏览器
直接 Modbus TCP 仍为不支持；Android TCP 由原生 socket 适配器提供。

Capacitor 使用安全 WebView 上下文，Web 资源目录指向 Android 专用构建产物。
应用标识为 `com.mamep2026.app`、名称为 `Mamep2026`；修改应用标识会影响升级、
签名、数据目录和发布渠道，必须作为独立迁移决策处理。

Modbus 会话留在 WebView 的共享 JS 层，复用 `RtuSessionHost` /
`TcpSessionHost`、调度器、分帧、超时、重试和日志。原生层只搬运字节、管理
socket/USB 生命周期和权限，不得实现功能码、CRC、调度或 Modbus 业务规则。
因此接缝保持在 `TransportPort` 字节流，而不是 `readHoldingRegisters` 一类
功能码方法。

原生插件保留在 `apps/android` 内部，由 `packages/platform-android` 提供 JS 侧封装；
不创建独立的 Capacitor 插件包。该边界避免 pnpm 符号链接和 Capacitor 插件自动发现带来的
构建耦合，同时仍由能力矩阵和 Host 隔离平台差异。

职责：

1. 打开/关闭 USB 串口（USB Host + `USB_PERMISSION` 授权）与 TCP socket；
2. 字节写入（base64 经桥传递）；
3. 原生侧按短暂空闲窗口聚合入站字节，避免每个分片单独触发事件；
4. 设备拔出 / socket 断开 / 权限拒绝的结构化错误映射；
5. 枚举可用的 USB 串口设备（`serialPorts: "enumerated"`）；
6. 不实现 Modbus 帧语义、不实现超时重试与调度。

当前传输矩阵：

| 传输 | 原生承载 | 共享层职责 |
| --- | --- | --- |
| Modbus TCP | `java.net.Socket` + 原生读取线程 | MBAP、事务关联、请求调度、超时重试 |
| USB-RS485 | `usb-serial-for-android` + USB Host 权限 | RTU 组帧、CRC、响应校验与调度 |

BLE UART 与经典蓝牙 SPP 不属于当前已交付传输。BLE 需要在连接 profile 中增加
设备地址、服务/GATT 特征等持久字段并单独迁移；经典 SPP 需要新的原生适配。
两者都必须继续以字节流接入同一 `TransportPort`，不得在蓝牙侧复制 Modbus
业务。

USB 串口支持设备枚举、连接时请求权限、参数透传和 detach 错误映射。驱动不支持
的流控或链路参数必须在打开前拒绝，不得静默忽略。设备拔出转换为结构化断开错误，
不自动重连。原生入站数据先按空闲窗口聚合成较完整的帧片段，再以 base64 通过桥
传递；读线程和权限请求必须由关闭路径释放。

桥契约采用与 HostMessage v1 相同的安全姿态：版本化信封 + Zod 校验 + 方法白名单（`packages/platform-android/src/bridge-contract.ts`）。

超时从 `transport.write()` resolve 后开始计时，Capacitor 桥的往返延迟也计入预算。
Android composition root 因而使用 300 ms / 2 次的本平台默认值，不修改全局
`defaultConfig`。若未来桥接开销仍不足，退路是将**帧解析**下沉为
`exchange(bytes) → bytes`，在 JS 侧合成 `TransportPort` 事件；因接缝保持在
字节流，上层会话、调度和协议语义无需改写。

## 2. 桥性能与正式实现结论

真机测量结果（vivo V2303A / Android 16 / WebView 151，200 次采样）：

- 纯桥 ping p50 约 1.1 ms、p99 约 1.5 ms；
- 原生向 JS 投递数据 p50 约 0.9 ms、p99 约 1.9 ms；
- 写入完成到收到字节 p50 约 2.0 ms、p99 约 3.3 ms；
- 相对默认请求超时只占很小比例，Capacitor 桥不是通信瓶颈。

因此帧解析、Modbus 语义、超时、重试和调度继续留在共享 JS 层，不因平台差异复制协议实现。

USB-RS485 使用 `usb-serial-for-android` 3.11.0：

- 通过 USB Host 权限打开设备；
- 支持端口枚举、读写、流控和错误映射；
- 读侧由 `SerialInputOutputManager` 配合空闲窗口聚合；
- 不支持的参数在发送前拒绝；
- 设备拔出、权限拒绝和端口占用转换为结构化错误。

Android 构建固定 JDK 17/21 与对应 Gradle；调试和发布构建都先构建插件产物并执行 Capacitor sync。

---

---


