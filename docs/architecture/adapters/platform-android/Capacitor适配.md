# Android 传输适配

## 1. Capacitor 传输适配（Android，ADR-050）

Android 端不使用 Node 串口/TCP 库，而是经 Capacitor 原生插件提供字节流。

原生插件保留在 `apps/android` 内部，由 `packages/platform-android` 提供 JS 侧封装；
不创建独立的 Capacitor 插件包。该边界避免 pnpm 符号链接和 Capacitor 插件自动发现带来的
构建耦合，同时仍由能力矩阵和 Host 隔离平台差异。

职责：

1. 打开/关闭 USB 串口（USB Host + `USB_PERMISSION` 授权）与 TCP socket；
2. 字节写入（base64 经桥传递）；
3. 原生侧**整帧聚合**后单次投递入站字节（避免分片事件风暴）；
4. 设备拔出 / socket 断开 / 权限拒绝的结构化错误映射；
5. 枚举可用的 USB 串口设备（`serialPorts: "enumerated"`）；
6. 不实现 Modbus 帧语义、不实现超时重试与调度。

桥契约采用与 HostMessage v1 相同的安全姿态：版本化信封 + Zod 校验 + 方法白名单（`packages/platform-android/src/bridge-contract.ts`）。

> 风险与退路：默认 `requestTimeoutMs: 50`（超时从 `transport.write()` resolve 后开始）对桥接型传输偏紧，
> Phase 0 spike 实测桥往返延迟；若不足，先在该平台 composition root 覆盖超时/重试（不改全局 `defaultConfig`），
> 退路为将**帧解析**下沉原生（`exchange(bytes) → bytes`，JS 侧合成 TransportPort 事件），因接缝在 TransportPort，上层零改动。

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


