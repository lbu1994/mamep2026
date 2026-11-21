/**
 * 模态框/抽屉的统一按需模块入口。
 *
 * React.lazy 与空闲预取共享同一份 import promise，避免重复请求；预取只在首帧后
 * 的空闲时段启动，不进入入口 modulepreload。
 */

let connectionSettingsModule:
  Promise<typeof import("./components/ConnectionSettingsModal")> | undefined;
let settingsDrawerModule:
  Promise<typeof import("./components/SettingsDrawer")> | undefined;
let workspaceImportModalModule:
  Promise<typeof import("./components/WorkspaceImportModal")> | undefined;

export function loadConnectionSettingsModalModule(): Promise<
  typeof import("./components/ConnectionSettingsModal")
> {
  connectionSettingsModule ??= import("./components/ConnectionSettingsModal");
  return connectionSettingsModule;
}

export function loadSettingsDrawerModule(): Promise<
  typeof import("./components/SettingsDrawer")
> {
  settingsDrawerModule ??= import("./components/SettingsDrawer");
  return settingsDrawerModule;
}

export function loadWorkspaceImportModalModule(): Promise<
  typeof import("./components/WorkspaceImportModal")
> {
  workspaceImportModalModule ??= import("./components/WorkspaceImportModal");
  return workspaceImportModalModule;
}

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCapableScope = typeof globalThis & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * 首帧后逐个模块预取：每次空闲回调只执行一个模块，避免多个重 chunk 在同一帧
 * 完成求值。不支持 requestIdleCallback 的环境延后到低优先级定时任务。
 */
export function prefetchOverlayModulesAfterIdle(
  loaders: readonly (() => Promise<unknown>)[],
): () => void {
  const scope = globalThis as IdleCapableScope;
  let cancelled = false;
  let idleHandle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;

  const scheduleNext = (): void => {
    if (cancelled || index >= loaders.length) return;
    if (typeof scope.requestIdleCallback === "function") {
      idleHandle = scope.requestIdleCallback(runIdle, { timeout: 2_000 });
      return;
    }
    timer = setTimeout(runIdle, 1_200);
  };

  const runIdle = (deadline?: IdleDeadlineLike): void => {
    idleHandle = null;
    timer = null;
    if (cancelled || index >= loaders.length) return;
    if (
      deadline !== undefined &&
      !deadline.didTimeout &&
      deadline.timeRemaining() < 2
    ) {
      scheduleNext();
      return;
    }
    const loader = loaders[index];
    index += 1;
    if (loader === undefined) return;
    void loader()
      .catch(() => {
        // 预取失败不改变按需加载语义；真实打开时仍由 React.lazy 负责报错/重试。
      })
      .finally(scheduleNext);
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (idleHandle !== null) scope.cancelIdleCallback?.(idleHandle);
    if (timer !== null) clearTimeout(timer);
  };
}
