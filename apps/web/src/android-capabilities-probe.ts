/**
 * Android 宿主能力解析（2026-09-13，ADR-056）。
 *
 * 把「平台能力组合」（`packages/platform-android`，纯函数）与「WebView 运行时探测」
 * （`packages/platform-web`，依赖 Worker/Blob 的 DOM 能力）接在一起。
 *
 * **为什么单独一层**：`host-factories/android.ts` 是 `@capacitor/core` 的唯一加载边界，
 * jsdom 单测中导入会失败；本模块**不 import Capacitor**，故可在 node 环境单测
 * （探测注入 + 异常兜底 + 与平台能力组合的一致性）。
 */
import type { PlatformCapabilities } from "@mamep2026/domain";
import { resolveAndroidCapabilities } from "@mamep2026/platform-android";
import { probePluginExecutionSupport } from "@mamep2026/platform-web";

/** 探测端口（返回是否可用；实现不应抛出——抛出按不可用处理）。 */
export type PluginExecutionProbe = () => Promise<boolean>;

/**
 * 解析 Android 宿主的基础能力矩阵：静态部分取 `androidCapabilities`，
 * `executablePlugins` 取运行时探测结果（探测异常 / 失败一律 false，如实降级）。
 *
 * 调用方（Android Host 工厂）应在构造 `AndroidAppHost` **之前** await 本函数，
 * 使 UI 首次读取 `host.capabilities` 即拿到终值（无需额外响应式信号）。
 */
export async function resolveAndroidHostCapabilities(
  probe: PluginExecutionProbe = probePluginExecutionSupport,
): Promise<PlatformCapabilities> {
  let blobWorkerSupported: boolean;
  try {
    blobWorkerSupported = await probe();
  } catch {
    // 探测实现失败（内核异常等）：按不可用如实声明，不阻断装配。
    blobWorkerSupported = false;
  }
  return resolveAndroidCapabilities({ blobWorkerSupported });
}
