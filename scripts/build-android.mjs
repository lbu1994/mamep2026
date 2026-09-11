/**
 * Android 端构建（ADR-050）：web 产物（--mode android）→ Capacitor 同步 → Gradle assembleDebug。
 *
 * **JDK 约束（必读）**：Capacitor 8 模板固定 Gradle 8.14.3 + AGP 8.13，其最高只支持 Java 24；
 * Android Studio 自带的 JBR 25 会报 `Unsupported class file major version 69`
 * （Java 25 需 Gradle ≥9.1，而 AGP 8.x 只配 Gradle 8.x）。故本脚本按序探测可用 JDK，
 * 都不可用时**明确报错并给出指引**（不静默降级、不尝试自行安装）。
 *
 * 用法：node scripts/build-android.mjs [--skip-web]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ANDROID_APP = path.join(ROOT, "apps", "android");
const ANDROID_NATIVE = path.join(ANDROID_APP, "android");
const APK_PATH = path.join(
  ANDROID_NATIVE,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);

/** Android 上可用的 JDK 上限（Gradle 8.14 支持到 Java 24）。 */
const MAX_SUPPORTED_JAVA_MAJOR = 24;
const MIN_SUPPORTED_JAVA_MAJOR = 17;

function javaMajor(javaBinary) {
  const result = spawnSync(javaBinary, ["-version"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = /version "(\d+)(?:\.(\d+))?/.exec(output);
  if (match === null) return null;
  const first = Number(match[1]);
  // Java 8 及更早用 "1.8" 形式；我们的下限为 17，直接取第一段即可。
  return first === 1 ? Number(match[2] ?? 0) : first;
}

function probeJdk(candidate) {
  if (candidate === undefined || candidate === "") return null;
  const javaBinary = path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(javaBinary)) return null;
  const major = javaMajor(javaBinary);
  if (major === null) return null;
  return { home: candidate, major };
}

/** 按序探测：JAVA_HOME → Android Studio 自带 JBR（仅当版本可用）→ 固定用户目录的便携 JDK 21。 */
function resolveJdk() {
  const candidates = [
    process.env.JAVA_HOME,
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    path.join(process.env.LOCALAPPDATA ?? "", "MamepJdk", "jdk-21"),
    path.join(process.env.USERPROFILE ?? "", "MamepJdk", "jdk-21"),
  ];

  const probed = candidates.map(probeJdk).filter((jdk) => jdk !== null);
  const usable = probed.find(
    (jdk) => jdk.major >= MIN_SUPPORTED_JAVA_MAJOR && jdk.major <= MAX_SUPPORTED_JAVA_MAJOR,
  );
  if (usable !== undefined) return usable;

  const details =
    probed.length === 0
      ? "未发现任何 JDK"
      : probed.map((jdk) => `  - ${jdk.home}（Java ${jdk.major}）`).join("\n");
  throw new Error(
    [
      `未找到可用 JDK：Android 构建需要 Java ${MIN_SUPPORTED_JAVA_MAJOR}~${MAX_SUPPORTED_JAVA_MAJOR}（Gradle 8.14.3 限制）。`,
      details,
      "",
      "处理方式（任一）：",
      "  1) 把 Android Studio 的 Settings → Build Tools → Gradle → Gradle JDK 指到 JDK 17/21；",
      "  2) 安装 JDK 21 后设置 JAVA_HOME；",
      "  3) 下载便携 JDK 21 解压到 %LOCALAPPDATA%\\MamepJdk\\jdk-21：",
      "     https://mirrors.huaweicloud.com/openjdk/21/openjdk-21_windows-x64_bin.zip",
    ].join("\n"),
  );
}

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"),
  ];
  const found = candidates.find(
    (candidate) => candidate !== undefined && candidate !== "" && existsSync(candidate),
  );
  if (found === undefined) {
    throw new Error(
      "未找到 Android SDK：请设置 ANDROID_HOME（或经 Android Studio SDK Manager 安装）。",
    );
  }
  return found;
}

function run(command, args, options = {}) {
  console.log(`\n[build:android] ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", shell: process.platform === "win32", ...options });
}

const skipWeb = process.argv.includes("--skip-web");
const jdk = resolveJdk();
const sdk = resolveAndroidSdk();
console.log(`[build:android] JDK: ${jdk.home}（Java ${jdk.major}）`);
console.log(`[build:android] Android SDK: ${sdk}`);

// 图标随构建同步（2026-09-11）：mipmap 各密度由 scripts/generate-icons.mjs 从
// build/AppIcon.svg 生成（白底 + 黑色线条），避免改了源 SVG 却忘记重跑 pnpm icons
// 导致 APK 里仍是旧图标。与 dist:portable / dist:vscode 同一约定。
run("node", ["scripts/generate-icons.mjs"], { cwd: ROOT });

if (!skipWeb) {
  run("pnpm", ["--filter", "@mamep2026/web", "build:android"], { cwd: ROOT });
}

run("npx", ["cap", "sync", "android"], { cwd: ANDROID_APP });

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
run(gradlew, ["assembleDebug"], {
  cwd: ANDROID_NATIVE,
  env: {
    ...process.env,
    JAVA_HOME: jdk.home,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
  },
});

if (!existsSync(APK_PATH)) {
  const outputsDir = path.dirname(APK_PATH);
  const found = existsSync(outputsDir) ? readdirSync(outputsDir) : [];
  throw new Error(`构建产物缺失：${APK_PATH}（目录内容：${found.join(", ") || "空"}）`);
}

console.log(`\n[build:android] APK: ${APK_PATH}`);
console.log("[build:android] 安装：adb install -r <APK>；TCP e2e 需 adb reverse（见 tests/e2e-android）");
