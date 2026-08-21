# ADR-017：Electron MVP 复用 Web Serial API，后续版本替换为 Node 串口库

- 状态：已确认
- 日期：2026-08-21
- 决策来源：用户指令（MVP 版本 Electron 端使用与浏览器端一致的 Web Serial API，后续版本再替换为其他串口库）

## 背景

MVP 目标是三端运行骨架加核心调试闭环（PRD §8.2）。原规划（TECH_DESIGN §2、§9.3、ADR-016）Electron 端串口由主进程经 Node.js 串口库（Node Serial Adapter）承担，但这引入原生模块、ABI、跨平台打包与系统串口枚举等复杂度，且与浏览器端已落地的 Web Serial RTU 路径不共享实现。

Electron 渲染器即 `apps/web` 共享 UI（ADR-016），其 Chromium 运行时支持 Web Serial API，主进程可通过 `select-serial-port` 权限处理配合授权流程。MVP 阶段让 Electron 复用浏览器已落地的 Web Serial RTU 路径，能以最小成本打通桌面端 RTU 调试闭环。

## 决策

1. **MVP 版本**：Electron 端与浏览器端一致，使用 Web Serial API 连接串口——Renderer（apps/web 共享 UI）内 `navigator.serial` 走既有 `WebSerialTransport`，主进程配合 `select-serial-port` 权限处理。
2. **串口选择（2026-08-21 扩展）**：Electron 的 `select-serial-port` 不再自动选第一个端口（Electron 无系统原生选择弹窗，自动选择不符合调试工具预期），改为：主进程把端口列表经 `serial-ports-available` 事件转发给渲染进程，渲染进程用 antd Select 下拉框展示（含刷新/取消/空态），用户选择后经 `select-serial-port` invoke（新 request kind）回传，主进程 `resolvePendingSelection` 调用挂起 callback；设置 `selectPort` 策略可回到自动选择模式（测试/无人值守场景）。能力矩阵翻转为 `serialPorts: "enumerated"`。
3. **能力矩阵**：浏览器端保持 `serialPorts: "browser-picker"`（系统原生授权 picker）；Electron MVP 为 `serialPorts: "enumerated"`（应用内下拉框）；ADR-016 的 `electronSkeletonCapabilities` 在 Web Serial 路径落地后翻转 `modbusRtu` / `serialPorts`。
4. **后续版本**：替换为 Node 串口库（Node Serial Adapter，Electron 主进程承担枚举 / 连接，VSCode 端自始使用），此时 `serialPorts` 翻转为系统枚举，新增串口 request kind。
5. **边界不变**：`contextIsolation` / `sandbox` / HostMessage v1 白名单等安全边界维持；Renderer 仍不直接依赖 Node 串口库；UI 仍不直接操作 Transport。

## 备选方案

- 维持原规划（MVP 即上 Node Serial Adapter）：被否决（原生模块 / ABI / 打包复杂度高，且浏览器与桌面无法共享 RTU 路径，MVP 阶段成本过高）。
- MVP 上 Node Serial 但仅 Electron：被否决（与「三端共享同一套 UI 与核心」目标冲突，仍要处理原生模块复杂度）。

## 理由

- 浏览器侧 Web Serial RTU 已落地并验收（`?mockTransport=1` 可测），Electron MVP 复用即可获得真实串口调试能力；
- Electron Renderer 即共享 UI，`navigator.serial` 无需跨进程桥，符合「Renderer 不依赖 Node 串口库」边界；
- Node 串口库选型仍属未决事项（AGENTS §35），推迟到后续版本由原型验证（TECH_DESIGN §34.3）后再定。

## 正面影响

- Electron MVP 以最小成本获得与浏览器一致的 RTU 串口调试闭环；
- MVP 阶段 Browser 与 Electron 共享同一套串口路径、实现与测试；
- 避免 MVP 阶段引入原生模块构建 / ABI / 打包复杂度。

## 负面影响

- Electron MVP 的串口枚举依赖主进程 `select-serial-port` 转发的端口列表（Web Serial 隐私模型，无端口列表时下拉框为空态）；COM10+ 能力由 Web Serial / 系统层承担；
- 后续版本需将串口路径从 Renderer Web Serial 迁移到主进程 Node Serial Adapter（能力翻转 + request kind 调整），存在一次替换成本。

## 后续复审条件

- Web Serial 路径在 Electron 落地时：`electronSkeletonCapabilities` 翻转，E2E 覆盖串口授权与 RTU 读写；
- 下拉框选择（2026-08-21）落地时：E2E 覆盖下拉空态/取消/选择 + FC03/FC10 闭环，主进程转发与 `resolvePendingSelection` 由 `apps/electron` 单测覆盖；
- Node 串口库原型验证（TECH_DESIGN §34.3）通过并选型后：替换 Web Serial，`serialPorts` 翻转为系统枚举；
- 若 Web Serial 在 Electron 出现兼容性 / 权限问题，提前评估替换时机。
