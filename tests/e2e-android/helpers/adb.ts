/**
 * adb / 设备 / WebView CDP 辅助（ADR-050 Android e2e）。
 *
 * 设计要点（来自 Phase 0 实测，见 docs/adr-050-验证记录.md）：
 * - 本机部分设备 `adb logcat` 无输出 → 断言与诊断一律走 CDP，不依赖 logcat；
 * - WebView devtools socket 名随应用重启变化 → 每次启动后重新解析并重建 forward。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** 应用标识（与 apps/android/capacitor.config.json 一致）。 */
export const APP_ID = "com.mamep2026.app";
/** 手机侧调试端口（adb forward 到 WebView devtools socket）。 */
export const CDP_PORT = 9222;
/** 仓库根（本文件位于 tests/e2e-android/helpers/）。 */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
/** debug APK 产物路径（scripts/build-android.mjs 产出）。 */
export const APK_PATH = path.join(
  REPO_ROOT,
  "apps",
  "android",
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);

/**
 * adb 可执行文件。探测顺序与 `scripts/build-android.mjs` 一致（不依赖用户 shell 环境变量）：
 * ANDROID_HOME → ANDROID_SDK_ROOT → Windows 默认 `%LOCALAPPDATA%\Android\Sdk` → PATH 中的 adb。
 */
function adbBinary(): string {
  const explicit = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const localAppData = process.env.LOCALAPPDATA;
  const defaults = [
    explicit,
    localAppData === undefined
      ? undefined
      : path.join(localAppData, "Android", "Sdk"),
  ];
  for (const sdk of defaults) {
    if (sdk === undefined) continue;
    for (const name of ["adb.exe", "adb"]) {
      const candidate = path.join(sdk, "platform-tools", name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "adb";
}

/** 执行 adb 命令（失败即抛错——Android e2e 不静默跳过）。 */
export function adb(args: string[]): string {
  return execFileSync(adbBinary(), args, { encoding: "utf8" }).trim();
}

/** 要求至少一台已授权设备；否则给出明确指引（不跳过）。 */
export function requireDevice(): string {
  const output = adb(["devices"]);
  const devices = output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith("device"));
  if (devices.length === 0) {
    throw new Error(
      [
        "未检测到 Android 设备：Android e2e 需要真机 + USB 调试。",
        `adb devices 输出：\n${output}`,
        "处理：连接设备 → 打开「开发者选项 → USB 调试」→ 在设备上同意调试授权。",
      ].join("\n"),
    );
  }
  return devices[0]?.split(/\s+/)[0] ?? "";
}

/** 安装（或覆盖安装）debug APK。
 *
 * 部分 OEM（如 vivo）在锁屏 / 未授权「通过 USB 安装」时会弹确认框，未确认即
 * `INSTALL_FAILED_ABORTED: User rejected permissions`。这里先唤醒屏幕再安装，
 * 并把失败原因翻译成人可执行的指引（不静默跳过，也不代替用户点确认）。
 */
export function installApk(apkPath: string = APK_PATH): void {
  if (!existsSync(apkPath)) {
    throw new Error(
      `APK 不存在：${apkPath}\n请先执行 pnpm build:android（或让 pretest 自动构建）。`,
    );
  }
  // 唤醒 + 关闭非安全锁屏：部分 OEM（vivo）在锁屏时无法展示安装确认框，会直接
  // INSTALL_FAILED_ABORTED。屏幕常亮（adb shell svc power stayon true）属设备级设置，
  // 不在此隐式修改，见 apps/android/README.md「真机 e2e 前置」。
  for (const args of [
    ["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
    ["shell", "wm", "dismiss-keyguard"],
  ]) {
    try {
      adb(args);
    } catch {
      // 唤醒/关锁屏失败不阻塞安装尝试（无安全锁屏的设备本就不需要）。
    }
  }

  // 安装通道（2026-09-10 实测）：vivo（V2303A / Android 16）会**静默拒绝流式安装**
  // （`adb install -r` → INSTALL_FAILED_ABORTED: User rejected permissions，且手机无任何弹窗），
  // 改用 `--no-streaming`（先 push 再安装，即 "Performing Push Install"）即可直接成功。
  // 先试非流式，失败再回退默认流式通道（其他 OEM 可能相反）。
  const attempts: string[][] = [
    ["install", "-r", "--no-streaming", apkPath],
    ["install", "-r", apkPath],
  ];
  let lastError: unknown = null;
  for (const args of attempts) {
    try {
      adb(args);
      return;
    } catch (cause) {
      lastError = cause;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  if (message.includes("INSTALL_FAILED_ABORTED")) {
    throw new Error(
      [
        "设备拒绝了 APK 安装（INSTALL_FAILED_ABORTED: User rejected permissions）。",
        "已尝试非流式与流式两种通道。处理（任选，需在手机上操作）：",
        "  1) 开发者选项 → 打开「USB 安装」/「通过 USB 安装应用」（vivo/iQOO 常见，关闭时无弹窗直接拒绝）；",
        "  2) 保持屏幕解锁后重试，并在手机上点击确认「允许/继续安装」；",
        "  3) 备选：`adb push <apk> /data/local/tmp/` 后手动用文件管理器安装。",
        `原始错误：${message}`,
      ].join("\n"),
      { cause: lastError },
    );
  }
  throw lastError;
}

export function forceStopApp(): void {
  adb(["shell", "am", "force-stop", APP_ID]);
}

/** 清空应用数据（IndexedDB 工作区/插件持久化），保证每次 e2e 从干净状态启动。 */
export function clearAppData(appId: string = APP_ID): void {
  adb(["shell", "pm", "clear", appId]);
}

export function launchApp(): void {
  adb(["shell", "am", "start", "-n", `${APP_ID}/.MainActivity`]);
}

/** 建立反向端口转发（设备 localhost:<port> → 宿主机 <port>）。 */
export function reverseTcp(port: number): void {
  adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
}

export function removeAllReverses(): void {
  try {
    adb(["reverse", "--remove-all"]);
  } catch {
    // 无反向转发时 adb 会报错：清理阶段忽略。
  }
}

export function removeAllForwards(): void {
  try {
    adb(["forward", "--remove-all"]);
  } catch {
    // 同上。
  }
}

/** 解析当前应用的 WebView devtools socket 名（形如 webview_devtools_remote_12345）。 */
export function resolveWebviewSocket(appId: string = APP_ID): string | null {
  let pid = "";
  try {
    pid = adb(["shell", "pidof", appId]);
  } catch {
    return null;
  }
  if (pid === "") return null;

  // 先按 pid 精确匹配，找不到再退回任意 webview devtools socket（进程重启竞态）。
  // 注意：/proc/net/unix 里抽象 socket 名带 `@` 前缀（如 @webview_devtools_remote_123），
  // 而 `adb forward localabstract:` 需要不带该前缀的名字，故解析时必须剥离。
  const sockets = adb(["shell", "cat", "/proc/net/unix"]);
  const names = sockets
    .split(/\r?\n/)
    .map((line) => (line.split(/\s+/).pop() ?? "").replace(/^@/, ""))
    .filter((name) => name.startsWith("webview_devtools_remote_"));
  return (
    names.find((name) => name === `webview_devtools_remote_${pid.split(/\s+/)[0]}`) ??
    names[0] ??
    null
  );
}

/** 把设备上的 WebView devtools socket 转发到宿主机 CDP 端口。 */
export function forwardDevtools(socketName: string, port: number = CDP_PORT): void {
  adb(["forward", `tcp:${port}`, `localabstract:${socketName}`]);
}

/** 轮询直到 WebView devtools socket 出现（应用冷启动需要时间）。 */
export async function waitForWebviewSocket(
  timeoutMs = 30_000,
  appId: string = APP_ID,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const socket = resolveWebviewSocket(appId);
    if (socket !== null) return socket;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待 WebView devtools socket 超时（${timeoutMs}ms，appId=${appId}）`);
}
