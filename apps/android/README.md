# Mamep2026 Android 客户端（Capacitor 容器）

第四平台的容器工程（ADR-050）：**同一份共享 UI** 跑在 Android WebView 里，平台差异只体现在
`packages/platform-android`（TS 适配层）与 `android/app/src/main/java/.../MamepTransportPlugin.kt`（原生通信插件）。

- 页面来源：`apps/web` 的 `--mode android` 产物（`apps/web/dist-android/`，Capacitor `webDir` 指向它）
- 应用标识：`appId = com.mamep2026.app`、`appName = Mamep2026`
- 页面 URL：`https://localhost/`（Capacitor `androidScheme: "https"` → 安全上下文）
- Phase 1 能力：**Modbus TCP**（原生 socket）；Phase 2 能力：**USB-RS485 串口**（USB Host + `usb-serial-for-android`）

## USB 串口（Phase 2）

- 依赖：`com.github.mik3y:usb-serial-for-android:3.11.0`（**MIT**），**仅在 JitPack 发布** →
  `android/build.gradle` 的 `allprojects.repositories` 已加 `maven { url 'https://jitpack.io' }`；版本在 `variables.gradle`
  （`usbSerialForAndroidVersion`）。**首次构建需能访问 jitpack.io**（离线/受限网络会解析失败）。
- 覆盖芯片：FTDI（FT232R/H、FT2232H、FT4232H、FT230X/231X/234XD）、Prolific PL2303、Silabs CP210x、
  Qinheng CH340/CH341A，以及通用 CDC/ACM（CH343、CH9102、MCP2221、Arduino 等）。
- 权限：连接时若无权限会调 `UsbManager.requestPermission`（系统弹窗），最长等 30s；拒绝 → `errors.serialPermissionDenied`。
  重新插拔后需再次授权（Android 语义）。
- 读回聚合：原生侧按 **10ms 空闲窗口**合并为一帧后投递（避免分片事件风暴，远小于 300ms 超时预算）。
- 参数：`baudRate / dataBits / stopBits / parity / flowControl` 直接透传；驱动不支持所请求流控时
  **按参数不支持如实报错**（不静默忽略）。
- 拔线：发 `closed(USB_DETACHED)` → 会话置 failed + 提示；**不做 USB 自动重连**（自动重连仅 TCP，ADR-035）。
- 未插设备时枚举为空列表（UI 显示空态，不是错误）。

## 构建

```bash
pnpm build:android        # web 产物 → cap sync → gradlew assembleDebug
# 产物：apps/android/android/app/build/outputs/apk/debug/app-debug.apk
```

脚本 `scripts/build-android.mjs` 会依次探测可用 JDK（`JAVA_HOME` → Android Studio JBR（仅当 ≤24）→
`%LOCALAPPDATA%\MamepJdk\jdk-21`），都不可用时给出明确指引。

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

前提：**真机 + USB 调试**（本套件不静默跳过，无设备即失败），且：

| 前置 | 原因 |
| --- | --- |
| 屏幕解锁并建议 `adb shell svc power stayon true` | 设备休眠时 OEM（vivo 等）无法弹出安装确认框 → `INSTALL_FAILED_ABORTED`；休眠还会节流 WebView |
| 允许「USB 安装」/ 首次安装时在手机上点确认 | 同上 |
| 宿主机可达（`adb reverse` 由用例负责） | TCP 用例把宿主回环端口反向转发给设备，真实字节往返经原生 socket |
| **USB-RS485 闭环用例额外前置** | ① USB 转接器插在**手机**上（OTG）；另一端接 PC 侧从站（或另一只 USB-TTL，TX↔RX 交叉 + 共地）；② PC 侧先启动 RTU 从站：`pnpm slave`（端口/波特率取 `config/connections.json`）；③ 显式开启：设 `MAMEP_ANDROID_USB_SERIAL=1`；④ 首次连接需在手机上确认 USB 授权（用例等待最长 30s）。**无硬件时该用例自动跳过**，`rtu-ui.spec.ts` 无需硬件即可跑 |
| **vivo/iQOO：安装被静默拒绝** | `adb install -r` 可能报 `INSTALL_FAILED_ABORTED: User rejected permissions` 而**手机无任何弹窗**——这是 ROM 拒绝**流式安装**。`helpers/adb.ts` 已优先用 `adb install -r --no-streaming`（push 安装）并在失败时回退；若两者都失败，检查开发者选项的「USB 安装」开关 |

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

> 原生插件**不放**独立 npm 包（Phase 1 决策）：避开 pnpm 符号链接 + Capacitor 插件自动发现的摩擦；
> 将来需要跨 app 复用或发布时再抽为独立插件包。
