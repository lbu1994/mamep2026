# Mamep2026 Android 客户端（Capacitor 容器）

Android 客户端使用 Capacitor 容器承载**同一份共享 UI**；平台差异只体现在
`packages/platform-android`（TS 适配层）与 `android/app/src/main/java/.../MamepTransportPlugin.kt`（原生通信插件）。

- 页面来源：`apps/web` 的 `--mode android` 产物（`apps/web/dist-android/`，Capacitor `webDir` 指向它）
- 应用标识：`appId = com.mamep2026.app`、`appName = Mamep2026`
- 页面 URL：`https://localhost/`（Capacitor `androidScheme: "https"` → 安全上下文）
- **版本号**：`versionName` / `versionCode` 由 `android/app/build.gradle` 从**仓库根 `package.json`** 读取；
  `versionCode = major*10000 + minor*100 + patch`，如 `0.4.2` → `402`。改版本只需改根 `package.json`。
- **启动图标**：由 `scripts/generate-icons.mjs` 从 `build/AppIcon.svg` 生成（全白底 + 黑色线条；
  legacy 白底方形/圆形 + 自适应图标透明底前景，背景色 `res/values/ic_launcher_background.xml` = `#FFFFFF`）。
  `pnpm build:android` 会自动同步生成，**不要手改 mipmap PNG**（改图形请改源 SVG）。
- 支持 **Modbus TCP**（原生 socket）与 **USB-RS485 串口**（USB Host + `usb-serial-for-android`）；
- 提供移动布局与生命周期能力（抽屉布局 / 工具栏「更多」面板 / 硬件返回键 / 前后台挂起 / 屏幕常亮）。

## 移动布局与生命周期

- 依赖：`@capacitor/app ^8.1.1`（**MIT**，npm 可直达，非 JitPack）——用于硬件返回键、前后台状态、`minimizeApp`。
  **注意：新增后必须重新 `pnpm build:android`（内含 `cap sync`）**，否则原生工程里没有该插件，返回键仍是系统默认。
- 返回键：`backButton` → UI 先关最上层覆盖层（移动抽屉等，`overlay-close` 栈）；无覆盖层时才 `minimizeApp()`
  （Android 惯例：退到后台而不是退出进程）。
- 前后台：`appStateChange`（原生）与 WebView 的 `visibilitychange` **双通道**驱动后台挂起（幂等互补）——
  挂起时暂停轮询/追踪（保留配置），回前台按原配置恢复。
- 屏幕常亮：存在持续轮询/追踪时置 `FLAG_KEEP_SCREEN_ON`（自研零依赖，不用 KeepAwake 插件）。
- 触摸：行高 44dp、工具栏次要控件收进「更多」面板、长按行菜单（依赖 WebView `contextmenu` + 抑制系统长按选择）。

## USB 串口

- 依赖：`com.github.mik3y:usb-serial-for-android:3.11.0`（**MIT**），**仅在 JitPack 发布** →
  `android/build.gradle` 的 `allprojects.repositories` 已加 `maven { url 'https://jitpack.io' }`；版本在 `variables.gradle`
  （`usbSerialForAndroidVersion`）。**首次构建需能访问 jitpack.io**（离线/受限网络会解析失败）。
- 覆盖芯片：FTDI（FT232R/H、FT2232H、FT4232H、FT230X/231X/234XD）、Prolific PL2303、Silabs CP210x、
  Qinheng CH340/CH341A，以及通用 CDC/ACM（CH343、CH9102、MCP2221、Arduino 等）。
- 权限：连接时若无权限会调 `UsbManager.requestPermission`（系统弹窗），最长等 30s；拒绝 → `errors.serialPermissionDenied`。
  重新插拔后需再次授权（Android 语义）。
- 读回聚合：原生侧保留 **10ms 空闲窗口**，缓冲达到 **4096 字节**或首字节起 **50ms** 时分块投递。分块不代表完整协议帧；帧解析仍由共享 JS 层完成。
- 参数：`baudRate / dataBits / stopBits / parity / flowControl` 直接透传；驱动不支持所请求流控时
  **按参数不支持如实报错**（不静默忽略）。
- 拔线：发 `closed(USB_DETACHED)` → 会话置 failed + 提示；**不做 USB 自动重连**，自动重连仅适用于 TCP。
- 未插设备时枚举为空列表（UI 显示空态，不是错误）。

## 插件

插件**一律手动安装**，入口在 **Settings → Plugins → Install Plugin**：

| 项       | Android 实现                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装入口 | `pluginInstall: "upload"`：隐藏 `<input type="file">` + 客户端读文件文本（Capacitor `BridgeWebChromeClient.onShowFileChooser` 走系统文件选择器，**不需要 Capacitor Filesystem**）。点击 Install 会拉起系统选择器——这是原生 Activity，e2e 无法驱动，故用例改为 `setInputFiles` 直投隐藏 input |
| 文件过滤 | `accept=".json,.mjs,.js"`（**仅扩展名**：部分 ROM 按 MIME 过滤会把 `.mjs` 判为 `application/octet-stream` 而不可选）                                                                                                                                                                         |
| 执行能力 | `executablePlugins` 由**运行时探测**决定（`probePluginExecutionSupport()` 检测「Blob Worker + Worker 内 blob entry 动态 import」），静态值为 **fail-closed 基线 `false`**；探测通过时为 `true`                                                                                                  |
| 执行模式 | 与桌面端一致：默认**隔离线程**；「Same process」需在安装确认框中显式授权（同步能力 codec / dataType / tableType 需要它）                                                                                                                                                                     |
| 持久化   | IndexedDB（与工作区共用库 `mamep2026` → `kv` → 键 `plugins`），reload / 重启后按存储重建执行面                                                                                                                                                                                               |

> 探测只覆盖隔离路径（Worker）；若某 ROM 拦下**文档内**的 blob `import()`（同进程模式），安装会以
> `errors.pluginLoadFailed` 报错——无法像 Worker 那样预先探测。

## 构建

```bash
pnpm build:android        # web 产物 → cap sync → gradlew assembleDebug
# 产物：apps/android/android/app/build/outputs/apk/debug/app-debug.apk

pnpm build:android:release   # 发布产物：assembleRelease + bundleRelease → APK + AAB
# 产物：.../outputs/apk/release/app-release.apk（有签名材料）/ app-release-unsigned.apk（无）
#       .../outputs/bundle/release/app-release.aab
```

脚本 `scripts/build-android.mjs` 会依次探测可用 JDK（`JAVA_HOME` → Android Studio JBR（仅当 ≤24）→
`%LOCALAPPDATA%\MamepJdk\jdk-21`），都不可用时给出明确指引。

### 发布打包与签名

构建脚本**不接收也不打印任何口令**；签名材料按下面二选一提供，两者都没有时 release 产出
**未签名** APK（`app-release-unsigned.apk` 并打印提示）——**不会静默复用 debug key 冒充发布签名**：

1. `apps/android/android/app/keystore.properties`（**已 gitignore，不入库**）：

```properties
storeFile=C:/keys/mamep-release.jks     # 可为绝对路径或相对 app/ 的路径（按字面读取，不处理 \ 转义）
storePassword=<你的口令>
keyAlias=mamep
keyPassword=<你的口令>
```

2. 环境变量：`MAMEP_ANDROID_KEYSTORE_PATH` / `MAMEP_ANDROID_KEYSTORE_STORE_PASSWORD` /
   `MAMEP_ANDROID_KEYSTORE_KEY_ALIAS` / `MAMEP_ANDROID_KEYSTORE_KEY_PASSWORD`。

首次创建密钥库（**口令请直接在自己的终端输入，不要写进命令历史或交给 AI**）：

```bash
keytool -genkeypair -keystore C:/keys/mamep-release.jks -alias mamep \
  -keyalg RSA -keysize 2048 -validity 9125
```

校验产物是否已签名：

```bash
"$ANDROID_HOME/build-tools/<ver>/apksigner" verify --print-certs \
  apps/android/android/app/build/outputs/apk/release/app-release.apk
```

- 版本号来自根 `package.json`（`versionName` = 其 version，`versionCode` = major*10000+minor*100+patch）。
- AAB 用于上架（由 Play 生成签名 APK）；`--aab-only` 只产 AAB。
### JDK 约束（必读）

Capacitor 8 模板固定 **Gradle 8.14.3 + AGP 8.13.0**，最高只支持 **Java 24**。
Android Studio 自带的 JBR 可能已是 **Java 25**，此时直接构建会报
`Unsupported class file major version 69`（Java 25 需 Gradle ≥ 9.1，而 AGP 8.x 只配 Gradle 8.x）。

处理（任一）：

1. Android Studio → Settings → Build Tools → Gradle → **Gradle JDK 指到 17/21**（IDE 内构建必需）；
2. 安装 JDK 21 并设置 `JAVA_HOME`；
3. 便携 JDK 21 解压到 `%LOCALAPPDATA%\MamepJdk\jdk-21`：
   `https://mirrors.huaweicloud.com/openjdk/21/openjdk-21_windows-x64_bin.zip`

## 安装与运行

```bash
adb install -r apps/android/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.mamep2026.app/.MainActivity
```

## 真机 E2E（`pnpm test:e2e:android`）

前提：**真机 + USB 调试 或 无线调试**（本套件不静默跳过，无设备即失败），且：

| 前置                                                                                         | 原因                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 屏幕解锁 + **不熄屏**（USB 调试：`adb shell svc power stayon true`；**无线调试见下方专节**） | 设备休眠时 OEM（vivo 等）无法弹出安装确认框 → `INSTALL_FAILED_ABORTED`；**休眠还会冻结 WebView** → CDP 上的定位/点击会永久挂起（表象像「卡住」，实为等待到用例超时）                                                                                                                                                                           |
| 允许「USB 安装」/ 首次安装时在手机上点确认                                                   | 同上                                                                                                                                                                                                                                                                                                                                           |
| 宿主机可达（`adb reverse` 由用例负责）                                                       | TCP 用例把宿主回环端口反向转发给设备，真实字节往返经原生 socket。**无线调试下 `adb reverse` 同样可用**                                                                                                                                                                                                                                           |
| **USB-RS485 闭环用例额外前置**                                                               | ① USB 转接器插在**手机**上（OTG）；另一端接 PC 侧从站（或另一只 USB-TTL，TX↔RX 交叉 + 共地）；② PC 侧先启动 RTU 从站：`pnpm slave`（端口/波特率取 `config/connections.json`）；③ 显式开启：设 `MAMEP_ANDROID_USB_SERIAL=1`；④ 首次连接需在手机上确认 USB 授权（用例等待最长 30s）。**无硬件时该用例自动跳过**，`rtu-ui.spec.ts` 无需硬件即可跑 |
| **vivo/iQOO：安装被静默拒绝**                                                                | `adb install -r` 可能报 `INSTALL_FAILED_ABORTED: User rejected permissions` 而**手机无任何弹窗**——这是 ROM 拒绝**流式安装**。`helpers/adb.ts` 已优先用 `adb install -r --no-streaming`（push 安装）并在失败时回退；若两者都失败，检查开发者选项的「USB 安装」开关                                                                              |

### 无线调试

Android 11+ 的「无线调试」是**两个不同的随机端口**，且都需要先配对：

| 端口               | 出处                                      | 用途                                                                                 |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `_adb-tls-pairing` | 弹窗「使用配对码配对设备」                | `adb pair <ip:配对端口>`（随后输入设备上 6 位配对码；**弹窗与配对码约 1 分钟失效**） |
| `_adb-tls-connect` | 「无线调试」主界面显示的「IP 地址和端口」 | `adb connect <ip:连接端口>`（配对成功后才可连）                                      |

```bash
# 1) 设备与电脑同一 Wi-Fi；设备开启「开发者选项 → 无线调试」并保持在该页面
adb mdns services          # 直接用 mDNS 找到两个端口（不要只靠眼看 IP）
# 2) 弹窗「使用配对码配对设备」打开时（快！）
adb pair <ip:配对端口>     # 提示 Enter pairing code 后输入设备上 6 位码
# 3) 连接（端口取 _adb-tls-connect 那条）
adb connect <ip:连接端口>
```

跑用例时把**连接端口**交给辅助即可自动建链（幂等；未设置则完全走 USB 老路径）：

```bash
MAMEP_ANDROID_ADB_TARGET=192.168.x.x:39019 pnpm test:e2e:android
```

实测踩坑（都会让失败看起来像「莫名卡住」）：

1. **不要用 USB 时代的 IP/端口**：同一手机换网络后 IP 会变（本次用户给的 IP 与 mDNS 广播的 IP 不同，连错地址表现为 `10061 拒绝` / `10060 超时`）。用 `adb mdns services` 拿准确 IP:端口。
2. **配对码用时方恨短**：配对弹窗/配对码约 1 分钟后失效，迟输入会得到 `error: protocol fault (couldn't read status message)`；重试需重新打开弹窗（端口也会变）。
3. **同一设备会有两个 transport**（`ip:端口` + mDNS 自动连接别名 `adb-<serial>._adb-tls-connect._tcp`）→ 裸 `adb` 命令报 `more than one device/emulator`。辅助已在建链后用官方 `ANDROID_SERIAL` 环境变量固定目标设备。
4. **没有插入 USB 时 `svc power stayon true` 不生效**（该开关只在「充电时」保持亮屏），无线调试下请改用长息屏超时，否则屏幕一熄 WebView 就被冻结、e2e 挂到超时：

```bash
adb -s <ip:端口> shell settings put system screen_off_timeout 1800000   # 30 分钟（跑完记得改回）
adb -s <ip:端口> shell input keyevent KEYCODE_WAKEUP
adb -s <ip:端口> shell wm dismiss-keyguard
```

> 设备耗电更快：跑完建议把息屏超时改回（系统设置 → 显示 → 休眠）。

实现要点（均来自实测）：

- **不用 logcat**：部分 OEM 设备 `adb logcat` 无输出 → 断言与诊断一律走 CDP
  （`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + Playwright `connectOverCDP`）。
  应用重启后 socket 名会变，辅助会自动重新解析（`/proc/net/unix`，注意抽象 socket 名带 `@` 前缀需剥离）。
- 用例内 `adb shell pm clear` 清应用数据，保证每次从干净工作区启动。
- 表格默认行**地址为空**，必须先填地址再读（否则读请求不会生成）。

## 目录

```
apps/android/
├─ capacitor.config.json          # appId / webDir / androidScheme
├─ package.json                   # Capacitor 依赖 + sync/assemble 脚本
└─ android/                       # Capacitor 生成的 Gradle 工程（MainActivity 注册 app 内插件）
   └─ app/src/main/java/com/mamep2026/app/
      ├─ MainActivity.java         # registerPlugin(MamepTransportPlugin.class)（须在 super.onCreate 前）
      └─ MamepTransportPlugin.kt   # openTcp / write / close + data/closed/error 事件（只做字节搬运）
```

> 原生插件**不放**独立 npm 包，避免 pnpm 符号链接与 Capacitor 插件自动发现之间的问题；
> 将来需要跨 app 复用或发布时再抽为独立插件包。
