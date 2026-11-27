/**
 * adb / 设备 / WebView CDP 辅助（Android e2e）。
 *
 * 设计要点（来自真机实测，见 docs/architecture/host/android/Android宿主.md）：
 * - 本机部分设备 `adb logcat` 无输出 → 断言与诊断一律走 CDP，不依赖 logcat；
 * - WebView devtools socket 名随应用重启变化 → 每次启动后重新解析并重建 forward。
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** 应用标识（与 apps/android/capacitor.config.json 一致）。 */
export const APP_ID = "com.mamep2026.app";
/** 手机侧调试端口（adb forward 到 WebView devtools socket）。 */
export const CDP_PORT = 9222;
/**
 * 可选：无线调试目标（形如 `192.168.71.35:37429`，取自设备「开发者选项 → 无线调试」）。
 *
 * Android 11+ 的「无线调试」使用随机端口且 adb 不会自动连接，设置本变量后
 * `requireDevice()` 会先 `adb connect` 并等待设备就绪。**未设置时不改变任何既有行为**
 * （USB 调试路径与之前完全一致）。
 */
export const ADB_TARGET = process.env.MAMEP_ANDROID_ADB_TARGET ?? "";
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

/** 同步等待（Node 主线程可用；避免为一次性轮询引入异步签名）。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 当前 `adb devices` 中处于 `device`（已授权）状态的序列号列表。 */
export function listDeviceSerials(): string[] {
  return adb(["devices"])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /\sdevice$/.test(line))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter((serial) => serial.length > 0);
}

/**
 * 无线调试链路：设置 `MAMEP_ANDROID_ADB_TARGET` 且设备未就绪时先 `adb connect` 再轮询等待。
 * 未设置该环境变量时为空操作（USB 调试路径零行为变化）。
 */
export function ensureDeviceConnected(timeoutMs = 20_000): void {
  if (ADB_TARGET === "") return;
  if (!listDeviceSerials().includes(ADB_TARGET)) {
    try {
      adb(["connect", ADB_TARGET]);
    } catch {
      // 已连接等场景 adb connect 可能返回非 0：以随后的 devices 轮询结果为准。
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !listDeviceSerials().includes(ADB_TARGET)) {
      sleepSync(300);
    }
    if (!listDeviceSerials().includes(ADB_TARGET)) {
      throw new Error(
        [
          `无线调试目标未就绪：${ADB_TARGET}（等待 ${timeoutMs}ms）`,
          `adb devices 输出：\n${adb(["devices"])}`,
          "处理：设备与电脑接同一 Wi-Fi → 打开「开发者选项 → 无线调试」并保持开启；",
          "首次使用需先配对：设备「使用配对码配对设备」→ `adb pair <ip:配对端口>`（配对码显示在设备屏幕上，约 1 分钟内有效）；",
          "配对成功后连接 `_adb-tls-connect` 端口：`adb connect <ip:连接端口>`（与配对端口不同）；",
          "**不确定设备 IP 时不要靠眼看**：`adb mdns services` 会直接列出该设备的 `_adb-tls-pairing` / `_adb-tls-connect` 的 IP:端口。",
          "最后把 IP:连接端口 设为 MAMEP_ANDROID_ADB_TARGET。",
        ].join("\n"),
      );
    }
  }
  // 无线调试下同一设备常有多个 transport（mDNS 自动连接别名 + `ip:端口`）→ 裸 adb 会报
  // 「more than one device/emulator」。用官方 `ANDROID_SERIAL` 环境变量固定目标设备
  // （adb 文档：`-s` 优先级高于该变量；`devices` / `connect` 不受其影响）。
  process.env.ANDROID_SERIAL = ADB_TARGET;
}

/** 要求至少一台已授权设备；否则给出明确指引（不跳过）。 */
export function requireDevice(): string {
  // 无线调试：先按 MAMEP_ANDROID_ADB_TARGET 建立链路（未设置时为空操作）。
  ensureDeviceConnected();
  const devices = listDeviceSerials();
  if (devices.length === 0) {
    throw new Error(
      [
        "未检测到 Android 设备：Android e2e 需要真机 + USB 调试 或 无线调试。",
        `adb devices 输出：\n${adb(["devices"])}`,
        "处理（USB）：连接设备 → 打开「开发者选项 → USB 调试」→ 在设备上同意调试授权。",
        "处理（无线）：打开「开发者选项 → 无线调试」→ 首次先 adb pair → 设 MAMEP_ANDROID_ADB_TARGET=<ip:端口> 后重试。",
      ].join("\n"),
    );
  }
  // 同时接了 USB 与无线时，显式指定的无线目标优先（避免选中错误设备）。
  if (ADB_TARGET !== "" && devices.includes(ADB_TARGET)) return ADB_TARGET;
  return devices[0] ?? "";
}

/**
 * 唤醒屏幕并解除非安全锁屏。
 *
 * 为何必须：**息屏时 Activity 无法获得前台焦点**（`mCurrentFocus` 会变成 keyguard / SystemUI），
 * 此时 `am start` 也不能把应用拉回前台，前台/输入相关断言会全部失真（实测）。
 */
export function ensureScreenAwake(): void {
  for (const args of [
    ["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
    ["shell", "wm", "dismiss-keyguard"],
  ]) {
    try {
      adb(args);
    } catch {
      // 唤醒/关锁屏失败不阻塞调用方（无安全锁屏或不支持该命令的设备）。
    }
  }
}

/** 异步执行 adb 命令（安装期间并发轮询用；失败时把 stdout/stderr 一并抛出）。 */
function adbAsync(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      adbBinary(),
      args,
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(
              new Error(`${stderr || stdout || error.message}`.trim()),
              { cause: error },
            ),
          );
        } else {
          resolve(`${stdout}${stderr}`.trim());
        }
      },
    );
  });
}

/** 从 uiautomator dump 的 XML 里解析「继续安装」按钮的中心坐标。 */
function installConfirmCenter(xml: string): { x: number; y: number } | null {
  const labels = ["继续安装", "仍要安装", "Install anyway", "Continue install"];
  for (const label of labels) {
    const contentDesc = xml.indexOf(`content-desc="${label}"`);
    const text = xml.indexOf(`text="${label}"`);
    const at = contentDesc === -1 ? text : contentDesc;
    if (at === -1) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml.slice(at));
    if (bounds === null) continue;
    const x1 = Number(bounds[1]);
    const y1 = Number(bounds[2]);
    const x2 = Number(bounds[3]);
    const y2 = Number(bounds[4]);
    return {
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
    };
  }
  return null;
}

/** 前台为系统安装确认框时，自动点击「继续安装」（幂等、可重入，失败不阻断）。 */
async function tapInstallConfirmationIfPresent(): Promise<void> {
  const windows = await adbAsync(["shell", "dumpsys", "window"]).catch(() => "");
  if (!windows.includes("com.android.packageinstaller")) return;

  const xml = await adbAsync([
    "exec-out",
    "uiautomator",
    "dump",
    "/dev/tty",
  ]).catch(() => "");
  const center = installConfirmCenter(xml);
  if (center === null) return;
  try {
    await adbAsync([
      "shell",
      "input",
      "tap",
      String(center.x),
      String(center.y),
    ]);
  } catch {
    // 点击失败不阻塞：下一轮继续尝试。
  }
}

/**
 * 启动 `adb install` 子进程，并在其运行期间轮询点击安装确认框。
 * 返回子进程退出码与合并输出（不在此判断成败，交由调用方处理）。
 */
function runInstallWithAutoConfirm(
  args: string[],
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(adbBinary(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let closed = false;
    child.stdout.on("data", (d) => {
      output += String(d);
    });
    child.stderr.on("data", (d) => {
      output += String(d);
    });
    child.on("error", (error) => {
      closed = true;
      reject(error);
    });
    child.on("close", (code) => {
      closed = true;
      resolve({ code, output });
    });

    void (async () => {
      while (!closed) {
        try {
          await tapInstallConfirmationIfPresent();
        } catch {
          // 单次轮询失败忽略，继续到安装进程退出为止。
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
      }
    })();
  });
}

/** 安装（或覆盖安装）debug APK，并在安装确认框出现时自动点击「继续安装」。
 *
 * 部分 OEM（如 vivo）每次 `adb install` 都会弹「未知来源安装」确认框；若未确认会
 * `INSTALL_FAILED_ABORTED: User rejected permissions`。这里先唤醒屏幕再启动安装，
 * 并发轮询前台窗口，出现确认框即自动点击（不再需要人工点继续安装）。
 */
export async function installApk(apkPath: string = APK_PATH): Promise<void> {
  if (!existsSync(apkPath)) {
    throw new Error(
      `APK 不存在：${apkPath}\n请先执行 pnpm build:android（或让 pretest 自动构建）。`,
    );
  }
  // 唤醒 + 关闭非安全锁屏：部分 OEM（vivo）在锁屏时无法展示安装确认框，会直接
  // INSTALL_FAILED_ABORTED。屏幕常亮（adb shell svc power stayon true）属设备级设置，
  // 不在此隐式修改，见 apps/android/README.md「真机 e2e 前置」。
  ensureScreenAwake();

  // 安装通道（实测）：vivo（V2303A / Android 16）会**静默拒绝流式安装**
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
      const { code, output } = await runInstallWithAutoConfirm(args);
      if (code !== 0) {
        throw new Error(
          `adb ${args.join(" ")} 失败（exit ${String(code)}）：\n${output}`,
        );
      }
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
        "  2) 保持屏幕解锁后重试，并确认自动点击「继续安装」已生效；",
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
    names.find(
      (name) => name === `webview_devtools_remote_${pid.split(/\s+/)[0]}`,
    ) ??
    names[0] ??
    null
  );
}

/** 把设备上的 WebView devtools socket 转发到宿主机 CDP 端口。 */
export function forwardDevtools(
  socketName: string,
  port: number = CDP_PORT,
): void {
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
  throw new Error(
    `等待 WebView devtools socket 超时（${timeoutMs}ms，appId=${appId}）`,
  );
}
