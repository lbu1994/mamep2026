# Mamep2026 开发环境与测试指南

> 本文件收录常用命令、环境排障与测试基础设施说明。
> 开发流程、强制约束与代理完成标准以根 `AGENTS.md` 为准。

## 常用命令

- `pnpm dev` — 网页端 Vite dev server（http://localhost:5173，apps/web），**不启动 Electron**
- `pnpm dev:electron` — Electron 开发模式（apps/web `vite --mode electron`，主进程/preload 打包到根 `dist-electron/`）；另需 `pnpm start:electron`（`electron .`）启动窗口
- `pnpm build` / `pnpm build:electron` — 构建网页端 / Electron（产物 `apps/web/dist/`）
- `pnpm dist:portable` — 免安装绿色版打包（build:electron → staging 组装 → electron-builder `--dir`，产出 `release/win-unpacked/` 整个文件夹，拷贝即用；配置 `electron-builder.yml` + `scripts/package-electron.mjs`）
- `pnpm dist:vscode` — VSCode 扩展 VSIX 打包（build:vscode → staging 组装 release/vscode-extension/ → npm 装 serialport 生产依赖 → vsce package，产出 `release/mamep2026-<version>.vsix`，仅打包不发布；staging 原因与流程见 `scripts/package-vscode.mjs` 头注释）
- `pnpm build:vscode` — VSCode 端构建（`node scripts/build-vscode.mjs`：`vite --mode vscode` 构建共享 UI → 拷贝到 `apps/vscode-extension/dist/media/` → esbuild 打包扩展宿主 `dist/extension.js` 与 webview bridge `dist/media/vscode-bridge.js`）
- `pnpm build:plugins` — 插件分发产物（插件一律手动安装，需可安装文件）：`node scripts/build-plugins.mjs`。可执行插件（address-adjust / custom-function-code / yaskawa-memobus）打包为单文件 `.mjs` 并从产物提取 `manifest.json`，纯清单插件（主题色）拷贝 `manifest.json`，产出到 `release/plugins/<pluginId>/`（`release/` 已 gitignore）。**跑浏览器插件相关 e2e 前需先构建**（`test:e2e:web` / `test:e2e:vscode` 已自动先构建）
- `pnpm build:android` — Android 构建（`node scripts/build-android.mjs`：web `--mode android` 产物 `apps/web/dist-android/` → `cap sync` → `gradlew assembleDebug`；产出 `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`）。**需 JDK ≤24**（脚本自动探测，见 `apps/android/README.md`）
- `pnpm build:android:release` — Android 发布打包：`assembleRelease` + `bundleRelease` → `app-release.apk`（有签名材料）/ `app-release-unsigned.apk`（无）+ `app-release.aab`。签名材料不入库：`apps/android/android/app/keystore.properties`（已 gitignore）或 `MAMEP_ANDROID_KEYSTORE_{PATH,STORE_PASSWORD,KEY_ALIAS,KEY_PASSWORD}`；`--aab-only` 仅产 AAB（见 `apps/android/README.md`「发布打包与签名」）
- `pnpm test:e2e:android` — Android 真机 e2e（Playwright `connectOverCDP` 接 WebView devtools + `adb reverse` 真实 TCP 往返；**需真机 + USB 调试 或 无线调试（`MAMEP_ANDROID_ADB_TARGET=<ip:连接端口>` 自动 `adb connect`）+ 屏幕解锁不熄屏**，无设备即失败不静默跳过；
  **不进 `test:all`**；会先 `pnpm build:plugins` 再构建安装 debug APK）
- `pnpm lint` — ESLint（全仓）
- `pnpm typecheck` — turbo 全包类型检查（各包 `tsc --noEmit`）
- `pnpm test` — turbo 全包 vitest（各包单测）；排除验收包和四个 E2E 包，验收测试只由 `pnpm test:acceptance` 执行一次
- `pnpm test:all` — 一条命令跑完全量测试，顺序固定：三端真实端口 e2e（浏览器 `web:real` 最先，其次 `electron:real`、`vscode:real`）→ `pnpm test`（单测）→ `test:acceptance` → mock e2e（`e2e:web`）→ 生产 Web 性能门禁（`test:perf:production`）→ `e2e:electron` / `e2e:vscode` → `test:serial:virtual` → `pnpm lint` → `pnpm typecheck`（**不含 `test:e2e:android`**：需真机硬件，另行手动执行）。每个测试入口互斥：验收用例只运行一次，虚拟串口文件从普通 `platform-node` 单测中排除并只由专项配置运行。real 环节缺环境 SKIP 不失败（`e2e-real.mjs` 退出码 0）；fail-fast（任一环节失败即中断并返回非 0）；浏览器 real 首次需在系统串口选择器手动选 COM4 一次（记录 localStorage 复用）。**运行本命令前不得先运行任何其他指令（如启动服务器、启动从站等）**——前置环境由 `e2e-real.mjs` 统一编排（预检/启停从站/设置 `MAMEP_REAL`）；环境已有手动启动的进程时须先清理（按根 `AGENTS.md` 的测试与验证要求）。
- `pnpm test:acceptance` / `pnpm test:e2e:web` / `pnpm test:e2e:electron` / `pnpm test:e2e:vscode` 单独跑对应测试包（e2e:electron 自动先 `build:electron`；e2e:vscode 自动先 `build:vscode`）
- `pnpm test:perf:production` — Web 生产性能回归门禁（系统 Edge + Vite preview；自动构建
  `apps/web/dist`）。Lighthouse 对桌面和移动模拟各串行运行 3 次并校验中位数；Playwright
  验证首屏可交互、Settings 首次打开、1000 行恢复/导入/滚动、普通单元格编辑和 Console
  错误。预算、原始样本、中位数与通过状态写入
  `test-reports/run-<时间戳>/web-performance-baseline.json`；单独在包内执行时写入
  `tests/e2e-web/test-results/`。系统 Edge 不在标准路径时设置 `MAMEP_EDGE_PATH`。
  真实设备字段 INP 通过 Settings → General 的本地性能采样导出，再用
  `node scripts/summarize-field-performance.mjs <report.json...> --out <summary.md>`
  汇总；流程见
  [Web 真实设备性能验证](architecture/quality/performance/真实设备验证.md)。
- `pnpm test:e2e:real` / `pnpm test:e2e:web:real` / `pnpm test:e2e:electron:real` / `pnpm test:e2e:vscode:real` — 三端「真实端口」e2e（com0com COM4↔COM5 + 真实 RTU/TCP 从站）：`scripts/e2e-real.mjs` 统一编排（预检 → 启停从站 → 设 `MAMEP_REAL=1` → 跑对应端 `test:real`）；缺环境 SKIP 不失败；浏览器端启动时需在系统串口选择器手动选 COM4 一次（记录 localStorage 复用）。VSCode real 需先 `pnpm build:vscode`（runner 已处理）
- `pnpm format` / `pnpm format:check` — Prettier

> Android 端：`build:android`（web `--mode android` → `cap sync` → `gradlew assembleDebug`，需 JDK ≤24，详见 `apps/android/README.md`）与 `test:e2e:android`（真机 TCP e2e，需 USB 调试 + 解锁屏幕，**不进 `test:all`**）；不提供 `dev:android`。

### 寄存器表格专项性能检查

```powershell
pnpm --filter @mamep2026/e2e-web test:perf:production workspace-restore.spec.ts scroll-visual.spec.ts
pnpm --filter @mamep2026/e2e-web exec playwright test tests/table-scroll-flicker.spec.ts
```

生产计时测试测量目标行首次渲染的耗时，并持续采集长任务，直到所有延迟渲染的控件就绪。
滚动计时在启动对话框关闭后开始，现有时间预算保持不变。
使用 `--repeat-each 3` 可保留三次独立采样，包括失败样本。汇总报告包含全部样本。
`scroll-timings.json` 记录从滚动开始到控件恢复完成期间的长任务起始时间和持续时间。

计时测试关闭 Playwright trace 录制。`retain-on-failure` 仍会录制每次运行，增加截图和
DOM 快照工作，详见
[Playwright 录制说明](https://playwright.dev/docs/best-practices#debugging-on-ci)。
视觉测试保留 `retain-on-failure`，不判定时间预算。诊断时可使用 `--trace on` 运行计时测试；
比较测量结果前，先核对报告中记录的 trace 模式。计时报告还会保留观测到的全部滚动长任务。

独立的视觉测试逐帧采集控件恢复过程，以稳定后的行作为参考，比较行高、文字和图标位置、
控件尺寸与位置、颜色、边框及阴影。场景覆盖 1000 行、上下两个滚动方向、英文浅色与中文
深色布局，以及 125% CSS 缩放。CSS 缩放不等同于真实浏览器缩放测试。
逐帧 JSON 文件和稳定后的截图保存在 Playwright 输出目录中。读取布局会增加采样开销，
因此几何信息采样与性能计时分开执行。

[Event Timing](https://www.w3.org/TR/event-timing/) 不会上报低于 16 ms 最小上报阈值的条目。
单元格编辑报告将缺失条目保留为 `null`，并通过第二次动画帧回调，实测从按下 Enter 到绘制
完成的耗时上界。100 ms 门槛采用两种实测值中的较大值。浏览器不支持 Event Timing 或
缺少真实按键样本时，测试仍然失败。这些浏览器检查不能证明 Electron、VSCode、Android
或真实硬件的性能。

## 插件通信授权的针对性检查

以下用例使用模拟传输、进程内存储或真实浏览器，不连接真实设备。它们分别检查
权限矩阵、运行实例失效、撤销队列请求、安装批准与恢复，以及沙箱的实际浏览器边界。

```powershell
pnpm --filter @mamep2026/plugin-api test
pnpm --filter @mamep2026/application exec vitest run src/plugin-communication.test.ts src/plugin-authorization.test.ts
pnpm --filter @mamep2026/platform-web exec vitest run src/plugin-remote-runtime.test.ts src/plugin-execution-probe.test.ts
pnpm --filter @mamep2026/platform-node exec vitest run src/plugin-remote-runtime.test.ts src/host-plugin-runtime.test.ts
pnpm --filter @mamep2026/web exec vitest run src/plugin-authorization.test.ts src/app-host.test.ts
pnpm --filter @mamep2026/web exec vitest run src/plugin-preview.test.ts
pnpm --filter @mamep2026/ui exec vitest run src/components/PluginManagerSection.test.tsx src/components/SettingsDrawer.test.tsx
pnpm --filter @mamep2026/e2e-web exec playwright test plugin-exec.spec.ts plugin-authorization.spec.ts
pnpm build
$env:NO_PROXY = 'localhost,127.0.0.1,[::1]'
pnpm --filter @mamep2026/e2e-web exec playwright test -c playwright.plugin-production.config.ts
```

预览生命周期回归覆盖确认前读写拒绝、取消后连接不恢复请求、重复预览、加载超时、
Host 销毁和确认后重新加载。单测使用模拟端点与模拟设备，不代表真实设备验证。
生产浏览器用例使用系统 Edge 检查实际 Worker 退出及关闭 Settings 时的回收。

生产专项使用 18474 端口和系统 Edge，检查生产 CSP 下使用精确哈希授权的沙箱引导脚本。
设置 `NO_PROXY` 是为了避免环境 HTTP 代理把未监听的本地端口误判为可访问服务。
运行前先构建当前源码。浏览器检查不能代替 Electron、VSCode、Android 宿主运行或
真实 RTU/TCP 设备验证。设计说明见[插件通信授权](architecture/ports/plugin-api/插件通信授权.md)。

SEC-02 存储回归复用上述浏览器生产专项，覆盖 IndexedDB 打开、枚举、删除、嵌套
Worker、伪造存储消息、工作区及备份内容、源码/执行模式/批准变化后的重载。
工作区重载会触发自动保存，因此重载前后比较全部内容时仅排除工作区顶层 `updatedAt`；
插件记录及批准摘要仍逐字段比较。Cache Storage 在部分不透明来源中不暴露；若存在，
则必须拒绝访问。IndexedDB 必须返回 `SecurityError`，其他异常不计为隔离成功。

宿主存储和重启检查使用以下入口：

```powershell
pnpm --filter @mamep2026/electron exec vitest run src/main/plugin-file-store.test.ts
pnpm --filter @mamep2026/vscode-extension exec vitest run src/plugin-store.test.ts
pnpm build:electron
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --filter @mamep2026/e2e-electron exec playwright test plugin-host-execution.spec.ts
```

Electron 专项使用独立临时 `userData`，检查真实文件仓储及进程重启；结束后删除该临时目录。
VSCode 存储单测使用 Memento 替身，检查 `mamep2026.plugins` 键、批准保留及内容绑定，
不能代替真实 Extension Host/Webview 运行。Node 运行时单测检查恢复前的批准拒绝。

Android 的 `tests/e2e-android/tests/plugin-runtime.spec.ts` 包含同一攻击入口、工作区与备份
保护、重载及执行模式篡改回归。按 Android 既有准备流程构建当前 APK 后运行该文件。
该套件会安装 APK 并清空测试应用数据，必须使用已准备的测试设备；桌面浏览器结果不能
作为 Android 真机结果。

## 环境要点与坑

- 包管理 **pnpm 11**；原生依赖构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`。pnpm 会自动往该文件追加占位键，修改时必须检查 YAML 键是否重复。
- 镜像：`.npmrc` 指向 npmmirror；Electron 二进制需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- Electron：入口 `dist-electron/main.js`（根目录，root package.json `main` 指向）；preload 为 `dist-electron/preload.js`（sandbox 下 CJS）；dev 用 `VITE_DEV_SERVER_URL` 加载网页，生产 `loadFile` 指向 `apps/web/dist-electron/index.html`（Electron 模式构建 `base: "./"` + 构建期 CSP meta，渲染器产物独立目录，避免与浏览器构建互相覆盖）。保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。跨边界消息用 HostMessage v2 版本化 Envelope + Zod 校验（`packages/platform-api/src/host-message.ts`），preload 只暴露白名单 `window.mamepHost`（含 dev 探针 `debug:get-state`，打包后禁用）。冒烟验证：`node scripts/smoke-electron.mjs`（Playwright + Electron，生产构建路径）。详见 [Electron 宿主](architecture/host/electron/Electron宿主.md)。
- **Electron 串口枚举（Web Serial）关键约束**：`navigator.serial.requestPort()` **必须在用户手势中调用**（点开下拉框 / 点刷新）；在弹窗打开或 effect 中自动枚举会抛 `SecurityError: Must be handling a user gesture`，导致下拉框为空。**origin 归一化**：主进程 `setPermissionCheckHandler` 收到的 `details.securityOrigin` 在 dev 下带尾斜杠（`http://localhost:5173/`），与 `new URL().origin` 生成的 allowlist（无斜杠）精确匹配会失败，设备被拒后 `requestPort` 会 reject `NotFoundError`；`serial-permissions.ts` 的 `normalizeOrigin` 必须对 http(s) 使用 URL origin 归一化，并原样保留 `file://`，修改权限逻辑时不得绕过。完整获取机制（手势→事件转发→下拉选择→callback 回传）见 [Web Serial 适配](architecture/adapters/platform-web/WebSerial适配.md)。fake `navigator.serial` 的 e2e 无法覆盖真实权限和用户手势路径；串口权限类问题必须通过真机验证。
- **E2E 报错先停、看路径**：Playwright 报 `Process failed to launch` 常吞掉真实原因，先看用户端的原生报错弹窗（含完整路径/模块名）。`tests/e2e-electron/tests/` 下的临时 spec 定位仓库根必须用 `path.resolve(import.meta.dirname, "../../..")`（上跳三级），写 `../..` 会报 `Unable to find Electron app at ...\tests\dist-electron\main.js`。遇到报错先停下、让用户提供报错窗口信息再分析；临时诊断文件用完即删、不进正式 suite/typecheck。
- VSCode 插件：webview 当前为 dev 模式（iframe 指向 dev server，`MAMEP_DEV_URL` 可覆盖）；CSP 必须含 `style-src 'unsafe-inline'` 并设置 html/body/iframe 100% 宽高，否则 iframe 缩成 300×150。
- 浏览器自动化测试：**Playwright 使用系统 Edge**（`channel: "msedge"`），不下载 Chromium。工作流见 [浏览器端自动化测试](architecture/quality/testing/浏览器端自动化.md)。
- **Android 构建必须用 JDK ≤ 24**：Capacitor 8 模板固定 Gradle 8.14.3 + AGP 8.13.0，Java 25 构建报 `Unsupported class file major version 69`（Java 25 需 Gradle ≥9.1，AGP 8.x 只配 Gradle 8.x）。命令行由 `scripts/build-android.mjs` 探测（`JAVA_HOME` → Android Studio JBR（仅 ≤24）→ `%LOCALAPPDATA%\MamepJdk\jdk-21`，均无则给出安装指引）；Android Studio 内需把 Gradle JDK 手动指到 17/21。
- **Android 真机 e2e 前置（`pnpm test:e2e:android`）**：设备解锁并保持常亮（建议 `adb shell svc power stayon true`）；
  **无线调试下 `svc power stayon` 不生效**：必须先把息屏超时调长（`adb shell settings put system screen_off_timeout 1800000`），否则息屏后应用无法前台化、**WebView devtools socket 不出现**（表象为 `等待 WebView devtools socket 超时`）；
  **不用 `adb logcat`**（部分 OEM 无输出）——断言与诊断一律走 CDP（`adb forward`）；`/proc/net/unix` 的 devtools socket 名带 `@` 前缀（`adb forward localabstract:` 前需剔除）且应用重启后会变。
  另：表格默认行地址为空，e2e 必须先填 Register 地址再读，否则读请求根本不会产生；**插件用例不要点击 Install 按钮**（会拉起设备侧系统文件选择器这一原生 Activity、把 WebView 切到后台），改用 `setInputFiles` 直投隐藏 input。详见 `apps/android/README.md`。
- **vivo/iQOO 的 adb 安装约束**：`adb install -r` 会返回 `INSTALL_FAILED_ABORTED: User rejected permissions`
  且**手机无任何弹窗**，实际是 ROM 静默拒绝**流式安装**；改用 **`adb install -r --no-streaming`**（push 安装）即成功。
  `tests/e2e-android/helpers/adb.ts` 已内置「先非流式、失败回退流式」策略；若两者都失败，检查开发者选项里的「USB 安装」开关。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。
- **antd v6（6.6）关键差异（写 UI / 测试选择器前必读）**：
  - `Tabs` 活动面板 DOM 类名是 `.ant-tabs-content-active`（**不是** v5 的 `.ant-tabs-tabpane`，v6 无该类名）；页面有两个 Tabs 时选择器必须限定范围（表格用 `.register-table-tabs ...`，否则 BottomPanel 的页签会误匹配）。
  - `Tabs` 的 `+` 新建按钮 `.ant-tabs-nav-add` 在 DOM 里出现两次，可见的在 `.ant-tabs-nav-list` 内，用 `.ant-tabs-nav-list .ant-tabs-nav-add` 定位。
  - 虚拟列表必须使用 `Listy`（`items`+`itemRender`，渲染类 `.ant-listy-item`），不使用 `List`。
  - `Switch` 的 `checkedChildren` / `unCheckedChildren` 渲染为**两个恒在 DOM 的兄弟 span**（`.ant-switch-inner-checked` / `.ant-switch-inner-unchecked`，靠 CSS margin 滑动切换），**不能用可见文本判断开关状态**：单测可断言两个 span 的文本，e2e 一律断言 `aria-checked`（或 `.ant-switch-checked`）；`size="small"` 仍渲染这两个 span（有专用内边距，`1`/`0` 文字正常显示）。
  - 弹窗（Modal）结构用 `.ant-modal-container` / `.ant-modal-body`，没有 `.ant-modal-content`。
  - **侧边栏折叠态 Menu**：折叠态菜单根类名是 `ant-menu-root ant-menu-vertical ant-menu-inline-collapsed`，**不含 `ant-menu-inline`**（展开态规则不会误伤）；antd 用 css 变量给的缩进须在折叠态覆盖（`--ant-menu-item-width: calc(100% - 4px)`、`--ant-menu-item-margin-inline: 2px`，否则图标不在窄条中线）；隐藏折叠态标签（`.anticon + span`）需 **`!important`**——antd 那条规则含元素选择器（特异性 0,4,1）高于同级类选择器组合（0,4,0），不加则计算值仍为 `block`、标签继续占 flex 空间把图标挤左。
  - 弃用/错误用法会导致 dev console.error，破坏 e2e「无 console 错误」断言。
  - 组件测试（`packages/ui`）用 jsdom，BottomPanel 类组件需包 `<AntApp>`（`App.useApp()`）；`turbo` 跑 typecheck/lint 会进 TUI 备用缓冲区吞输出，用 `$env:TURBO_UI="0"; pnpm typecheck` 流式输出。
- **生产 CSP 与可执行插件**：四端生产产物注入的 CSP 必须**同时**放行 `worker-src 'self' blob:` 与 **`script-src 'self' blob:`**。只放行 `worker-src` 会失败，因为 Worker 内部（以及同进程路径）对 **blob: URL 的动态 `import()`** 由 `script-src` 管控；缺 `blob:` 时报 `Loading the script 'blob:…' violates … "script-src 'self'"`，表现为安装可执行插件时提示 `Failed to load the plugin entry.`（`errors.pluginLoadFailed`）。**dev server 不注入 CSP，e2e-web（dev）无法覆盖该问题**：CSP / 产物类改动必须用生产产物验证（`build:electron` + Electron e2e、`build:vscode` + VSCode e2e）。回归保护：`apps/web/src/csp.test.ts`、`apps/vscode-extension/src/webview/prod-csp.test.ts`。
- **宿主侧插件执行面**：宿主（Electron 主进程 / VSCode 扩展宿主）侧插件**只能**经 `PluginStorePort` 加载（`@mamep2026/platform-node/plugin` 的 `HostPluginRuntime`），**不得**在 `main.ts` / `extension.ts` 里静态 import 插件包；`sync()` 按「已启用 same-process 插件集合签名（id + entrySource）」比对，**变化即全量重建** dataType/addressTransform 注册表（这两个注册表无注销 API，复用旧表会让卸载/禁用插件的变换继续生效）。VSCode 的插件 entrySource 存 `globalState`（单插件约 0.5MB，VSCode 会提示 `large extension state detected`，体积大时应落盘）。
- **构建代码分割（懒加载 + rolldown 自动分包）**：四端渲染器共用 `apps/web/vite.config.ts`。应用与 antd 使用 rolldown 自动分包，仅将完整 `react-dom` 包隔离为独立 chunk，不设置 `maxSize`、不按包内部模块继续切分。历史上 `react` / `antd` / `vendor` 自定义分组曾把 `@ant-design/colors` 基类与子类拆开，导致 Electron 白屏，禁止恢复。纯领域/契约包声明 `sideEffects: false`，antd 组件使用稳定深路径导入；每个 Web 构建都会执行 `scripts/verify-web-bundle-budget.mjs`，要求任一 JS chunk ≤ 400 KiB、首屏 gzip ≤ 450 KiB。UI 侧懒加载使用 `React.lazy` + 每组件独立 `<Suspense>` + `useOpenedOnce` 门控；连接设置在宿主就绪后加载，兼容性/恢复横幅按条件加载。**浏览器 dev 不打包**，分包改动必须验证四端生产产物。jsdom 单测里懒加载组件首次挂载要异步等待。
- **平台宿主懒加载边界**：`App.tsx` 先同步渲染启动骨架，首帧后动态加载共享组合根 `host-assembly.ts` / `platform-context.ts`；`loadPlatformHostFactory` 再按平台动态 `import()` 专属宿主。开发服务器使用 `host-factories/loader.ts` 做运行时平台探测；生产构建把 `./host-factories/loader` 别名到 `loader.browser.ts` / `loader.electron.ts` / `loader.vscode.ts` / `loader.android.ts`，只保留共享 Browser Host 与目标平台工厂，Vite 构建会校验其他工厂或 `@capacitor/*` 不得进入产物。Android 探测只走 `@mamep2026/platform-android/detect-android` 纯子路径，禁止从 Android 包根入口导入探测函数；`@capacitor/core` / `@capacitor/app` **只能**从 `host-factories/android.ts` 经 `/capacitor`、`/capacitor-app` 子路径可达。装配取消必须用 `AbortSignal`，并在每个 `await` 后检查 `aborted`。启动骨架由 `useAppStore.hostStatus` 驱动，失败时保持「无 Host 可操作」。首屏字节口径为「HTML + 入口 + `modulepreload` + CSS」。

## 测试约定与测试基础设施

- **测试执行时机由用户决定**：不要求每次变更后都跑测试（尤其耗时较长的 e2e / acceptance）；用户未要求时 AI 不得擅自长时间跑测试，也不得谎报已执行。用户要求测试先行时遵循 TDD / ATDD；要求执行某类测试时按 [AGENTS.md](../AGENTS.md) 的测试与验证要求准备用例。
- Android 真机 e2e 为独立命令 `pnpm test:e2e:android`（需真机 + USB 调试 + 解锁屏幕；无设备即失败不静默跳过），**不进 `pnpm test:all`**（依赖硬件，由用户决定执行时机）。`pnpm build:android` 需 JDK ≤24（脚本自动探测）。
- 包内单测用 vitest（每包 `pnpm test`）；调度测试用 Virtual Clock + FakeTransport（packages/test-kit）。
- Electron 侧单测：`apps/electron`（IPC 校验/分发 + Preload 白名单桥 + Web Serial 权限模块 `serial-permissions.ts`）、`apps/web`（ElectronAppHost 复用浏览器路径：能力翻转、选口/取消、FC03/FC10 闭环、工作区委托）；E2E 在 `tests/e2e-electron/`（Playwright + Electron，`pnpm test:e2e:electron` 自动先 `build:electron` 再启动生产构建窗口断言：preload 白名单桥、能力矩阵、debug 探针、剪贴板、Renderer 安全边界、串口授权 + RTU 读写闭环（fake `navigator.serial` 注入）、无 console 错误、关窗退出）。
- 浏览器端 E2E：Playwright 使用系统 Edge（`channel: "msedge"`），配置在 `tests/e2e-web/playwright.config.ts`；以 `?mockTransport=1` 启用 dev 内置模拟 Modbus RTU 传输（生产构建不启用）。工作流见 [浏览器端自动化测试](architecture/quality/testing/浏览器端自动化.md)。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。
