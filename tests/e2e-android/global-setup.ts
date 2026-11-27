/**
 * Android e2e 一次性前置：整个测试运行只安装一次 debug APK。
 *
 * 此前每个 spec 的 `openAppSession()` 都会调用 `installApk()`，导致同一套件里
 * 每个 spec 各弹一次 vivo「未知来源安装」确认框（6 个 spec = 6 次弹窗），还会
 * 被 ROM 静默拒绝流式安装。改为 globalSetup 安装一次后，各 spec 只清数据 + 重启，
 * 不再重复安装（`pm clear` 不会卸载 APK）。
 */
import { installApk, requireDevice } from "./helpers/adb";

export default async function globalSetup(): Promise<void> {
  // 先建立无线/有线调试链路并固定 ANDROID_SERIAL，再安装（installApk 内部会唤醒屏幕）。
  requireDevice();
  await installApk();
}
