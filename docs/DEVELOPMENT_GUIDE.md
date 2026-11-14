# Mamep2026 开发环境与测试指南

> 本文件承接原根 `AGENTS.md` 的常用命令、环境排障与测试基础设施说明。
> 开发流程、强制约束与代理完成标准仍以根 `AGENTS.md` 和 `docs/AGENTS.md` 为准。

## 常用命令

- `pnpm dev` — 网页端 Vite dev server（http://localhost:5173，apps/web），**不启动 Electron**
- `pnpm dev:electron` — Electron 开发模式（apps/web `vite --mode electron`，主进程/preload 打包到根 `dist-electron/`）；另需 `pnpm start:electron`（`electron .`）启动窗口
- `pnpm build` / `pnpm build:electron` — 构建网页端 / Electron（产物 `apps/web/dist/`）
- `pnpm dist:portable` — 免安装绿色版打包（build:electron → staging 组装 → electron-builder `--dir`，产出 `release/win-unpacked/` 整个文件夹，拷贝即用；配置 `electron-builder.yml` + `scripts/package-electron.mjs`，详见 ADR-018）
- `pnpm dist:vscode` — VSCode 扩展 VSIX 打包（build:vscode → staging 组装 release/vscode-extension/ → npm 装 serialport 生产依赖 → vsce package，产出 `release/mamep2026-<version>.vsix`，仅打包不发布；staging 原因与流程见 `scripts/package-vscode.mjs` 头注释）
- `pnpm build:vscode` — VSCode 端构建（`node scripts/build-vscode.mjs`：`vite --mode vscode` 构建共享 UI → 拷贝到 `apps/vscode-extension/dist/media/` → esbuild 打包扩展宿主 `dist/extension.js` 与 webview bridge `dist/media/vscode-bridge.js`）
- `pnpm build:plugins` — 插件分发产物（ADR-054：插件一律手动安装，需可安装文件）：`node scripts/build-plugins.mjs` —— 可执行插件（address-adjust / custom-function-code / yaskawa-memobus）打包为单文件 `.mjs` 并从产物提取 `manifest.json`，纯清单插件（主题色）拷贝 `manifest.json`，产出到 `release/plugins/<pluginId>/`（`release/` 已 gitignore）。**跑浏览器插件相关 e2e 前需先构建**（`test:e2e:web` / `test:e2e:vscode` 已自动先构建）
- `pnpm build:android` — Android 构建（`node scripts/build-android.mjs`：web `--mode android` 产物 `apps/web/dist-android/` → `cap sync` → `gradlew assembleDebug`；产出 `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`）。**需 JDK ≤24**（脚本自动探测，见 `apps/android/README.md`）
- `pnpm build:android:release` — Android 发布打包（ADR-056）：`assembleRelease` + `bundleRelease` → `app-release.apk`（有签名材料）/ `app-release-unsigned.apk`（无）+ `app-release.aab`。签名材料不入库：`apps/android/android/app/keystore.properties`（已 gitignore）或 `MAMEP_ANDROID_KEYSTORE_{PATH,STORE_PASSWORD,KEY_ALIAS,KEY_PASSWORD}`；`--aab-only` 仅产 AAB（见 `apps/android/README.md`「发布打包与签名」）
- `pnpm test:e2e:android` — Android 真机 e2e（Playwright `connectOverCDP` 接 WebView devtools + `adb reverse` 真实 TCP 往返；**需真机 + USB 调试 或 无线调试（`MAMEP_ANDROID_ADB_TARGET=<ip:连接端口>` 自动 `adb connect`）+ 屏幕解锁不熄屏**，无设备即失败不静默跳过；
  **不进 `test:all`**；会先 `pnpm build:plugins` 再构建安装 debug APK）
- `pnpm lint` — ESLint（全仓）
- `pnpm typecheck` — turbo 全包类型检查（各包 `tsc --noEmit`）
- `pnpm test` — turbo 全包 vitest（各包单测）
- `pnpm test:all` — 一条命令跑完全量测试，顺序固定：三端真实端口 e2e（浏览器 `web:real` 最先，其次 `electron:real`、`vscode:real`）→ `pnpm test`（单测）→ `test:acceptance` → 三端 mock e2e（`e2e:web` / `e2e:electron` / `e2e:vscode`）→ `test:serial:virtual` → `pnpm lint` → `pnpm typecheck`（**不含 `test:e2e:android`**：需真机硬件，另行手动执行）。real 环节缺环境 SKIP 不失败（`e2e-real.mjs` 退出码 0）；fail-fast（任一环节失败即中断并返回非 0）；浏览器 real 首次需在系统串口选择器手动选 COM4 一次（记录 localStorage 复用）。**运行本命令前不得先运行任何其他指令（如启动服务器、启动从站等）**——前置环境由 `e2e-real.mjs` 统一编排（预检/启停从站/设置 `MAMEP_REAL`）；环境已有手动启动的进程时须先清理（详见 docs/AGENTS.md §27）
- `pnpm test:acceptance` / `pnpm test:e2e:web` / `pnpm test:e2e:electron` / `pnpm test:e2e:vscode` 单独跑对应测试包（e2e:electron 自动先 `build:electron`；e2e:vscode 自动先 `build:vscode`）
- `pnpm test:e2e:real` / `pnpm test:e2e:web:real` / `pnpm test:e2e:electron:real` / `pnpm test:e2e:vscode:real` — 三端「真实端口」e2e（com0com COM4↔COM5 + 真实 RTU/TCP 从站，ADR-024）：`scripts/e2e-real.mjs` 统一编排（预检 → 启停从站 → 设 `MAMEP_REAL=1` → 跑对应端 `test:real`）；缺环境 SKIP 不失败；浏览器端启动时需在系统串口选择器手动选 COM4 一次（记录 localStorage 复用）。VSCode real 需先 `pnpm build:vscode`（runner 已处理）
- `pnpm format` / `pnpm format:check` — Prettier

> Android 端（ADR-050）：`build:android`（web `--mode android` → `cap sync` → `gradlew assembleDebug`，需 JDK ≤24，详见 `apps/android/README.md`）与 `test:e2e:android`（真机 TCP e2e，需 USB 调试 + 解锁屏幕，**不进 `test:all`**）已可用；`dev:android` 不做。

## 环境要点与坑

- 包管理 **pnpm 11**；原生依赖构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`（旧字段 `onlyBuiltDependencies` 已失效，pnpm 会自动往该文件追加占位键，注意 YAML 键重复）。
- 镜像：`.npmrc` 指向 npmmirror；Electron 二进制需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- Electron：入口 `dist-electron/main.js`（根目录，root package.json `main` 指向）；preload 为 `dist-electron/preload.js`（sandbox 下 CJS）；dev 用 `VITE_DEV_SERVER_URL` 加载网页，生产 `loadFile` 指向 `apps/web/dist-electron/index.html`（Electron 模式构建 `base: "./"` + 构建期 CSP meta，渲染器产物独立目录，避免与浏览器构建互相覆盖）。保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。跨边界消息用 HostMessage v1 版本化 Envelope + Zod 校验（`packages/platform-api/src/host-message.ts`），preload 只暴露白名单 `window.mamepHost`（含 dev 探针 `debug:get-state`，打包后禁用）。冒烟验证：`node scripts/smoke-electron.mjs`（Playwright + Electron，生产构建路径）。详见 [docs/adr/ADR-016-electron骨架与安全IPC.md](adr/ADR-016-electron骨架与安全IPC.md)。
- **Electron 串口枚举（Web Serial）关键约束（2026-08-22 实测）**：`navigator.serial.requestPort()` **必须在用户手势中调用**（点开下拉框 / 点刷新），在弹窗打开 / effect 里自动枚举会抛 `SecurityError: Must be handling a user gesture`，被吞掉后下拉框恒空（"刷不出来串口"的根因）。**origin 归一化**：主进程 `setPermissionCheckHandler` 收到的 `details.securityOrigin` 在 dev 下带尾斜杠（`http://localhost:5173/`），与 `new URL().origin` 生成的 allowlist（无斜杠）精确匹配会失败 → 设备被拒 → `requestPort` reject `NotFoundError`（另一"刷不出来"根因）；`serial-permissions.ts` 的 `normalizeOrigin`（http(s) 用 URL origin 归一化，`file://` 原样保留）为关键修复，改权限逻辑时不得绕过。完整获取机制（手势→事件转发→下拉选择→callback 回传）见 `docs/TECH_DESIGN.md` §9.2。fake `navigator.serial` 的 e2e 走不到真实权限/手势路径，单测/e2e 全绿 ≠ 真机可用，串口权限类问题必须真机验证。
- **E2E 报错先停、看路径**：Playwright 报 `Process failed to launch` 常吞掉真实原因，先看用户端的原生报错弹窗（含完整路径/模块名）。`tests/e2e-electron/tests/` 下的临时 spec 定位仓库根必须用 `path.resolve(import.meta.dirname, "../../..")`（上跳三级），写 `../..` 会报 `Unable to find Electron app at ...\tests\dist-electron\main.js`。遇到报错先停下、让用户提供报错窗口信息再分析；临时诊断文件用完即删、不进正式 suite/typecheck。
- VSCode 插件：webview 当前为 dev 模式（iframe 指向 dev server，`MAMEP_DEV_URL` 可覆盖）；CSP 必须含 `style-src 'unsafe-inline'` 并设置 html/body/iframe 100% 宽高，否则 iframe 缩成 300×150。
- 浏览器自动化测试：**Playwright 使用系统 Edge**（`channel: "msedge"`），不下载 Chromium。工作流见 [浏览器端自动化测试](architecture/quality/testing/浏览器端自动化.md)。
- **Android 构建必须用 JDK ≤ 24（2026-09-10 实测）**：Capacitor 8 模板固定 Gradle 8.14.3 + AGP 8.13.0，Java 25 构建报 `Unsupported class file major version 69`（Java 25 需 Gradle ≥9.1，AGP 8.x 只配 Gradle 8.x）。命令行由 `scripts/build-android.mjs` 探测（`JAVA_HOME` → Android Studio JBR（仅 ≤24）→ `%LOCALAPPDATA%\MamepJdk\jdk-21`，均无则给出安装指引）；Android Studio 内需把 Gradle JDK 手动指到 17/21。
- **Android 真机 e2e 前置（`pnpm test:e2e:android`）**：设备解锁并保持常亮（建议 `adb shell svc power stayon true`）；
  **无线调试下 `svc power stayon` 不生效**（2026-09-13 实测）：必须先把息屏超时调长（`adb shell settings put system screen_off_timeout 1800000`），否则息屏后应用无法前台化、**WebView devtools socket 不出现**（表象为 `等待 WebView devtools socket 超时`）；
  **不用 `adb logcat`**（部分 OEM 无输出）——断言与诊断一律走 CDP（`adb forward`）；`/proc/net/unix` 的 devtools socket 名带 `@` 前缀（`adb forward localabstract:` 前需剔除）且应用重启后会变。
  另：表格默认行地址为空，e2e 必须先填 Register 地址再读，否则读请求根本不会产生；**插件用例不要点击 Install 按钮**（会拉起设备侧系统文件选择器这一原生 Activity、把 WebView 切到后台），改用 `setInputFiles` 直投隐藏 input。详见 `apps/android/README.md`。
- **vivo/iQOO 的 adb 安装坑（2026-09-10 实测）**：`adb install -r` 会返回 `INSTALL_FAILED_ABORTED: User rejected permissions`
  且**手机无任何弹窗**，实际是 ROM 静默拒绝**流式安装**；改用 **`adb install -r --no-streaming`**（push 安装）即成功。
  `tests/e2e-android/helpers/adb.ts` 已内置「先非流式、失败回退流式」策略；若两者都失败，检查开发者选项里的「USB 安装」开关。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。
- **antd v6（6.6）关键差异（写 UI / 测试选择器前必读）**：
  - `Tabs` 活动面板 DOM 类名是 `.ant-tabs-content-active`（**不是** v5 的 `.ant-tabs-tabpane`，v6 无该类名）；页面有两个 Tabs 时选择器必须限定范围（表格用 `.register-table-tabs ...`，否则 BottomPanel 的页签会误匹配）。
  - `Tabs` 的 `+` 新建按钮 `.ant-tabs-nav-add` 在 DOM 里出现两次，可见的在 `.ant-tabs-nav-list` 内，用 `.ant-tabs-nav-list .ant-tabs-nav-add` 定位。
  - `List` 组件已弃用（dev console 报错）；虚拟列表用 `Listy`（`items`+`itemRender`，渲染类 `.ant-listy-item`）。
  - `Switch` 的 `checkedChildren` / `unCheckedChildren` 渲染为**两个恒在 DOM 的兄弟 span**（`.ant-switch-inner-checked` / `.ant-switch-inner-unchecked`，靠 CSS margin 滑动切换），**不能用可见文本判断开关状态**：单测可断言两个 span 的文本，e2e 一律断言 `aria-checked`（或 `.ant-switch-checked`）；`size="small"` 仍渲染这两个 span（有专用内边距，`1`/`0` 文字正常显示）。
  - 弹窗（Modal）结构用 `.ant-modal-container` / `.ant-modal-body`，没有 `.ant-modal-content`。
  - **侧边栏折叠态 Menu（2026-09-16 实测）**：折叠态菜单根类名是 `ant-menu-root ant-menu-vertical ant-menu-inline-collapsed`，**不含 `ant-menu-inline`**（展开态规则不会误伤）；antd 用 css 变量给的缩进须在折叠态覆盖（`--ant-menu-item-width: calc(100% - 4px)`、`--ant-menu-item-margin-inline: 2px`，不改则图标不在窄条中线）；隐藏折叠态标签（`.anticon + span`）需 **`!important`**——antd 那条规则含元素选择器（特异性 0,4,1）高于同级类选择器组合（0,4,0），不加则计算值仍为 `block`、标签继续占 flex 空间把图标挤左。
  - 弃用/错误用法会导致 dev console.error，破坏 e2e「无 console 错误」断言。
  - 组件测试（`packages/ui`）用 jsdom，BottomPanel 类组件需包 `<AntApp>`（`App.useApp()`）；`turbo` 跑 typecheck/lint 会进 TUI 备用缓冲区吞输出，用 `$env:TURBO_UI="0"; pnpm typecheck` 流式输出。
- **生产 CSP 与可执行插件（2026-09-12 ADR-055，实测）**：四端生产产物注入的 CSP 必须**同时**放行 `worker-src 'self' blob:` 与 **`script-src 'self' blob:`**。只放行 `worker-src` 是不够的——Worker 内部（以及文档内的同进程路径）对 **blob: URL 的动态 `import()`** 由 `script-src` 管控，缺 `blob:` 时报 `Loading the script 'blob:…' violates … "script-src 'self'"`，表现为安装可执行插件时提示 `Failed to load the plugin entry.`（`errors.pluginLoadFailed`）。**dev server 不注入 CSP，故 e2e-web（dev）永远是绿的**：CSP / 产物类改动必须用生产产物验证（`build:electron` + Electron e2e、`build:vscode` + VSCode e2e）。回归保护：`apps/web/src/csp.test.ts`、`apps/vscode-extension/src/webview/prod-csp.test.ts`。
- **宿主侧插件执行面（2026-09-12 ADR-055）**：宿主（Electron 主进程 / VSCode 扩展宿主）侧插件**只能**经 `PluginStorePort` 加载（`@mamep2026/platform-node/plugin` 的 `HostPluginRuntime`），**不得**在 `main.ts` / `extension.ts` 里静态 import 插件包；`sync()` 按「已启用 same-process 插件集合签名（id + entrySource）」比对，**变化即全量重建** dataType/addressTransform 注册表（这两个注册表无注销 API，复用旧表会让卸载/禁用插件的变换继续生效）。VSCode 的插件 entrySource 存 `globalState`（单插件约 0.5MB，VSCode 会提示 `large extension state detected`，体积大时应考虑落盘 —— 见 ADR-055 §5）。
- **构建代码分割（2026-09-11：懒加载 + rolldown 默认分包）**：四端渲染器共用 `apps/web/vite.config.ts`。**不要自定义 `build.rolldownOptions.output.codeSplitting.groups`**——自定义分组（尤其带 `maxSize`）会把同一 npm 包内部的循环依赖切到不同 chunk、破坏类初始化顺序（实测 Electron 生产构建整体白屏：`TypeError: Class extends value undefined is not a constructor or null`，出错点 `@ant-design/colors` 的基类/子类被分到两个 chunk）；「一个 npm 包一个 chunk」（`name` 函数）虽可运行但 `antd` 单包 **816 kB**、500 kB 告警仍在。默认分包（不写 groups）配合懒加载即得 25 chunk / 入口 394 kB / 最大 483 kB / 无告警。旧接口 `advancedChunks` 在 rolldown 1.x 已弃用（构建打印弃用告警），非弃用形态是 `output.codeSplitting`。**浏览器 dev 不打包，e2e-web（dev server）跑不出打包类问题**：分包/产物类改动必须用生产产物验证（`pnpm build:electron` + Playwright 启动 Electron 断言 `#root` 有子节点且无 console 错误、`pnpm test:e2e:electron`、`pnpm test:e2e:vscode`）。UI 侧懒加载 = `MamepApp` 的 `React.lazy` + **每个组件各自一层 `<Suspense fallback={null}>`**（共用 boundary 会互相卸载）+ `useOpenedOnce` 门控（首次打开才挂载、此后常驻保关闭动画；**必须用渲染期派生 state**，effect 里同步 setState 被 `react-hooks/set-state-in-effect` 拦、写 ref 被 `react-hooks/refs` 拦）。产物核对：`pnpm build` 后 `apps/web/dist*/assets/*.js` 应全部 ≤ 500 kB（入口约 394 kB、最大约 483 kB）。**「启动即自动打开」的弹窗（`ConnectionSettingsModal`）不要懒加载**（属首屏路径，延迟出现会与 e2e 的固定等待窗口形成竞态）。jsdom 单测里懒加载组件首次挂载要异步等待（`findBy*` + 显式放宽超时；实测 HelpDrawer 链路 4–5 s，默认 1 s 会误报）。
- **平台宿主懒加载边界（2026-09-13）**：渲染器侧**只**懒加载「平台专属宿主」——`apps/web/src/host-assembly.ts` 的 `loadPlatformHostFactory` 用 `switch(platform)` + 字面量 `import("./host-factories/xxx")`（浏览器分支静态 `return createBrowserHost`）；`@capacitor/core` / `@capacitor/app` **只能**从 `host-factories/android.ts`（经 `platform-android` 的 `/capacitor`、`/capacitor-app` 子路径）可达，`App.tsx` / `main.tsx` / UI 包不得直接 import 它们。装配是异步的 → 取消必须用 `AbortSignal` 并在 `await` 后与工厂调用后各查一次 `aborted`（否则 StrictMode 双挂载下旧 host 订阅存活 → 通信日志重复投递）。启动骨架由 `useAppStore.hostStatus` 驱动（`main.tsx` 渲染前置 `assembling`，装配端置 `ready`/`failed`）；`failed` **不占位**（保持「无 Host 可操作」）。字节口径提醒：**入口 chunk 变小不等于首屏变小**（应用代码会重分入共享 chunk），评估首屏必须算「入口 + `modulepreload` 合计」。

## 测试约定与测试基础设施

- **测试执行时机由用户决定（2026-08-19）**：不要求每次变更后都跑测试（尤其耗时较长的 e2e / acceptance）；用户未要求时 AI 不得擅自长时间跑测试，也不得谎报已执行。用户要求测试先行时遵循 TDD / ATDD；要求执行某类测试时按 [docs/AGENTS.md](AGENTS.md) §27 的覆盖要求准备用例。
- Android 端（ADR-050）真机 e2e 为独立命令 `pnpm test:e2e:android`（需真机 + USB 调试 + 解锁屏幕；无设备即失败不静默跳过），**不进 `pnpm test:all`**（依赖硬件，由用户决定执行时机）。`pnpm build:android` 需 JDK ≤24（脚本自动探测）。
- 包内单测用 vitest（每包 `pnpm test`）；调度测试用 Virtual Clock + FakeTransport（packages/test-kit）。
- Electron 侧单测：`apps/electron`（IPC 校验/分发 + Preload 白名单桥 + Web Serial 权限模块 `serial-permissions.ts`）、`apps/web`（ElectronAppHost 复用浏览器路径：能力翻转、选口/取消、FC03/FC10 闭环、工作区委托）；E2E 在 `tests/e2e-electron/`（Playwright + Electron，`pnpm test:e2e:electron` 自动先 `build:electron` 再启动生产构建窗口断言：preload 白名单桥、能力矩阵、debug 探针、剪贴板、Renderer 安全边界、串口授权 + RTU 读写闭环（fake `navigator.serial` 注入）、无 console 错误、关窗退出）。
- 浏览器端 E2E：Playwright 使用系统 Edge（`channel: "msedge"`），配置在 `tests/e2e-web/playwright.config.ts`；以 `?mockTransport=1` 启用 dev 内置模拟 Modbus RTU 传输（生产构建不启用）。工作流见 [浏览器端自动化测试](architecture/quality/testing/浏览器端自动化.md)。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。
