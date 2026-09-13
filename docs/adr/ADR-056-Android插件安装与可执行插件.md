# ADR-056：Android 端插件安装与可执行插件（Phase 5：运行时探测 + 安装入口 + 发布签名）

- **状态**：已实施（2026-09-13）
- **日期**：2026-09-13
- **关联**：[ADR-050](ADR-050-Android端接入与Capacitor方案.md)（Android 接入与分期，Phase 5）、
  [ADR-054](ADR-054-删除随包插件机制与插件同进程执行.md)（插件一律手动安装 / 同进程执行 = 用户显式授权）、
  [ADR-055](ADR-055-宿主侧插件执行面.md)（宿主侧插件执行面 + 生产 CSP 放行 `blob:`）、
  [ADR-044](ADR-044-插件PhaseF可执行插件正式化.md)（隔离运行时与单文件 JS 安装）、
  [ADR-046](ADR-046-浏览器兼容性检测.md)（能力检测的 UI 呈现先例）
- **待办来源**：`ToDoList.md` 阶段二「[verify] 插件 Phase 5：Android 端可执行插件（ADR-054 §7.2）」

## 1. 背景与问题

ADR-054 §7.2 把 Android 的插件执行能力留给 Phase 5：「`executablePlugins` 仍为 `false`（WebView 版本门控），
需真机确认 Blob Worker 可用后评估翻转，纯清单插件当前已可安装」。实施前核对代码后发现**两处事实需要纠正**：

1. **「纯清单插件当前已可安装」不成立**：Android 的 `pluginInstall` 为 `"unsupported"`，
   `PluginManagerSection.handleInstallClick()` 在该值下**直接报错返回**（不弹文件选择）——
   即 Android 上**任何插件（含纯清单）都装不了**；
2. 执行面代码其实**早已就绪**：`AndroidAppHost` 委托 `BrowserAppHost`，
   isolated = `WebPluginRemoteRuntime`（Blob Worker）、same-process = `loadWebPluginEntry`（Blob `import()`），
   插件存储 = `IndexedDBPluginStore`，`startPlugins()` 已接线；唯一阻塞点是能力位与安装入口。

真正的不确定项只有一个：**Android WebView（版本差异大、工业平板可能长期不更新）能否在生产 CSP 下
创建 Blob Worker 并在 Worker 内动态 `import()` blob entry**。这不能靠静态声明，必须实测。

## 2. 用户决策（2026-09-13）

1. 真机验证通过**即一并落地**（不是只出结论）；
2. **包含** APK/AAB 打包签名（Phase 5 的另一半）；
3. 本次一并把 `pluginInstall` 改为 `"upload"`；
4. 执行能力用**运行时探测**（不静态翻转、不按版本号门控）；
5. `same-process` 与桌面端一致（同样可选，不单独门控）；
6. 真机验证由 AI 执行；
7. 失败时错误提示与桌面端一致即可（复用既有错误键）；
8. 安装文件过滤**放宽**（规避 ROM 的 MIME 过滤）；
9. 安全边界**不变**。

## 3. 分层落点

### 3.1 执行能力运行时探测

- **`packages/platform-web/src/plugin-execution-probe.ts`（新）**：`probePluginExecutionSupport(options?)`
  —— **复用生产同一条路径**（`WebPluginRemoteRuntime` + `PLUGIN_WORKER_BOOTSTRAP`）加载内置极简单文件
  entry（`PLUGIN_EXECUTION_PROBE_ENTRY`），因此同时覆盖：
  - `worker-src 'self' blob:`（创建 Blob Worker）；
  - `script-src 'self' blob:`（**Worker 内**对 blob entry 的动态 `import()`）。
  语义：`ok` → `true`；Worker 创建失败 / `load-error` / 超时（默认 3000ms，经 `Clock` 端口注入，
  单测用 Virtual Clock）→ `false`；**永不抛出**；无论结果都 `dispose()`（terminate Worker）。
  放在 `platform-web` 而非 app 层：机制属 Web 平台（与 `plugin-remote-runtime` 同域），
  且避免在 `apps/web` 复制 bootstrap 副本。
- **`packages/platform-android/src/android-capabilities.ts`**：
  - `pluginInstall: "unsupported"` → **`"upload"`**（WebView `<input type="file">` + 客户端读文件文本，
    Capacitor Android 的 `BridgeWebChromeClient.onShowFileChooser` 已实现，无需 Capacitor Filesystem）；
  - 静态 `executablePlugins: false` 明确为 **fail-closed 基线**；新增纯函数
    `resolveAndroidCapabilities({ blobWorkerSupported })` 用探测结果覆盖该字段（**只该字段**）。
- **`apps/web/src/android-capabilities-probe.ts`（新）**：`resolveAndroidHostCapabilities(probe?)`
  —— 把「探测」与「能力组合」接起来；探测抛错 → 按不可用处理（不阻断装配）。
  单独成文件的原因：`host-factories/android.ts` 是 `@capacitor/core` 的唯一加载边界（jsdom 单测不可导入），
  本模块不 import Capacitor，故可 node 单测。
- **`apps/web/src/host-factories/android.ts`**：工厂改 `async`，先 `await resolveAndroidHostCapabilities()`
  再构造 `AndroidAppHost` —— 能力在 UI 首次读取前即定型，**无需新增响应式信号**。
- **`apps/web/src/host-assembly.ts`**：`PlatformHostFactory` 返回类型放宽为 `AppHost | Promise<AppHost>`，
  调用处 `await`；`await` 之后保留既有 `signal.aborted` 检查（取消语义不回归）。
- **`apps/web/src/android-app-host.ts`**：新增 `capabilities?: PlatformCapabilities` 选项
  （默认 `androidCapabilities`，即未探测时不误报），`get capabilities()` 与传给 inner 的基础能力都用它。

### 3.2 安装入口

- **`packages/ui/src/components/PluginManagerSection.tsx`**：文件输入 `accept` 由
  `.json,.mjs,application/json,text/javascript` 改为 **`.json,.mjs,.js`**（仅扩展名）——
  部分 ROM 的文件选择器按 MIME 过滤，会把 `.mjs` 归为 `application/octet-stream` 而不可选；
  文件内容仍经 `pluginManifestSchema` 校验，选错文件有结构化错误提示。
- UI 无需其他改动：`executablePlugins` 在**点击时**读取，探测已在装配期完成，无竞态。

### 3.3 发布打包与签名

- **`apps/android/android/app/build.gradle`**：按序读取 `app/keystore.properties`（已 gitignore）
  或 `MAMEP_ANDROID_KEYSTORE_{PATH,STORE_PASSWORD,KEY_ALIAS,KEY_PASSWORD}` 环境变量；
  材料齐全 → `signingConfigs.release` 并绑定 `buildTypes.release`；**不齐全 → release 不签名**
  （产出 `app-release-unsigned.apk`，构建末尾明确提示）——**绝不静默复用 debug key 冒充发布签名**。
  - **踩坑（实测）**：**不得用 `java.util.Properties.load`** 读该文件——它把 `\` 当转义符，
    会把 Windows 绝对路径 `C:\Users\...` 解析成 `C:Users...`，`validateSigningRelease` 报
    `Keystore file ... not found`。改为按行读取、仅在首个 `=` 处切分、**不做任何转义**
    （Windows 路径可直接书写）。
- **`scripts/build-android.mjs`**：新增 `--release`（`assembleRelease` + `bundleRelease`）与
  `--aab-only`；默认 debug 路径与行为**零改动**（真机 e2e 依赖它）。另：
  - 构建前清掉同名陈旧产物，使「构建后存在」成为本次构建的可靠证据；
  - 期望产物名由「是否提供签名材料」决定（有 → `app-release.apk`，无 → `app-release-unsigned.apk`），
    缺失时给出含目录列表的明确错误；并打印签名状态提示。
- **`package.json`**：新增 `build:android:release`；`test:e2e:android` 前置 `pnpm build:plugins`
  （插件 e2e 依赖 `release/plugins/` 产物，与 web/vscode 套件一致）。
- **`.gitignore`（`apps/android/android/.gitignore`）**：`*.jks` / `*.keystore` / `keystore.properties`
  一律不入库（取消模板里的注释行）。

## 4. 安全边界（不变）

- 默认**隔离执行**（Web Worker）；`same-process` 必须在安装确认框中**由用户显式授权**（ADR-054 边界不变）；
- 生产 CSP **不放宽**（仍是 `default-src 'self'` + `script-src 'self' blob:` + `worker-src 'self' blob:`，
  ADR-055 已修）；
- Capacitor 插件调用仍只允许出现在 `packages/platform-android` 与 `apps/android`；会话仍留 JS；
- `hostPlugins` 维持 `false`（Android 无 Node 宿主执行面，如实声明）；
- 发布签名密钥与口令**不入库、不写入构建日志**；本 ADR 的验证也只用临时 keystore（口令由脚本本地随机生成、
  不打印、验证后删除），真实发布签名由用户用自己的 keystore 执行。

## 5. 验证

### 5.1 单测 / 静态检查

- `platform-web` **73**（+4：探针的可用 / `load-error` / 超时 / Worker 创建抛错，且断言总是 `terminate`
  与取消计时器）、`platform-android` **81**（+3：`resolveAndroidCapabilities` 两态 + 不误改其他字段；
  基础常量改为断言 `pluginInstall: "upload"`、`executablePlugins: false` 为 fail-closed 基线）、
  `apps/web` **126**（+3 能力解析 +2 异步工厂装配：正常接线 / `await` 期间取消仍释放且不接线）、
  `ui` **406**（+1：`accept` 仅按扩展名过滤）；
- 全仓单测 `pnpm test` **28/28 tasks** 全绿；`pnpm typecheck` **32/32**；`pnpm lint` **EXIT=0**。

### 5.2 真机 e2e（vivo V2303A / Android 16，无线调试，生产 APK）

`pnpm test:e2e:android` = **16 passed / 2 skipped / 0 failed**（2 skipped = USB-RS485 闭环需硬件），
其中新增 `tests/e2e-android/tests/plugin-runtime.spec.ts` **7/7**：

| 用例 | 断言 |
| --- | --- |
| 探针证据 | 页面上下文直接跑「Blob Worker → Worker 内 `import(blob entry)`」→ `ok && hasManifest`（84ms） |
| 安装入口 | Settings → Plugins：隐藏文件输入就位、`accept=".json,.mjs,.js"`、Install 按钮可见 |
| 纯清单安装 | `setInputFiles(manifest.json)` → 安全确认 → `Installed` → 存储落盘（无 `entrySource`） |
| 可执行安装 | `setInputFiles(<id>.mjs)` → 安全确认（隔离）→ `Installed` → 存储含 `entrySource` + `executionMode: "isolated"` |
| 执行面真机可用 | reload 后启动路径（`startPlugins` → Blob Worker）仍成功加载；卸载后回收（存储删除） |
| 同进程 + 同步贡献 | same-process 安装 → reload → **表列表出现插件分组**（codec / tableType 同步注册真机生效）→ 卸载后分组消失 |
| console | 全程无 console 错误 |

**结论：Android WebView（本机 WebView 151）在生产 CSP 下可执行可执行插件**，故按决策 4 以运行时探测
如实翻转 `executablePlugins`（探测不可用的设备仍如实为 `false`）。`setInputFiles` 经 CDP 投递文件
**真机可用**，因此安装闭环（含安全确认与持久化）可全自动化。

### 5.3 发布签名接线验证

- 根 `build:android:release` 与 `--aab-only` 的接线用**临时 keystore** 验证（口令本地随机生成、不打印、
  验证后删除）：`BUILD SUCCESSFUL`，产出 `app-release.apk`（3.7 MB）与 `app-release.aab`（3.6 MB）；
  `apksigner verify --print-certs` 显示签名证书 DN 与临时证书一致；
- **无签名材料分支**同样实测：产出 `app-release-unsigned.apk` + AAB，并打印未签名提示（exit 0）；
- **debug 路径零回归**：`assembleDebug` 与既有 5 个真机 spec 全绿。

### 5.4 浏览器回归

`pnpm test:e2e:web`（dev/mock）全绿——本次改动在浏览器端只影响共享装配（工厂可异步）与插件安装
`accept` 属性，浏览器插件安装 / 执行 / 移动布局用例均无回归。

## 6. 已知限制

1. **系统文件选择器 UI 未自动化**：点击 Install 会拉起设备侧 SAF（原生 Activity），自动化无法驱动，
   且会把 WebView 切到后台（实测会令后续抽屉交互失败）。e2e 因此**不点击 Install**，改用
   `setInputFiles` 直接向隐藏 input 投递文件（即隐藏 input + `file.text()` 的真实应用路径，
   仅跳过 OS 选择器 UI）。**用户在真机上首次选择文件的行为未自动化验证**（应用侧路径已覆盖）。
2. **`same-process` 未单独门控**（按决策 5 与桌面端一致）：若某 ROM 拦下文档内的 blob `import()`，
   安装会以 `errors.pluginLoadFailed` 报错（无法像 Worker 那样预先探测）；真机（WebView 151）实测可用。
3. **探测粒度**：每次启动探测一次（超时上限 3000ms，失败即如实 `false`）；不做 WebView 版本号门控，
   也不做「探测失败时给出专门提示」（安装可执行插件时仍复用 `errors.pluginLoadFailed` /
   `plugins.executableUnsupported` 既有文案）。
4. **发布签名密钥由用户持有**：本仓库只提供接线；`keystore.properties`（或环境变量）需用户自行配置，
   **不接受也不记录口令**。
5. `logExport` / `workspaceImport` / `workspaceExport` 在 Android 仍为 `"unsupported"`（Phase 4 文件通道）。

## 7. 相关

- 取代/修正：ADR-054 §7.2 的「Android 纯清单插件已可安装」表述（当时 `pluginInstall` 仍为
  `"unsupported"`，实际任何插件都装不了）——本 ADR 已落地安装入口并修正文档；
  ADR-050 §6 能力矩阵表的 `executablePlugins` / `pluginInstall` 两行同步更新为「运行时探测 / upload」。
- 不改动：HostMessage v1、工作区 schema、协议层、调度器、插件 API 版本、能力矩阵的其余字段。
