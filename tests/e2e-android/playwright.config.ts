/**
 * Android E2E（ADR-050 Phase 1）：真机 WebView + 原生 TCP 插件闭环。
 *
 * 与三端 e2e 的差异（本平台特有，已在 ADR-050 验证记录中实测确认）：
 * - **不能用 logcat**：本机 vivo 设备 `adb logcat` 无输出（OEM 限制）→ 一律走 CDP；
 * - 通过 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 暴露 WebView 调试口，
 *   由 Playwright `chromium.connectOverCDP` 驱动（不启动本地浏览器）；
 * - 应用重启后 devtools socket 名会变，故 forward 在 beforeAll 内动态解析；
 * - 需要真机 + USB 调试：无设备时本套件失败（不静默跳过，Android e2e 明确要求设备）。
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
