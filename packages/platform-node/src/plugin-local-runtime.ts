/**
 * 同进程插件 entry 加载（Node 宿主，ADR-055，2026-09-12）。
 *
 * 与 `loadWebPluginEntry`（platform-web）对称：在宿主同一进程中 `import()` 单文件 JS 插件
 * entry（`data:text/javascript;base64,...`），提取 `manifest` 与 `activate` / `deactivate` /
 * `handleToolbarAction`。供 Electron 主进程 / VSCode Extension Host 装配「宿主侧插件执行面」
 * （用户授权同进程执行的插件，可贡献 codec / dataType / addressTransform 等**同步**能力）。
 *
 * 安全边界：同进程执行 = 插件代码在宿主进程中运行（Electron 主进程 / 扩展宿主均为完整 Node
 * 环境：文件系统 / 网络 / 子进程）。授权来自安装确认框中的显式选择（默认隔离线程）；
 * 错误隔离只能拦截 `activate` 抛错，无法拦截死循环 / 内存耗尽（见 ADR-055）。
 *
 * 分层：本模块**不**依赖 serialport / Electron / vscode（经子路径 `@mamep2026/platform-node/plugin`
 * 引用，避免把串口原生绑定打进宿主 bundle）。
 */
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import type { PluginLocalEntry } from "@mamep2026/plugin-api";

function entryError(technicalMessage: string) {
  return createMamepError({
    code: "PLUGIN_LOAD_FAILED",
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.pluginLoadFailed",
    technicalMessage,
  });
}

/** 在宿主同进程中加载插件 entry（entrySource = 单文件 JS 源码，须自包含）。 */
export async function loadNodePluginEntry(
  entrySource: string,
): Promise<Result<PluginLocalEntry>> {
  try {
    const dataUrl = `data:text/javascript;base64,${Buffer.from(entrySource, "utf8").toString("base64")}`;
    const module = (await import(/* @vite-ignore */ dataUrl)) as Record<
      string,
      unknown
    >;
    const activate = module.activate;
    if (typeof activate !== "function" || module.manifest === undefined) {
      return fail(
        entryError("plugin entry must export `manifest` and `activate(ctx)`"),
      );
    }
    const deactivate = module.deactivate;
    const handleToolbarAction = module.handleToolbarAction;
    // 结构化收窄：只保留已知执行面（不把任意导出带出加载边界）。
    return ok({
      manifest: module.manifest,
      activate: (activate as PluginLocalEntry["activate"]).bind(module),
      ...(typeof deactivate === "function"
        ? {
            deactivate: (
              deactivate as NonNullable<PluginLocalEntry["deactivate"]>
            ).bind(module),
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
    return fail(entryError(err instanceof Error ? err.message : String(err)));
  }
}
