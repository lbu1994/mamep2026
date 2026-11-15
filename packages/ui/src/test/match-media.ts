/**
 * jsdom 的 `matchMedia` 桩（响应式布局需要可切换的断点）。
 *
 * jsdom 不实现 `window.matchMedia`；本桩提供**可配置**的匹配结果与变更通知，
 * 使断点相关分支（移动布局 / 桌面布局）都能在单测里覆盖。
 * 默认所有查询匹配 `false`（与之前的固定桩一致，既有用例零影响）。
 */

const matchesByQuery = new Map<string, boolean>();
const listenersByQuery = new Map<string, Set<() => void>>();

function listenersOf(query: string): Set<() => void> {
  const existing = listenersByQuery.get(query);
  if (existing !== undefined) return existing;
  const created = new Set<() => void>();
  listenersByQuery.set(query, created);
  return created;
}

/** 设置某个媒体查询的匹配结果，并通知已注册的监听器（模拟窗口尺寸变化）。 */
export function setMatchMediaMatches(query: string, matches: boolean): void {
  matchesByQuery.set(query, matches);
  for (const listener of [...listenersOf(query)]) listener();
}

/** 复位（在 `afterEach` 中调用，避免用例之间互相污染）。 */
export function resetMatchMediaStub(): void {
  matchesByQuery.clear();
  listenersByQuery.clear();
}

/** 安装桩（幂等；`setup.ts` 在测试启动时调用）。 */
export function installMatchMediaStub(): void {
  if (typeof window === "undefined") return;
  const mediaQueryList = (query: string): MediaQueryList => {
    const list = {
      get matches(): boolean {
        return matchesByQuery.get(query) ?? false;
      },
      media: query,
      onchange: null,
      addListener: (listener: () => void) => {
        listenersOf(query).add(listener);
      },
      removeListener: (listener: () => void) => {
        listenersOf(query).delete(listener);
      },
      addEventListener: (_type: string, listener: () => void) => {
        listenersOf(query).add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listenersOf(query).delete(listener);
      },
      dispatchEvent: () => false,
    };
    return list as unknown as MediaQueryList;
  };
  window.matchMedia = mediaQueryList as unknown as typeof window.matchMedia;
}
