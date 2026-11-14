# Web Serial 适配

## 1. Web Serial Adapter

职责：

1. 用户授权串口；
2. 打开和关闭端口；
3. 读取数据流；
4. 写入数据流；
5. 将浏览器错误映射为结构化错误；
6. 响应页面卸载和连接丢失；
7. 释放 Reader 和 Writer 锁；
8. 支持能力检测；
9. 处理当前浏览器不支持的串口参数。

浏览器端不能依赖传统 COM 端口字符串作为设备唯一标识。

浏览器端（BrowserPlatformHost）不实现自定义串口枚举列表，以授权 picker 替代；**Electron MVP 复用同一 Web Serial Adapter，但主进程 `select-serial-port` 不再自动选择/依赖系统 picker，而是把端口列表转发给渲染进程、由用户在 antd Select 下拉框中选择（ADR-017 扩展，`serialPorts: "enumerated"`）；后续版本替换为 Node Serial Adapter 后再由主进程系统枚举**：

- `requestPort()` 浏览器端打开系统原生设备选择器，每次打开即实时枚举系统可用设备（等同「自动枚举 + 刷新」），用户取消返回 null；Electron 端则触发主进程 `select-serial-port`（列表经事件转发，选择经 invoke 回传）；
- `getPorts()` 只返回已授权端口，无法枚举未授权设备（Web Serial 隐私模型）；当前实现已声明该类型但从未调用；
- 因此浏览器端无串口列表/刷新按钮/`listSerialPorts` 能力，能力矩阵声明为 `serialPorts: "browser-picker"`；Electron 端为 `serialPorts: "enumerated"`（下拉框 + 刷新 + 取消/空态）。

**Electron 串口获取机制（ADR-017 扩展，2026-08-22 真机验证）**——完整链路如下：

1. **用户手势触发枚举**：`navigator.serial.requestPort()` 必须在用户手势中调用（下拉框 `onOpenChange` / 点击刷新按钮），否则抛 `SecurityError: Must be handling a user gesture`（在弹窗打开 / effect 里自动枚举会被吞掉，下拉框恒空）。下拉框仅注册事件、不在 `afterOpenChange` 自动枚举。
2. **主进程拦截选择**：`requestPort()` 触发 session 的 `select-serial-port` 事件，主进程 `event.preventDefault()` 后默认「延迟选择」——把 `portList`（含 `portId`/`portName`/`displayName`）经 `serial-ports-available` 事件转发给渲染进程，挂起 callback 等待用户选择；设置 `selectPort` 策略则自动选择（测试/无人值守）。
3. **权限放行**：`setPermissionCheckHandler` / `setDevicePermissionHandler` 仅对本应用 origin 放行 `serial`。**origin 必须归一化（`normalizeOrigin`）**：dev 下 `details.securityOrigin` 报告为 `http://localhost:5173/`（尾斜杠），而 allowlist 由 `new URL().origin` 生成（无斜杠），精确匹配会失败 → 设备被拒 → `requestPort` reject `NotFoundError: No port selected by the user`（"刷不出来串口"的根因）。`normalizeOrigin` 对 http(s) 用 `new URL(origin).origin` 归一化，`file://` 原样保留（URL API 会把它归一化成 `"null"`）。
4. **下拉框展示**：渲染进程 `ElectronAppHost` 把事件转成的 `SerialPortOption[]`（label 优先级 `portName → displayName → portId`）喂给 antd Select；空列表显示 "No serial ports found" + 刷新按钮。
5. **回传选择**：用户选中 → `select-serial-port` invoke（HostMessage v1，payload `{portId}`，空串 = 取消）→ 主进程 `resolvePendingSelection` 调用挂起 callback → `requestPort()` settle → 渲染进程拿到 `SerialPort` 构建 `WebSerialHandle`；用户取消 → callback("") → `requestPort` reject `NotFoundError` → 视为 ok(null)。
6. **幂等/清理**：重枚举前先取消旧挂起会话（`cancelPendingPicker`，调 `selectSerialPort("")` 并吞掉 rejection），避免多个 `requestPort` 同时挂起。

> 经验：fake `navigator.serial` 的 e2e 走不到真实权限/手势路径，单测/e2e 全绿 ≠ 真机可用；串口权限类问题必须真机验证（详见仓库 memory `electron-serial-debug-2026-08-22`）。

浏览器持久化时只保存：

- 非设备标识类通信参数；
- 可选的最近设备显示信息；
- 不保存可用于自动重连的授权假设。


## 2. Web Serial 原型

验证：

- 串口授权；
- 打开和关闭；
- 参数支持；
- 读取分片；
- 页面刷新；
- 设备拔出；
- 浏览器不支持提示；
- 后台标签页行为。


