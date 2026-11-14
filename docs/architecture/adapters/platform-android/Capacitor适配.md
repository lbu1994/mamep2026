# Android 传输适配

### 9.5 Capacitor 传输适配（Android，ADR-050）

Android 端不使用 Node 串口/TCP 库，而是经 Capacitor 原生插件提供字节流。

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

---


