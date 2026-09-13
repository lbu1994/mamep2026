# ADR-050：Android 端接入与 Capacitor 方案（第四平台）

- 日期：2026-09-10
- 状态：**Phase 0/1/2 已落地；Phase 3 落地（移动布局 + 后台挂起/恢复 + KeepAwake + 工具栏溢出 + 返回键）**（余项：真机 e2e 执行、长按行菜单真机确认、平板横屏，见 §14.4）
- 关联：PRD §2.1 / §5.1 / §7（新增 §7.5）/ §8.2、TECH_DESIGN §7（能力矩阵新增 Android 列）/ §9.1 / §9.5 / §5.1.6、
  ADR-013（monorepo 分层）、ADR-022（两端 TCP 接线）、ADR-024（真实端口 e2e）、ADR-036（文件持久化）、
  ADR-044（可执行插件隔离）、ADR-045（随包插件一次性安装）、ADR-046（浏览器兼容性检测）、ADR-049（关闭 flush / 恢复）

## 背景

用户提出追加 Android 端，并要求「Shared Core + 各端只新增平台适配层」，而非为 Android 重写一套业务逻辑。

现状盘点（2026-09-10）：仓库已是 monorepo 三层结构，共享层与平台层的切分**已经就位**，Android 端不需要架构改造：

| 接缝 | 位置 | Android 是否够用 |
| --- | --- | --- |
| `PlatformHost`（能力矩阵 + 打开传输 + Clock） | `packages/platform-api/src/host.ts` | 够用 |
| `TransportPort`（open / write / onData / close，字节流） | `packages/communication/src/transport-port.ts` | 够用（已支持 `web-serial` / `node-serial` / `node-tcp` / `mock` / `fake`） |
| `AppHost`（UI 只经它访问业务能力） | `packages/ui/src/host.ts` | 够用（需扩 `platform` 联合类型） |

Electron 与 VSCode 即「同一份 React UI + 平台 Host」的两个实现（`apps/web/src/electron-app-host.ts`、`apps/web/src/vscode-app-host.ts`）。
因此 **Android 是第四个 Host 实现**，复用面为：`domain`、`protocol-modbus`、`data-conversion`、`communication`、
`application`（`RtuSessionHost`/`TcpSessionHost`）、`register-table`（含 trace）、`workspace`、`logging`、`plugin-api`、`ui-theme` 100%；
`ui` 组件 ~90%（布局与触摸交互需适配）；`platform-web` 部分复用（`MockTransport`、IndexedDB 仓储/插件存储、Web Worker 插件运行时、兼容性检测）；
`platform-node` 不可复用（Node serial/tcp 在 Android 不可用）。

### 对用户提案的修正（本 ADR 依据）

1. **包名不符**：提案中的 `packages/core` / `adapters` / `trace` / `@mamep/platform-tcp` 均不存在，现有分层更细且等价
   （`application` = 提案的 core）。按提案改名属无关大规模移动，违反 docs/AGENTS.md §7「不得为了匹配示意结构进行大规模移动」。
2. **TCP 不是复用而是新增**：TCP 传输实现位于 `packages/platform-node`（依赖 Node `net`），Android WebView 内不可用，需原生插件。
3. **接缝层级**：提案的 `ModbusTransport{readHoldingRegisters}` 把接缝切在功能码层，会导致协议栈与调度层（`RequestScheduler` /
   `BatchReadCoordinator` / `PollingCoordinator` / `WriteVerifyCoordinator` / Trace）失去复用。**改用 `TransportPort` 字节流接缝**。
4. **插件不必刻意阉割**：`plugins/*` 随包插件随同一份 web 包编译；ADR-044 的隔离运行时即 `platform-web` 的 Web Worker 实现，Android WebView 同样可跑。
5. **"UI 组件 80~90% 复用"偏乐观、"平台层 10~20%"偏低估**：仓库 `index.css` 无任何 media query、`MamepApp` 为写死的三区布局；
   行右键菜单（`contextmenu`）、sheet 双击重命名、hover Tooltip 在触摸屏不成立，属实打实工作量。

## 方案

### 1. 平台定位与红线澄清

Android 为**第四平台**（独立 `AppHost` + 独立能力矩阵 + 独立 `--mode android` 产物），不是「浏览器端的变体」：

- PRD §7.2「浏览器端明确不支持 Modbus TCP」**不变**——Android 的 TCP 由原生 socket 插件提供，不得因此翻转 `browserCapabilities.modbusTcp`；
- docs/AGENTS.md §8.3「UI 不直接访问串口/文件系统」**不变**——Capacitor 插件调用只允许出现在 `packages/platform-android` 与 `apps/android`，
  严禁出现在 `packages/ui`；
- docs/AGENTS.md §12.1「所有设备请求进入统一调度器」**不变**——会话留在 JS，调度器链路零改动。

### 2. 容器与构建产物

- 容器：**Capacitor**（Android WebView + 原生插件）。`apps/android/` 为 Capacitor 工程，`capacitor.config.ts` 的 `webDir`
  指向 `apps/web/dist-android`，`server.androidScheme: "https"`（Capacitor 默认）→ 页面处于安全上下文。
- 构建：`apps/web` 新增 `--mode android`（`base: "./"`、`outDir: apps/web/dist-android`、复用 `buildWebCsp()`），与 electron / vscode 模式对称。
- **工具链要求（必读）**：Capacitor 8 模板固定 **Gradle 8.14.3 + AGP 8.13.0**，其最高只支持 **Java 24**；
  Android Studio 自带的 JBR 25 会直接报 `Unsupported class file major version 69`（Java 25 需 Gradle ≥9.1，
  而官方测试矩阵中 AGP 8.x 只配 Gradle 8.x）。因此**构建必须用 JDK 17–21**：
  Android Studio 内需把 Settings → Build Tools → Gradle → Gradle JDK 指到 17/21；命令行构建由
  `scripts/build-android.mjs` 依次探测 `JAVA_HOME` / Android Studio JBR（仅当版本 ≤24）/ 固定用户目录下的便携 JDK 21，
  均不可用时给出明确报错与安装指引（不静默降级）。
- 应用标识：`appId = "com.mamep2026.app"`、`appName = "Mamep2026"`、版本号取根 `package.json`（`__APP_VERSION__`）。
- dev 迭代：`server.url` 指向局域网 Vite（`cleartext: true`，仅 dev）。

否决的替代路线：React Native（antd 不可用，UI 复用归零）、Kotlin 全原生（业务重写，成本最高）、KMP 共享核心（同上前提下仍需重写 UI）、
纯 Chrome + WebUSB（无 BLE / 无原生文件对话框 / 依赖浏览器与手动录 URL，且 Android WebView 不支持 WebUSB，无法打包成应用）。

### 3. 分层落位（新增，不改动共享包）

```
packages/platform-android/          # TS 纯逻辑，注入 fake 桥可单测（沿用 platform-node 的 SerialPortLike 先例）
  ├─ android-capabilities.ts        # androidCapabilities（如实声明）
  ├─ bridge-contract.ts             # 桥调用/回包 Zod 校验 + 方法白名单（对齐 HostMessage v1 安全姿态）
  ├─ error-mapping.ts               # 原生错误码 → 既有项目错误码（复用 platform-node 命名与 errors.* i18n key）
  ├─ detect-android.ts              # isAndroidPlatform(global)：把 Capacitor 知识限制在本包
  ├─ capacitor-tcp-transport.ts     # Modbus TCP（Phase 1）
  ├─ capacitor-serial-transport.ts  # USB-RS485（Phase 2，暂不建）
  └─ android-platform-host.ts       # implements PlatformHost

apps/android/                       # Capacitor 工程（capacitor.config.ts + Gradle 工程 + 权限 + MainActivity.registerPlugin）
  └─ android/app/src/main/java/com/mamep2026/app/MamepTransportPlugin.kt
                                    # 【Phase 1 决策】原生插件放 app 内，不建独立 packages/capacitor-modbus-transport：
                                    #   避开 pnpm 符号链接 + Capacitor 插件自动发现的摩擦点；
                                    #   Phase 0 spike 已验证「app 内插件 + MainActivity 手动 registerPlugin」可行。
                                    #   将来需要跨 app 复用/发布时再抽为独立插件包。
apps/web/src/android-app-host.ts    # 第四个 AppHost（【Phase 1 决策】本地混合宿主：通用能力委托 BrowserAppHost
                                    #   （AndroidPlatformHost + IndexedDB 仓储/插件存储 + 随包插件），TCP 走本地
                                    #   TcpSessionHost + CapacitorTcpTransport，按 activeProtocol 路由；
                                    #   与 ElectronAppHost 同构，但不改 BrowserAppHost，三端行为零改动）
```

### 4. 会话承载位置：留在 WebView（JS）

VSCode 之所以把通信下沉 Extension Host，是因为 Webview 的 `navigator.serial` 被权限策略拒绝；**Android 无此约束**。
因此 Android 会话在 WebView 内复用 `RtuSessionHost` / `TcpSessionHost`，原生只做字节搬运。
**不采用**「原生实现 Modbus 会话」路线（等于用 Kotlin 重写调度器与协调器）。

### 5. 传输矩阵与桥语义

首期（Phase 1–2，用户已确认）：

| 传输 | 实现 | 自动化程度 |
| --- | --- | --- |
| Modbus TCP | 自研最小 Kotlin 插件（`java.net.Socket` + 读线程 + `notifyListeners`），零第三方依赖 | 全自动 e2e（`adb reverse`） |
| USB-RS485 | 自研插件，底层 `usb-serial-for-android`（CH340/341A、CP210x、FTDI、PL2303、CDC-ACM 如 CH343/CH9102）；USB Host + `USB_PERMISSION` 运行时授权 + detach 事件（**Phase 2 已落地**） | 真机半自动（无硬件时自动跳过） |

后续（Phase 4，另行确认）：BLE UART（`@capacitor-community/bluetooth-le` 在 JS 侧实现，零原生代码；`writeWithoutResponse` +
`startNotifications` + `requestConnectionPriority`）、经典蓝牙 SPP（HC-05 类，需自研 Kotlin）。

桥语义约定：

- 原生侧只暴露「打开 / 写字节 / 来字节 / 关闭」；帧编码、CRC、TCP 分帧、超时重试全部留在 JS；
- 字节以 **base64 字符串**传递（Capacitor `JSObject` 为 JSON 语义）；
- **原生侧整帧聚合后单次投递**（按空闲时间聚合），避免分片事件风暴；
- `TransportPort.kind` 扩展 `"capacitor-usb"` / `"capacitor-tcp"`。

**Android 默认连接参数覆盖（Phase 1 决策）**：spike 实测显示桥开销仅占 50 ms 预算的 4–7%，但**默认 50 ms 本身余量很小**
（对端人为延迟 30 ms 时总耗时已～47 ms）；故 Android 端在 composition root 创建/回填 profile 时**覆盖为
`requestTimeoutMs = 300` / `retryCount = 2`**，**不修改全局 `defaultConfig`**（避免影响三端），且用户仍可在连接设置中修改。

### 6. 能力矩阵与 Host 契约

新增 `androidCapabilities`。**Phase 1 如实声明**（不得声明未实现的能力）：

| 能力位 | 值（Phase 1 → Phase 2） | 说明 |
| --- | --- | --- |
| `modbusRtu` | `false` → **`true`** | Phase 2（2026-09-10）已实现 USB-RS485，遂如实翻转 |
| `serialPorts` | `"unsupported"` → **`"enumerated"`** | USB Host 枚举 + 下拉选择（无 Web Serial 手势约束） |
| `modbusTcp` | `true` | 原生 socket 插件 |
| `filesystem` | `"limited"` | IndexedDB 直接可用（WebView 支持） |
| `nodePlugins` / `hostPlugins` | `false` | Android 无 Node 侧插件执行面 |
| `webPlugins` | `true` | 插件同步贡献（codec / dataType / transform）可用 |
| `executablePlugins` | **运行时探测**（Phase 5，ADR-056） | 静态基线 `false`（**fail-closed**）：装配期由 `probePluginExecutionSupport()` 实测「Blob Worker + Worker 内 blob entry 动态 import」，再经 `resolveAndroidCapabilities({ blobWorkerSupported })` 覆盖（真机 WebView 151 实测可用 → `true`） |
| `pluginInstall` | **`"upload"`**（Phase 5，ADR-056） | WebView `<input type="file">` + 客户端读文件文本（Capacitor `BridgeWebChromeClient.onShowFileChooser` 已实现），无需 Capacitor Filesystem |
| `logExport` / `workspaceImport` / `workspaceExport` | Phase 1 声明 `"unsupported"` | Phase 4 接 Capacitor Filesystem + 系统分享/SAF 后按实翻转 |

同时：`packages/ui/src/host.ts` 的 `AppHost.platform` 联合类型新增 `"android"`；i18n 增侧边栏 footer 文案；
`browserCompatibility` 返回 `null`（Android 不用 Web Serial 兼容性提示，避免误弹「浏览器不支持 Web Serial」横幅）。

### 7. UI 适配（平板横屏优先 + 手机竖屏可用）

- ≥1024px：保持现有三区布局（Sider + 寄存器表 + BottomPanel）；
- <1024px：Sider → `Drawer`，BottomPanel → Bottom Sheet，表格横向滚动 + 固定前两列，工具栏溢出到下拉；
- 触摸交互：触摸目标 ≥48dp；长按替代行右键菜单（WebView 长按默认触发选择/放大镜，需处理）；双击重命名改长按/编辑按钮；
  hover Tooltip 改点击；`safe-area-inset` 避让；软键盘 `visualViewport` 弹层避让。
- **不做**：Floating Read All、TM Trace 折线图（属产品新增需求，需单独确认；现追踪窗为表格 + 自动重排的成熟行为）。

### 8. 移动端生命周期

返回键映射（先关 Drawer/弹窗，否则最小化而非退出）、`appStateChange` 进后台暂停轮询/Trace 并调用 `flush()`（复用 ADR-049 通道）、
`android:configChanges` 防旋转重建断连、长时轮询可选 KeepAwake。

### 9. 测试策略

- **单测**：`packages/platform-android` 注入 fake 桥（沿用 `SerialPortLike` 注入先例），覆盖 profile → open 选项映射、错误映射、
  分片聚合、桥契约校验、能力矩阵声明；
- **设备级 e2e**：`tests/e2e-android/` 用 Playwright `chromium.connectOverCDP` 接 `adb forward` 的 WebView devtools socket，
  驱动**真实 UI + 真实原生插件**（**已实测可行**：拿到桥页面并读取 DOM / 截图，见验证记录 §2.4）；
  TCP 经 `adb reverse tcp:1502` 直连 ADR-024 的 `modbus-tcp-slave.mjs`（**可全自动真实闭环**）；
  USB 用真机 + 物理 USB-RS485 半自动，断言通信日志帧；
  注意：本机 vivo 设备 `adb logcat` 无输出（OEM 限制），故**断言与诊断须走 CDP，不得依赖 logcat**；应用重启后 devtools socket 名变化，需重新解析并重建 forward；
  另：Capacitor debug 构建会把每次插件调用 marshal 到 console，测量类用例应避免在过程中附着 CDP；
- **无硬件冒烟**：`?mockTransport=1`（`platform-web` 的 `MockTransport` 直接可用）+ 模拟器；
- **原生插件单测**：Gradle + JUnit/Robolectric；
- `scripts/e2e-real.mjs` 增 `android` 目标。

### 10. 已识别风险与退路

1. **桥延迟 vs 默认 50ms 请求超时（已 spike 实测，结论：桥不是瓶颈）**
   `defaultConfig.rtu.requestTimeoutMs = 50`、`retryCount = 1`，且 `session.ts` 的超时**从 `transport.write()` resolve 之后才开始计时**，
   「原生回包 → `notifyListeners` → WebView 主线程 → JS `onData`」的投递延迟**计入该 50ms 预算**。
   **实测（2026-09-10，vivo V2303A / Android 16 / WebView 151，Capacitor 8.5.1，TCP + `adb reverse`，200 次采样）**：
   桥固定开销 `write→data` **p50 2.0 ms / p99 3.3 ms**（纯桥调用往返 p50 1.1 ms、原生 `socket.write` 0.07 ms），
   仅占 50 ms 预算的 4–7%（详见 [docs/adr-050-验证记录.md](../adr-050-验证记录.md) §2）。
   **结论**：接缝留在 `TransportPort` 字节流即可，**不需要**把帧解析下沉原生。
   仍需注意：默认 50 ms 本身余量小（对端人为延迟 30 ms 时总耗时已达 ~47 ms p50），
   Android 端建议评估在 composition root 覆盖默认超时/重试（**不改全局 `defaultConfig`**）。
   **退路**（保留但未动用）：将帧解析下沉原生（`exchange(bytes) → bytes`，JS 侧以 promise 队列合成 `TransportPort` 事件）——
   因接缝在 `TransportPort`，该退路上层零改动。
2. **生产构建 CSP 缺 `worker-src`（本 ADR 附带修复，已实测确认）**：`apps/web/vite.config.ts` 注入的 CSP 原为 `script-src 'self'` 且无 `worker-src`，
   而 `platform-web/src/plugin-remote-runtime.ts` 以 `new Worker(blobUrl)` 执行插件 → `worker-src` 回退到 `script-src`，`blob:` 不匹配 `'self'`。
   **实测结论（2026-09-10，系统 Edge + `apps/web/dist` 经 http 加载）**：修复前 `worker-error` 并报
   `Creating a worker from 'blob:…' violates the following Content Security Policy directive: "script-src 'self'". Note that 'worker-src' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.`；
   补 `worker-src 'self' blob:` 后 Blob Worker 正常工作（`ok:pong`）。即**打包产物（浏览器 / Electron / VSCode，以及之后的 Android）下可执行插件此前不可用**，dev 不注入 CSP 故既有 e2e 未暴露。
   修复：CSP 抽为 `apps/web/src/csp.ts`（`buildWebCsp()`）与 `apps/vscode-extension/src/webview/prod-csp.ts`（`buildWebviewCsp()`），
   均加 `worker-src 'self' blob:`，并各配单测回归保护。**遗留待办**：仍缺「生产构建产物 + 插件执行」的 e2e（现仅单测守住 CSP 字符串）。
3. **工业平板 WebView 版本**：antd v6 输出含 `:where()`（Chromium 88+）、React 19、module worker / dynamic import。
   需设最低版本门控 + 启动提示（复用 `BrowserCompatibilityBanner` 模型）。
4. **USB Host 兼容性**：OTG 供电能力、CH340 变种、部分设备无 Host 模式 → 需失败提示与设备提示文案。
5. **后台计时器不可靠**：Android 后台会限制 WebView 定时器 → 必须显式暂停/恢复（见方案 8）。
6. **工作区模型**：首期 TCP/USB 复用现有 `RtuConnectionProfile` / `TcpConnectionProfile`，**无 schema 变更**；
   蓝牙需「传输类型 + 设备地址 + GATT UUID」→ Phase 4 时 schema v8 → v9 迁移（届时另行确认）。

### 11. Phase 1 实施中发现并修复的集成问题（2026-09-10）

1. **连接设置弹窗在「仅支持一种协议」平台上选错协议**（`packages/ui/src/components/ConnectionSettingsModal.tsx`）：
   原先隐藏协议分组时用「存储 profile 或默认 RTU」的默认值，Android（仅 TCP）会得到 `protocol:"rtu"`，
   于是展示串口表单并尝试连接未实现的串口。修复：引入 `onlySupportedProtocol`，若平台只支持一种协议，
   默认表单值改用该协议的 base profile（`tcpBase`），`useWatch` 回退值同步。
2. **串口缺失会错误禁用 TCP 的 CONNECT**：`serialBlocked` 原为「无 Web Serial 且非 enumerated」即成立，
   Android 上的 TCP 入口会被连带禁用并弹出「不支持 Web Serial」提示。修复：该门控**仅对 `protocol === "rtu"` 生效**。
3. **`TransportPort.kind` 扩展** `"capacitor-tcp"` / `"capacitor-usb"`（预留）——这是共享层的唯一必要改动。
4. **测试基建**：Android 生成目录（Gradle `build/`、Capacitor 拷贝的 web 资源、Cordova shim）
   加入 `eslint.config.js` 的 `globalIgnores`（ESLint 不读 `.gitignore`）。
5. **不需要改动的部分（已验证）**：`packages/{domain,protocol-modbus,data-conversion,communication,application,register-table,workspace,logging,plugin-api,ui,ui-theme}`
   在 Android 路径上**零修改**；HostMessage v1 无新增 kind（Android 不跨进程，无 RPC 边界）；工作区 schema 不变。

### 12. Phase 1 实际落点（文件清单）

```
packages/platform-android/                 # 新包：Android 平台适配层
├─ src/capabilities.ts                     # androidCapabilities（modbusRtu:false / serialPorts:"unsupported" / modbusTcp:true）
├─ src/bridge-contract.ts                  # 版本化方法白名单 + Zod 校验 + base64 编解码
├─ src/capacitor-tcp-transport.ts          # CapacitorTcpTransport（kind:"capacitor-tcp"）
├─ src/android-platform-host.ts            # AndroidPlatformHost（serial → 能力错误）
├─ src/android-defaults.ts                 # applyAndroidTcpDefaults（300ms / 2 次）
├─ src/capacitor-bridge.ts                 # 子路径导出 @mamep2026/platform-android/capacitor
└─ src/testing/fake-transport-bridge.ts    # 注入式 fake 桥（单测）
apps/web/src/android-app-host.ts           # AndroidAppHost（本地混合宿主）
apps/web/src/csp.ts                        # buildWebCsp()（含 worker-src 'self' blob:）
apps/android/                              # Capacitor 工程（含 app 内原生插件，详见 apps/android/README.md）
scripts/build-android.mjs                  # JDK/SDK 探测 + web → cap sync → assembleDebug
tests/e2e-android/                         # 真机 e2e（Playwright connectOverCDP + adb 辅助，pnpm test:e2e:android）
```

### 13. Phase 2（USB-RS485）实际落点与实施结论（2026-09-10）

#### 13.1 用户决策（2026-09-10）

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 无 USB-RS485 硬件时的验收 | **只做实现 + 单测 + e2e 预置**（硬件读写闭环用例门控 `MAMEP_ANDROID_USB_SERIAL=1` 自动跳过）；真机 UI 面 e2e 无需硬件即可跑 |
| 2 | 依赖 | **采用 `com.github.mik3y:usb-serial-for-android:3.11.0`（MIT，JitPack）**；**不得退回自研 CDC-ACM**（若 JitPack 解析失败则停下来报告） |
| 3 | 权限体验 | 连接时无权限则请求，拒绝即报错；不做自动重试 |
| 4 | 端口标识 | `handle.id = UsbDevice.deviceName`，label 展示驱动名 + VID:PID；`recentPortHint` 仅提示、不自动连接（维持 §19.3） |
| 5 | 链路参数 | 直接透传 `baudRate/dataBits/stopBits/parity/flowControl`；驱动不支持流控 → **如实报参数错误，不静默忽略** |
| 6 | 读回聚合 | USB 用 **10ms 空闲窗口**聚合（TCP 维持 `available()` 立即吸收） |
| 7 | detach | 拔线 → `closed(USB_DETACHED)` → 会话 failed + 提示；**不做 USB 自动重连** |
| 8 | 能力位翻转时机 | **先实现即翻转**（`modbusRtu:true` / `serialPorts:"enumerated"`），真机 USB 验证由用户后续自行完成 |
| 9 | 原生单测 | 本期不做（Robolectric 对 `UsbManager` 支持有限）；以 TS fake 桥单测 + 真机 e2e 覆盖 |
| 10 | 插件形态 | 沿用 `MamepTransportPlugin` 新增方法（不另建插件） |

#### 13.2 实现落点（新增/修改文件）

```
packages/platform-android/src/
├─ bridge-contract.ts               # 白名单 +listSerialPorts/openSerial；新增 3 个 schema
├─ bridge.ts                        # MamepTransportBridge +listSerialPorts/openSerial
├─ capacitor-usb-serial-transport.ts# CapacitorUsbSerialTransport（kind:"capacitor-usb"）
├─ serial-parameters.ts             # validateSerialParameters + 支持波特率集合
├─ error-mapping.ts                 # USB_* 错误码 → 既有 errors.serial* 文案（+ USB 上下文兜底）
├─ android-platform-host.ts         # listSerialPorts / selectSerialPort / requestSerialPort / openSerialTransport（真实实现）
├─ android-capabilities.ts          # modbusRtu:true / serialPorts:"enumerated"
├─ capacitor-bridge.ts              # 插件句柄 +listSerialPorts/openSerial
└─ testing/fake-transport-bridge.ts # fake 支持串口枚举/打开与错误注入
apps/web/src/android-app-host.ts    # enumerate/select 委托宿主 + portLabel 覆盖（与 ElectronAppHost 同因）
apps/android/.../MamepTransportPlugin.kt  # listSerialPorts / openSerial / USB 读线程聚合 / 权限 / detach
apps/android/android/{build.gradle,variables.gradle,app/build.gradle,AndroidManifest.xml}
tests/e2e-android/helpers/{adb.ts,app.ts}、tests/{rtu-ui,rtu-loop}.spec.ts
packages/ui/src/i18n/index.ts       # +errors.serialDriverUnsupported（其余复用既有串口文案）
```

#### 13.3 库事实（必须先查证再用）

`usb-serial-for-android` 3.11.0 的真实 API 与早期版本不同，**按实际签名实现**（用 `javap` 核对 AAR 得到）：

- `UsbSerialPort.setFlowControl(FlowControl)` 接受**枚举** `NONE/RTS_CTS/DTR_DSR/XON_XOFF/XON_XOFF_INLINE`；
  `getSupportedFlowControl()` 返回 `EnumSet<FlowControl>` → 可**预检**而非靠异常探测（符合 §8.4）；
- `write(byte[], int timeout)` / `write(byte[], int, int, int)` 返回 **void**（阻塞至写完或超时），无需应用层循环；
- `PARITY_NONE/ODD/EVEN`、`STOPBITS_1/2`、`DATABITS_*` 仍为 int 常量；
- 读侧用 `SerialInputOutputManager(port, listener)`（自带线程）+ `onNewData/onRunError`，再叠 10ms 空闲聚合。

#### 13.4 实施中发现的真实问题（已修复）

1. **vivo ROM 静默拒绝流式安装**（本机 V2303A / Android 16）：`adb install -r` 报
   `INSTALL_FAILED_ABORTED: User rejected permissions` 且**手机无任何弹窗**；改 `adb install -r --no-streaming`
   （push 安装）即成功。`tests/e2e-android/helpers/adb.ts` 已改为**先非流式、失败再回退流式**，并把该现象写入错误指引。
2. **e2e 辅助不认默认 SDK 路径**：`adbBinary()` 原仅看 `ANDROID_HOME/ANDROID_SDK_ROOT`，无环境变量时
   `spawnSync adb ENOENT`；已改为与 `scripts/build-android.mjs` 同策略探测（含 `%LOCALAPPDATA%\Android\Sdk`）。
3. **能力位翻转使既有 Android e2e 断言过时**：`tcp-loop.spec.ts` 原断言「弹窗不含 Modbus RTU」（Phase 1 只有 TCP），
   翻转后协议分组出现 → 改为「协议分组含 Modbus TCP 并显式切到 TCP」后继续。
4. **错误映射重构时丢过 TCP 分支**（`connectFailed/openFailed`）：由既有单测立即捕获（`TCP_CONNECTION_FAILED` 变
   `TCP_OPEN_FAILED`）并修回——说明“改映射必须回归既有断言”。
5. **e2e 定位细节**：antd `Select` 非 search 态 placeholder 不在 `input` 上（渲染为 span），故按 Form.Item 标签
   `filter({ hasText: "Port" })` 定位；RTU 表单实际文案是 `Port / Speed / Data Length / Stop Bit / Parity Bit / Flow Control`。

#### 13.5 验收（本次）

| 项 | 结果 |
| --- | --- |
| 单测 | `pnpm test` **28/28 tasks**（`platform-android` 47→78、`apps/web` 99→100、`ui` 345+） |
| 类型检查 / Lint | `pnpm typecheck` 32/32、`pnpm lint` EXIT=0 |
| APK 构建 | `pnpm build:android` 成功（含 JitPack 依赖解析与 Kotlin 编译；增量 ~3s） |
| 真机 e2e | `pnpm test:e2e:android` **5 passed / 2 skipped**：`rtu-ui` 3 个（协议分组 + RTU 表单齐全 + 串口下拉可打开 + 无 console 错误）、`tcp-loop` 2 个（Phase 1 闭环无回归）；`rtu-loop` 2 个按预期跳过（需硬件） |
| **未完成** | **USB-RS485 读写闭环真机验证**（用户无硬件，硬件到位后设 `MAMEP_ANDROID_USB_SERIAL=1` 执行） |

### 14. Phase 3（响应式布局 + 触摸交互 + 移动端生命周期）落地情况（2026-09-10）

#### 14.1 用户决策

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 断点 | **统一为 1023px**（删掉 Phase 3 前的 1100px，避免 1024~1100 区间两套阈值打架）；< 1024 = 移动布局 |
| 2 | 移动布局形态 | 侧栏 → `Drawer placement="left"`（280px）；底部面板 → `Drawer placement="bottom"`（60vh）；移动端**不渲染 Splitter 的侧栏/底部面板面板** |
| 3 | 工具栏溢出 | 保留高频控件（撤销/重做、新建行、Read All/取消），其余（进制 / 从站地址 / 写后回读 / Address Adjust / 恢复列布局 / 行数）收进「更多」`Popover` 面板；**桌面不受影响**（≥1024px 仍直接铺开）——同一份 JSX 变量复用，避免两套实现漂移 |
| 4 | 表格 | `scroll.x` 移动端 960（桌面 920）；**窄屏不做任何列固定**（2026-09-11 用户决策：固定列在多列横滑时占用可视宽度且与触摸横滑手势争抢，原 `fixed:"left"` 已移除）+ **移动端禁用列宽调整与列拖拽排序** |
| 5 | 后台挂起层位 | **application 层** `SessionHostCore.pauseBackground/resumeBackground`（保留 `pollingTargets`/`activeTraces`，复用断线重连恢复路径）+ `AppHost` 可选方法 |
| 6 | 返回键与生命周期事件源 | **`@capacitor/app` 已接入**：`backButton` 先关覆盖层（overlay-close 栈）再 `minimizeApp()`；`appStateChange` 与 `visibilitychange` 双通道驱动后台挂起（幂等） |
| 7 | 触摸交互 | 行高 44dp（移动端）、长按行菜单（靠 WebView 长按触发的 `contextmenu` + CSS 抑制选择）、双击重命名保留、行拖拽加 `TouchSensor`（长按 250ms）、**侧栏排序移动端不做** |
| 8 | KeepAwake | **做**，自研零依赖：原生 `FLAG_KEEP_SCREEN_ON`，由 UI 按「是否存在持续轮询/追踪」自动开关 |
| 9 | 响应式实现 | 自研 `useIsMobileLayout()`（与 CSS 同一数值，媒体查询手写同值 + 注释同源标记） |
| 10 | 持久化 | 移动端不新增工作区字段（抽屉开合为会话内状态） |

#### 14.2 已完成的落点

```
packages/ui/src/layout/breakpoints.ts      # MOBILE_LAYOUT_MAX_WIDTH=1023 + useIsMobileLayout()
packages/ui/src/overlay-close.ts           # 覆盖层关闭栈（返回键「先关最上层」的基础设施，LIFO + useOverlayClose）
packages/ui/src/MamepApp.tsx               # 移动布局：汉堡按钮 + 左抽屉（表列表）、面板按钮 + 底部抽屉；1100px 局部实现删除
packages/ui/src/components/BottomPanel.tsx # variant="docked"|"drawer"（drawer 不套折叠态、不渲染折叠按钮）
packages/ui/src/components/RegisterTable.tsx # 移动：scroll.x 960 + 无列固定 + 行高 44 + 禁用列宽/列拖拽 + 行拖拽 TouchSensor
packages/ui/src/host.ts                    # AppHost 可选 setBackgroundSuspended / setKeepScreenOn
packages/application/src/session-host-core.ts # pauseBackground / resumeBackground / isBackgroundSuspended（+ 挂起期间不启动轮询的守卫）
packages/application/src/{rtu,tcp}-session-host.ts # 薄封装转发
packages/platform-android/*                # 桥方法 setKeepScreenOn（白名单 + Zod + fake 桥）+ AndroidPlatformHost.setKeepScreenOn
packages/platform-android/src/capacitor-app.ts # 生命周期桥（@capacitor/app：backButton / appStateChange / minimizeApp）
apps/web/src/{App.tsx,android-app-host.ts,AppHost.ts} # visibilitychange + appStateChange → setBackgroundSuspended；返回键经 AppHost.onHardwareBack
packages/ui/src/MamepApp.tsx               # 返回键订阅：closeTopOverlay() 优先，未消费则宿主最小化
packages/ui/src/components/RegisterTable.tsx # 移动端次要控件收进「更多」Popover（secondaryToolbarGroup 同一份 JSX 复用）
apps/web/src/mobile.css                    # <1024 样式段（安全区 / 触摸目标 / 行高 / 抽屉 / 选择抑制 / 「更多」面板宽度）
apps/android/.../MamepTransportPlugin.kt    # setKeepScreenOn（FLAG_KEEP_SCREEN_ON）
```

#### 14.3 验收（本次）

| 项 | 结果 |
| --- | --- |
| 单测 | `pnpm test`（仅单测，不含 e2e 包）全绿；`apps/web` 105（+5 返回键）、`ui`、`platform-android` 等无回归 |
| 类型 / Lint | `pnpm typecheck` 32/32、`pnpm lint` EXIT=0 |
| 移动布局 e2e（web） | `tests/e2e-web/tests/mobile-layout.spec.ts` **5/5 全绿**：侧栏→左抽屉（选中即收起）/ 底部面板→底部抽屉 / 表格横滚+固定前两列+行高 44 / 工具栏「更多」面板 / 无 console 错误 |
| 桌面回归 | `pnpm test:e2e:web`（141 用例）：第 1 轮 **140/141**（失败 = 本次引入：工具栏「更多」按钮与顶栏 More **可访问名重名** → 已修）；第 2 轮 **140/141**（失败 = 既有用例 `app.spec.ts:195` 偶发 `Execution context was destroyed`，**单跑 `app.spec.ts` 10/10 通过**）；第 3 轮由用户要求中止（已跑到第 8 项均通过，含该用例）。**两处失败均经定位，无产品缺陷遗留** |
| 真机 e2e（Android） | 新增 `tests/e2e-android/tests/mobile-ui.spec.ts`（移动布局 + 返回键关抽屉/最小化）——**已写好，待真机执行**（需用户设备） |

**回归中发现并修复**（均为本次 Phase 3 引入，由 e2e 抳出）：

1. **`Drawer` 用了弃用的 `width`/`height`** → antd v6 每次渲染 `console.error`（“'width' is deprecated. Please use 'size' instead.”），
   而单测（jsdom）不校验 console 错误 → 浏览器全量 e2e 中 **47 个「无 console 错误」断言级联失败**。修：改 `size`（v6 下 `size` 接 number|string）。
   教训：**新的 antd 组件 / 属性上线后必须跑一次全量 e2e**（弃用警告只在真实浏览器 console 里暴露）。
2. **移动端行高 44px 未生效**：`index.css` 的桌面规则 `.register-table-tabs .ant-table-wrapper .ant-table-tbody > tr > td`（29px）特异性 0-3-2 高于
   移动端的 0-2-2，仅靠加载顺序不足 → 修：移动端选择器提升为 4 个 class 前缀（见 `mobile.css` 注释）。
3. **工具栏「更多」按钮与顶栏 More 可访问名重名**：`getByRole("button", { name: "More", exact: true })` 命中 2 个（strict mode violation），
   屏幕阅读器同样无法区分 → 修：`aria-label` 改用独立键 `table.toolbarMoreLabel`（可视文本仍为 “More”），既有用例无需改动即通过。
4. **既存偶发（非本次引入）**：`app.spec.ts:195` 出现一次 `Execution context was destroyed, most likely because of a navigation`，
   同用例在第 1/3 轮均通过、单跑 `app.spec.ts` 10/10 通过 → 记为 e2e flake（Playwright 本地未开 retries），与本次改动无关。

#### 14.4 **尚未完成 / 未验证（重要，不得当作已交付）**

1. **Tooltip 移动端触发方式：评估后未改（待真机确认）**。原计划把 hover 改为 click。
   分析后暂不改：① 触摸设备上浏览器会为点按合成 `mouseenter`（antd Tooltip 默认 `trigger: "hover"` 可显示）；
   ② 逐单元格改 trigger 需要每个单元格组件订阅断点（computed 行×列的订阅量）或引入 context 透传，代价与收益不相称。
   **真机验证项**：若实测点按 Wp / 错误图标不显示提示，再按 context（`MobileLayoutContext`）方案补齐。
2. **长按行菜单未真机验证**：未新增自定义长按计时逻辑，依赖 Android WebView 对长按触发的 `contextmenu`
   （已配 CSS `-webkit-touch-callout/user-select` 抑制系统菜单）。**需真机确认**（`mobile-ui.spec.ts` 未覆盖右键菜单）。
3. **真机 e2e 未执行**：`mobile-ui.spec.ts`（移动布局 + 返回键）已写好但**未在真机上跑过**；既有 `tcp-loop`/`rtu-ui`
   也**未在真机上回归**（已入库的 UI 变动：顶栏新增两个按钮、表格固定列/行高、工具栏「更多」面板可能影响其定位器，需一并校验）。
   另需 `pnpm build:android` 重建 APK（新增 `@capacitor/app` 需 `cap sync` 同步原生依赖）。
4. **平板横屏（≥1024）未验证**：断点为 1023px，平板横屏走桌面布局；无设备/模拟方案落地（可用 CDP `Emulation.setDeviceMetricsOverride` 后续补）。
5. **`@capacitor/app` 原生依赖同步**：`apps/android` 已声明 `@capacitor/app ^8.1.1`，但原生工程需 `pnpm build:android`（内含 `cap sync`）
   才能生成对应 Gradle 依赖；**未跑构建前测试机上的返回键行为仍是系统默认**。

## 决策点

1. **平台范围**：确认 Android 纳入产品范围，作为第四平台推进（PRD / TECH_DESIGN / AGENTS 同步更新）。
2. **容器**：Capacitor（拒绝 React Native / Kotlin 全原生 / KMP / 纯 Chrome+WebUSB）。
3. **接缝层级**：`TransportPort` 字节流（拒绝在功能码层切接缝）。
4. **会话承载**：留在 WebView（JS），原生只做字节搬运（拒绝原生实现 Modbus 会话）。
5. **首期传输**：Modbus TCP + USB-RS485；BLE 与经典 SPP 推迟（Phase 4 另行确认）。
6. **UI 范围**：平板横屏优先 + 手机竖屏可用；不做 FAB、不做 Trace 折线图。
7. **能力矩阵**：新增 `androidCapabilities`，Phase 1 如实声明（含 `executablePlugins:false` / `hostPlugins:false`）；
   平台 API 只允许出现在 `packages/platform-android` 与 `apps/android`。
8. **Host 形态（2026-09-10 确认）**：Android 用**本地混合宿主** `AndroidAppHost`（通用能力委托 `BrowserAppHost`，TCP 走本地
   `TcpSessionHost` + `CapacitorTcpTransport`）；不扩展 `BrowserAppHost` 支持 TCP（避免把 TCP 路径写进浏览器宿主、模糊边界）。
9. **原生插件落位（2026-09-10 确认）**：Phase 1 放 `apps/android` 内（app-local plugin + `MainActivity.registerPlugin`），
   **不建** `packages/capacitor-modbus-transport`；后续需要跨 app 复用/发布时再抽。
10. **默认连接参数（2026-09-10 确认）**：Android 端默认 `requestTimeoutMs = 300` / `retryCount = 2`（仅该平台 composition root 覆盖，不改全局 `defaultConfig`）。
11. **应用标识（2026-09-10 确认）**：`com.mamep2026.app` / `Mamep2026`。

## 分期

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| Phase 0 | 本 ADR + PRD / TECH_DESIGN / AGENTS 同步 + 桥延迟 spike + CSP `worker-src` 修复 | 2–3 天 |
| Phase 1 | `packages/platform-android`（能力矩阵 / 桥契约 / 错误映射 / TCP 传输 / PlatformHost）+ `apps/android`（Capacitor 工程 + app 内 Kotlin TCP 插件）+ `apps/web` 的 `--mode android` 与 `AndroidAppHost` + 真机 TCP e2e ——**已完成（2026-09-10，e2e 2/2 全绿）** | ~1 周 |
| Phase 2 | USB-RS485 插件（枚举 / 授权 / detach / 错误映射）+ 真机 RTU 闭环 ——**实现已完成（2026-09-10）**；真机 UI 面 e2e 全绿，**USB 读写闭环待硬件** | 1–1.5 周 |
| Phase 3 | 响应式布局 + 触摸交互 + 移动端生命周期 ——**落地（2026-09-10）**：移动布局（1023 断点 / 侧栏→Drawer / 底部面板→底部抽屉）+ 后台挂起恢复 + KeepAwake + 工具栏「更多」面板 + `@capacitor/app` 返回键/前后台；余项：真机 e2e 执行与长按确认（见 §14.4） | 1–2 周 |
| Phase 4（另行确认） | BLE（BLE UART 优先）+ profile schema v9 + 文件导入导出/分享 | 1–2 周 |
| Phase 5 | 第三方脚本插件（运行时探测 + 安装入口）+ APK/AAB 打包签名 ——**已完成（2026-09-13，ADR-056）**：`pluginInstall: "upload"`、`executablePlugins` 运行时探测翻转、`build:android:release`（APK + AAB，签名材料缺失则产出 unsigned）；真机插件 e2e **7/7 全绿** | 0.5–1 周 |

## 不做什么

1. 不重写业务逻辑；不新增 `core` / `adapters` / `platform-tcp` 之类的包；不搬迁现有模块；
2. 不把会话下沉原生；
3. 不翻转浏览器端能力矩阵（`browserCapabilities.modbusTcp` 维持 `false`）；
4. 不在本阶段做 Floating Read All、TM Trace 折线图；
5. 不做 iOS 端（本 ADR 只覆盖 Android；若后续需要 iOS，复用同一套 `packages/platform-android` 命名下的 Capacitor 适配思路，另开 ADR）；
6. 不实现完整 §19.7 恢复模式（沿用 ADR-049 范围）。
