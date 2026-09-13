/**
 * 插件执行能力运行时探测（2026-09-13，ADR-056）。
 *
 * ## 为什么需要
 * 浏览器 / Electron / VSCode 静态声明 `executablePlugins: true`，但 **Android WebView 的
 * 能力随系统 WebView 版本变化**（工业平板可能长期不更新）：`new Worker(blobUrl)` 与 Worker 内
 * 对 blob entry 的动态 `import()` 可能被拦（CSP 之外还有内核行为差异）。故 Android 端在装配期
 * **实测一次**，按结果如实声明 `executablePlugins`（探测失败 → 保持 false，fail-closed）。
 *
 * ## 探测即真实运行时
 * 复用生产同一条路径（`WebPluginRemoteRuntime` + `PLUGIN_WORKER_BOOTSTRAP`），不另造副本：
 * 走「Blob Worker → Worker 内 `import(blob entry)` → 提取 manifest → 回传主线程」，因此同时覆盖
 * `worker-src 'self' blob:`（Worker 创建）与 `script-src 'self' blob:`（Worker 内动态 import）。
 * 探测用的 entry 为内置极简单文件模块（见 {@link PLUGIN_EXECUTION_PROBE_ENTRY}），
 * 无论成败都 `dispose()`（terminate Worker，不留线程）。
 *
 * ## 失败语义
 * 永不抛出：Worker 创建失败 / entry 加载失败 / 超时一律返回 `false`（调用方据此如实降级）。
 */
import type { Clock } from "@mamep2026/communication";
import { createUnavailableCommunicationApi } from "@mamep2026/plugin-api";
import {
  WebPluginRemoteRuntime,
  type PluginCommunicationApiFactory,
  type PluginWorkerFactory,
} from "./plugin-remote-runtime";
import { browserClock } from "./real-clock";

/**
 * 探测用极简单文件插件 entry（自包含、无外部 import、`activate` 为空实现）。
 * 与真实插件一样经 Blob URL 被 Worker 动态 `import()`——`manifest` 缺失或 import 被拦即探测失败。
 */
export const PLUGIN_EXECUTION_PROBE_ENTRY = `
export const manifest = {
  id: "mamep-plugin-runtime-probe",
  name: "Mamep Plugin Runtime Probe",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "Internal capability probe (not a real plugin).",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: [],
  contributes: {}
};

export function activate() {}
`;

/** 探测默认超时（ms）：真机典型 <50ms，取值宽松以避免低端设备误判为不支持。 */
export const PLUGIN_EXECUTION_PROBE_TIMEOUT_MS = 3000;

/** 探测期间插件不会发起通信调用；提供兜底实现以满足运行时构造契约。 */
const unavailableCommunication: PluginCommunicationApiFactory = () =>
  createUnavailableCommunicationApi();

export interface PluginExecutionProbeOptions {
  /** Worker 工厂（单测注入 fake；缺省用全局 `Worker`）。 */
  workerFactory?: PluginWorkerFactory | undefined;
  /** 通信面工厂（缺省为不可用兜底）。 */
  communicationApiFactory?: PluginCommunicationApiFactory | undefined;
  /** 超时（ms，缺省 {@link PLUGIN_EXECUTION_PROBE_TIMEOUT_MS}）。 */
  timeoutMs?: number | undefined;
  /** 计时端口（单测注入 Virtual Clock；缺省真实时钟）。 */
  clock?: Clock | undefined;
}

/** 超时句柄：`promise` 在超时时以 null 落定，`cancel` 幂等取消计时。 */
interface ProbeTimeout {
  promise: Promise<null>;
  cancel: () => void;
}

/**
 * 启动探测超时（时钟经端口注入，单测可用 Virtual Clock）。
 * 句柄经可变对象承载——避免 `let handle: X | null` 在闭包赋值后触发 TS 的收窄误判。
 */
function startProbeTimeout(clock: Clock, timeoutMs: number): ProbeTimeout {
  const handle: { cancel: () => void } = { cancel: () => undefined };
  const promise = new Promise<null>((resolve) => {
    const scheduled = clock.schedule(() => resolve(null), timeoutMs);
    handle.cancel = () => scheduled.cancel();
  });
  return { promise, cancel: () => handle.cancel() };
}

/**
 * 探测当前环境能否加载可执行插件（Blob Worker + Worker 内 blob entry 动态 import）。
 * @returns `true` = 可用（可翻转 `executablePlugins`）；`false` = 不可用 / 超时 / 异常。
 */
export async function probePluginExecutionSupport(
  options: PluginExecutionProbeOptions = {},
): Promise<boolean> {
  const clock = options.clock ?? browserClock;
  const timeoutMs = options.timeoutMs ?? PLUGIN_EXECUTION_PROBE_TIMEOUT_MS;
  const runtime = new WebPluginRemoteRuntime(
    PLUGIN_EXECUTION_PROBE_ENTRY,
    options.communicationApiFactory ?? unavailableCommunication,
    options.workerFactory !== undefined
      ? { workerFactory: options.workerFactory }
      : {},
  );

  const timeout = startProbeTimeout(clock, timeoutMs);
  try {
    const outcome = await Promise.race([runtime.load(), timeout.promise]);
    return outcome !== null && outcome.ok;
  } catch {
    // 探测必须永不抛出：任何异常都按「不可用」如实降级。
    return false;
  } finally {
    timeout.cancel();
    await runtime.dispose();
  }
}
