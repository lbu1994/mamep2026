/**
 * 同进程插件 entry 加载（ADR-054，2026-09-12）。
 *
 * 与 `WebPluginRemoteRuntime`（隔离线程，Worker）对称：本加载器在**宿主同一进程**中
 * `import()` 单文件 JS 插件 entry（Blob URL），提取 `manifest` 与 `activate` /
 * `deactivate` / `handleToolbarAction`。用于「用户显式授权同进程执行」的插件
 * （可贡献 codec/dataType/addressTransform 等**同步**能力——函数不可跨线程/序列化）。
 *
 * 安全边界：同进程执行 = 插件代码获得与应用同等权限（渲染端含 DOM / IndexedDB 访问）。
 * 由安装确认框中的显式授权决定（默认走隔离线程）；平台侧加载器只做「加载 + 形状校验」。
 */
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import type { PluginLocalEntry } from "@mamep2026/plugin-api";

function entryError(code: string, technicalMessage: string) {
  return createMamepError({
    code,
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey:
      code === "PLUGIN_LOAD_FAILED"
        ? "errors.pluginLoadFailed"
        : "errors.pluginManifestInvalid",
    technicalMessage,
  });
}

/**
 * 在宿主同进程中加载插件 entry（entrySource = 单文件 JS 源码，须自包含）。
 * `load()` 语义对齐 `PluginRemoteRuntime.load()`：返回校验过的 entry 形状，不激活。
 */
export async function loadWebPluginEntry(
  entrySource: string,
): Promise<Result<PluginLocalEntry>> {
  let scriptUrl: string | null = null;
  try {
    scriptUrl = URL.createObjectURL(
      new Blob([entrySource], { type: "text/javascript" }),
    );
    // 动态 import Blob URL：Vite 无法静态分析该说明符（运行时产物），显式忽略。
    const module = (await import(
      /* @vite-ignore */ scriptUrl
    )) as Record<string, unknown>;
    const activate = module.activate;
    if (typeof activate !== "function" || module.manifest === undefined) {
      return fail(
        entryError(
          "PLUGIN_LOAD_FAILED",
          "plugin entry must export `manifest` and `activate(ctx)`",
        ),
      );
    }
    const deactivate = module.deactivate;
    const handleToolbarAction = module.handleToolbarAction;
    // 结构化收窄：只保留已知的执行面（避免把任意导出带出加载边界）。
    return ok({
      manifest: module.manifest,
      activate: (activate as PluginLocalEntry["activate"]).bind(module),
      ...(typeof deactivate === "function"
        ? {
            deactivate: (deactivate as NonNullable<
              PluginLocalEntry["deactivate"]
            >).bind(module),
          }
        : {}),
      ...(typeof handleToolbarAction === "function"
        ? {
            handleToolbarAction: (
              handleToolbarAction as NonNullable<
                PluginLocalEntry["handleToolbarAction"]
              >
            ).bind(module),
          }
        : {}),
    });
  } catch (err) {
    return fail(
      entryError(
        "PLUGIN_LOAD_FAILED",
        err instanceof Error ? err.message : String(err),
      ),
    );
  } finally {
    if (scriptUrl !== null) URL.revokeObjectURL(scriptUrl);
  }
}
