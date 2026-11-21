/**
 * 浏览器本地 Web 性能采样（默认关闭、零上传）。
 *
 * 仅记录性能时序、浏览器能力、视口和工作区“行数”；不读取或保存行内容、地址、
 * 设备报文、插件数据或用户标识。数据只写当前 origin 的 localStorage，并由用户在
 * Settings 中主动导出 JSON。
 *
 * 启动阶段由 App 建立平台判定后初始化，以便只在浏览器运行时启用。若用户已在上一次
 * 加载中打开采样，初始化会使用 `buffered: true` 补收当前导航已经发生的 LCP / Event
 * Timing 条目；页面中途首次打开采样则不回看此前的交互。
 */
import type {
  FieldPerformanceCacheMode,
  FieldPerformanceNetworkProfile,
  FieldPerformanceSettings,
  FieldPerformanceZoomPercent,
} from "@mamep2026/ui/runtime";
import {
  FIELD_PERFORMANCE_STORAGE_KEY,
  FIELD_PERFORMANCE_STORAGE_VERSION,
} from "./field-performance-config";

export {
  FIELD_PERFORMANCE_STORAGE_KEY,
  FIELD_PERFORMANCE_STORAGE_VERSION,
} from "./field-performance-config";
export const FIELD_PERFORMANCE_REPORT_SCHEMA_VERSION = 1;
export const FIELD_PERFORMANCE_MAX_SESSIONS = 40;
export const FIELD_PERFORMANCE_MAX_INTERACTIONS = 250;
export const FIELD_PERFORMANCE_INTERACTIVE_BUDGET_MS = 3_000;
export const FIELD_PERFORMANCE_INP_BUDGET_MS = 200;

type FieldTheme = "light" | "dark" | "unknown";

export interface FieldPerformanceInteraction {
  interactionId: number;
  durationMs: number;
}

export interface FieldPerformanceSession {
  collectedAt: string;
  appVersion: string;
  cacheMode: FieldPerformanceCacheMode;
  declaredZoomPercent: FieldPerformanceZoomPercent;
  networkProfile: FieldPerformanceNetworkProfile;
  environment: {
    userAgent: string;
    language: string;
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
  };
  context: {
    theme: FieldTheme;
    activeSheetRows: number;
    totalWorkspaceRows: number;
  };
  metrics: {
    lcpMs: number | null;
    inpMs: number | null;
    interactionCount: number;
    cls: number;
    ttfbMs: number | null;
    startupInteractiveMs: number | null;
    longTaskCount: number;
    maxLongTaskMs: number;
  };
  interactions: FieldPerformanceInteraction[];
}

export interface FieldPerformanceReport {
  schemaVersion: typeof FIELD_PERFORMANCE_REPORT_SCHEMA_VERSION;
  kind: "mamep-local-web-performance";
  generatedAt: string;
  privacy: {
    anonymous: true;
    uploaded: false;
    containsWorkspaceContent: false;
    containsDeviceMessages: false;
  };
  targets: {
    startupInteractiveMs: number;
    inpMs: number;
  };
  inpMethod: "event-timing-p98-interaction-max";
  sessions: FieldPerformanceSession[];
}

interface PersistedFieldPerformanceState {
  version: typeof FIELD_PERFORMANCE_STORAGE_VERSION;
  enabled: boolean;
  cacheMode: FieldPerformanceCacheMode;
  zoomPercent: FieldPerformanceZoomPercent;
  networkProfile: FieldPerformanceNetworkProfile;
  sessions: FieldPerformanceSession[];
}

interface InteractionTimingEntry {
  interactionId?: number;
  duration?: number;
}

interface LayoutShiftEntry {
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
}

interface LongTaskEntry {
  duration?: number;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

const listeners = new Set<() => void>();
const observers: PerformanceObserver[] = [];

let initialized = false;
let supported = false;
let enabled = false;
let cacheMode: FieldPerformanceCacheMode = "cold";
let zoomPercent: FieldPerformanceZoomPercent = 100;
let networkProfile: FieldPerformanceNetworkProfile = "local";
let sessions: FieldPerformanceSession[] = [];
let snapshot: FieldPerformanceSettings | null = null;
let current: FieldPerformanceSession | null = null;
let currentInteractionDurations = new Map<number, number>();
let currentPersistedIndex = -1;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let clsValue = 0;
let clsWindowValue = 0;
let clsWindowStart = 0;
let clsLastEntry = 0;
let longTaskCount = 0;
let maxLongTaskMs = 0;
let workspaceContext = {
  activeSheetRows: 0,
  totalWorkspaceRows: 0,
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.max(0, Math.floor(number));
}

function currentTheme(): FieldTheme {
  const theme = document.documentElement.dataset.mamepTheme;
  return theme === "light" || theme === "dark" ? theme : "unknown";
}

function resolveStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function reportNow(): string {
  return new Date().toISOString();
}

function appVersion(): string {
  try {
    return __APP_VERSION__;
  } catch {
    return "unknown";
  }
}

function cloneSession(
  session: FieldPerformanceSession,
): FieldPerformanceSession {
  return {
    ...session,
    environment: { ...session.environment },
    context: { ...session.context },
    metrics: { ...session.metrics },
    interactions: session.interactions.map((entry) => ({ ...entry })),
  };
}

/**
 * 从 Event Timing 条目估算 INP：同一 interactionId 取最长事件，再取交互时长的
 * P98（少于 50 个交互等价于最长交互）。不记录事件目标或页面文本。
 */
export function estimateInteractionToNextPaintMs(
  samples: readonly FieldPerformanceInteraction[],
): number | null {
  if (samples.length === 0) return null;
  const byInteraction = new Map<number, number>();
  for (const sample of samples) {
    if (
      !Number.isInteger(sample.interactionId) ||
      sample.interactionId <= 0 ||
      !Number.isFinite(sample.durationMs) ||
      sample.durationMs < 0
    ) {
      continue;
    }
    byInteraction.set(
      sample.interactionId,
      Math.max(byInteraction.get(sample.interactionId) ?? 0, sample.durationMs),
    );
  }
  if (byInteraction.size === 0) return null;
  const durations = [...byInteraction.values()].sort(
    (left, right) => left - right,
  );
  if (durations.length < 50) return durations.at(-1) ?? null;
  const index = Math.min(
    durations.length - 1,
    Math.floor(durations.length * 0.98),
  );
  return durations[index] ?? null;
}

function validCacheMode(value: unknown): value is FieldPerformanceCacheMode {
  return value === "cold" || value === "warm";
}

function validZoomPercent(
  value: unknown,
): value is FieldPerformanceZoomPercent {
  return value === 100 || value === 125 || value === 150;
}

function validNetworkProfile(
  value: unknown,
): value is FieldPerformanceNetworkProfile {
  return (
    value === "local" ||
    value === "wifi" ||
    value === "fast-4g" ||
    value === "slow-4g" ||
    value === "3g"
  );
}

function parseInteraction(value: unknown): FieldPerformanceInteraction | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const interactionId = finiteNumber(row.interactionId);
  const durationMs = finiteNumber(row.durationMs);
  if (
    interactionId === null ||
    !Number.isInteger(interactionId) ||
    interactionId <= 0 ||
    durationMs === null ||
    durationMs < 0
  ) {
    return null;
  }
  return { interactionId, durationMs };
}

function optionalObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSession(value: unknown): FieldPerformanceSession | null {
  const row = optionalObject(value);
  if (row === null) return null;
  const environment = optionalObject(row.environment);
  const context = optionalObject(row.context);
  const metrics = optionalObject(row.metrics);
  if (
    environment === null ||
    context === null ||
    metrics === null ||
    typeof row.collectedAt !== "string" ||
    typeof row.appVersion !== "string" ||
    !validCacheMode(row.cacheMode) ||
    !validZoomPercent(row.declaredZoomPercent) ||
    !validNetworkProfile(row.networkProfile)
  ) {
    return null;
  }
  const theme = context.theme;
  if (theme !== "light" && theme !== "dark" && theme !== "unknown") return null;
  const userAgent = environment.userAgent;
  const language = environment.language;
  if (typeof userAgent !== "string" || typeof language !== "string")
    return null;
  const interactionRows = Array.isArray(row.interactions)
    ? row.interactions
        .map(parseInteraction)
        .filter((entry): entry is FieldPerformanceInteraction => entry !== null)
        .slice(0, FIELD_PERFORMANCE_MAX_INTERACTIONS)
    : [];
  return {
    collectedAt: row.collectedAt,
    appVersion: row.appVersion,
    cacheMode: row.cacheMode,
    declaredZoomPercent: row.declaredZoomPercent,
    networkProfile: row.networkProfile,
    environment: {
      userAgent,
      language,
      hardwareConcurrency: finiteNumber(environment.hardwareConcurrency),
      deviceMemoryGb: finiteNumber(environment.deviceMemoryGb),
      viewportWidth: nonNegativeInteger(environment.viewportWidth),
      viewportHeight: nonNegativeInteger(environment.viewportHeight),
      devicePixelRatio: Math.max(
        0,
        finiteNumber(environment.devicePixelRatio) ?? 0,
      ),
    },
    context: {
      theme,
      activeSheetRows: nonNegativeInteger(context.activeSheetRows),
      totalWorkspaceRows: nonNegativeInteger(context.totalWorkspaceRows),
    },
    metrics: {
      lcpMs: finiteNumber(metrics.lcpMs),
      inpMs: finiteNumber(metrics.inpMs),
      interactionCount: nonNegativeInteger(metrics.interactionCount),
      cls: Math.max(0, finiteNumber(metrics.cls) ?? 0),
      ttfbMs: finiteNumber(metrics.ttfbMs),
      startupInteractiveMs: finiteNumber(metrics.startupInteractiveMs),
      longTaskCount: nonNegativeInteger(metrics.longTaskCount),
      maxLongTaskMs: Math.max(0, finiteNumber(metrics.maxLongTaskMs) ?? 0),
    },
    interactions: interactionRows,
  };
}

/** 解析并校验本地采样状态；任何损坏字段都退回空状态，不阻断应用。 */
export function parsePersistedFieldPerformanceState(
  raw: string | null,
): PersistedFieldPerformanceState | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const row = optionalObject(parsed);
  if (
    row === null ||
    row.version !== FIELD_PERFORMANCE_STORAGE_VERSION ||
    typeof row.enabled !== "boolean" ||
    !validCacheMode(row.cacheMode) ||
    !validZoomPercent(row.zoomPercent) ||
    !validNetworkProfile(row.networkProfile)
  ) {
    return null;
  }
  const safeSessions = Array.isArray(row.sessions)
    ? row.sessions
        .map(parseSession)
        .filter((entry): entry is FieldPerformanceSession => entry !== null)
        .slice(0, FIELD_PERFORMANCE_MAX_SESSIONS)
    : [];
  return {
    version: FIELD_PERFORMANCE_STORAGE_VERSION,
    enabled: row.enabled,
    cacheMode: row.cacheMode,
    zoomPercent: row.zoomPercent,
    networkProfile: row.networkProfile,
    sessions: safeSessions,
  };
}

function readPersistedState(): PersistedFieldPerformanceState | null {
  const storage = resolveStorage();
  if (storage === null) return null;
  try {
    return parsePersistedFieldPerformanceState(
      storage.getItem(FIELD_PERFORMANCE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function persistState(): void {
  const storage = resolveStorage();
  if (storage === null) return;
  const payload: PersistedFieldPerformanceState = {
    version: FIELD_PERFORMANCE_STORAGE_VERSION,
    enabled,
    cacheMode,
    zoomPercent,
    networkProfile,
    sessions: sessions.slice(0, FIELD_PERFORMANCE_MAX_SESSIONS),
  };
  try {
    storage.setItem(FIELD_PERFORMANCE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 隐私模式、配额或策略禁用时保持内存采集，不阻断应用。
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function updateSnapshot(): void {
  snapshot = supported
    ? {
        enabled,
        cacheMode,
        zoomPercent,
        networkProfile,
        sessionCount: sessions.length,
        setEnabled,
        setCacheMode,
        setZoomPercent,
        setNetworkProfile,
        exportReport,
        clearSessions,
      }
    : null;
  notify();
}

function updateLayoutShift(entry: LayoutShiftEntry): void {
  if (entry.hadRecentInput === true) return;
  const value = finiteNumber(entry.value);
  const start = finiteNumber(entry.startTime);
  if (value === null || start === null || value <= 0) return;
  if (
    clsWindowValue === 0 ||
    start - clsLastEntry > 1_000 ||
    start - clsWindowStart > 5_000
  ) {
    clsWindowValue = value;
    clsWindowStart = start;
  } else {
    clsWindowValue += value;
  }
  clsLastEntry = start;
  clsValue = Math.max(clsValue, clsWindowValue);
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    checkpointCurrentSession();
  }, 750);
}

function observe(
  type: string,
  buffered: boolean,
  onEntry: (entry: PerformanceEntry) => void,
  durationThreshold?: number,
): void {
  if (
    !Array.isArray(PerformanceObserver.supportedEntryTypes) ||
    !PerformanceObserver.supportedEntryTypes.includes(type)
  ) {
    return;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      if (!enabled || current === null) return;
      for (const entry of list.getEntries()) onEntry(entry);
      schedulePersist();
    });
    observer.observe(
      durationThreshold === undefined
        ? { type, buffered }
        : ({
            type,
            buffered,
            durationThreshold,
          } as PerformanceObserverInit & { durationThreshold: number }),
    );
    observers.push(observer);
  } catch {
    // 个别浏览器声明支持但拒绝某个选项时，其余指标继续采集。
  }
}

function collectInteraction(entry: PerformanceEntry): void {
  const timing = entry as PerformanceEntry & InteractionTimingEntry;
  const interactionId = finiteNumber(timing.interactionId);
  const duration = finiteNumber(timing.duration);
  if (
    interactionId === null ||
    !Number.isInteger(interactionId) ||
    interactionId <= 0 ||
    duration === null ||
    duration < 0 ||
    (!currentInteractionDurations.has(interactionId) &&
      currentInteractionDurations.size >= FIELD_PERFORMANCE_MAX_INTERACTIONS)
  ) {
    return;
  }
  currentInteractionDurations.set(
    interactionId,
    Math.max(currentInteractionDurations.get(interactionId) ?? 0, duration),
  );
}

function markStartupInteractive(): void {
  if (current === null) return;
  const mark = performance.getEntriesByName(
    "mamep:startup:interactive",
    "mark",
  )[0];
  if (mark !== undefined) {
    current.metrics.startupInteractiveMs = mark.startTime;
  }
}

function refreshCurrentMetrics(): void {
  if (current === null) return;
  markStartupInteractive();
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  current.metrics.ttfbMs =
    navigation !== undefined && navigation.responseStart > 0
      ? navigation.responseStart
      : null;
  const interactions = [...currentInteractionDurations.entries()].map(
    ([interactionId, durationMs]) => ({ interactionId, durationMs }),
  );
  current.interactions = interactions.slice(
    0,
    FIELD_PERFORMANCE_MAX_INTERACTIONS,
  );
  current.metrics.interactionCount = currentInteractionDurations.size;
  current.metrics.inpMs = estimateInteractionToNextPaintMs(interactions);
  current.metrics.cls = clsValue;
  current.metrics.longTaskCount = longTaskCount;
  current.metrics.maxLongTaskMs = maxLongTaskMs;
  current.metrics.lcpMs = current.metrics.lcpMs ?? null;
  current.cacheMode = cacheMode;
  current.declaredZoomPercent = zoomPercent;
  current.networkProfile = networkProfile;
  current.context = {
    theme: currentTheme(),
    activeSheetRows: workspaceContext.activeSheetRows,
    totalWorkspaceRows: workspaceContext.totalWorkspaceRows,
  };
  const nav = navigator as NavigatorWithDeviceMemory;
  current.environment = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency:
      Number.isFinite(navigator.hardwareConcurrency) &&
      navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : null,
    deviceMemoryGb: finiteNumber(nav.deviceMemory),
    viewportWidth: Math.max(0, Math.floor(window.innerWidth)),
    viewportHeight: Math.max(0, Math.floor(window.innerHeight)),
    devicePixelRatio: window.devicePixelRatio,
  };
}

function checkpointCurrentSession(): void {
  if (current === null) return;
  refreshCurrentMetrics();
  const next = cloneSession(current);
  if (currentPersistedIndex < 0) {
    sessions.unshift(next);
    currentPersistedIndex = 0;
  } else {
    sessions[currentPersistedIndex] = next;
  }
  sessions = sessions.slice(0, FIELD_PERFORMANCE_MAX_SESSIONS);
  persistState();
  updateSnapshot();
}

function stopCapture(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  checkpointCurrentSession();
  for (const observer of observers.splice(0)) observer.disconnect();
  current = null;
  currentInteractionDurations = new Map();
  currentPersistedIndex = -1;
  clsValue = 0;
  clsWindowValue = 0;
  clsWindowStart = 0;
  clsLastEntry = 0;
  longTaskCount = 0;
  maxLongTaskMs = 0;
}

function startCapture(buffered: boolean): void {
  if (!supported || !enabled || current !== null) return;
  const nav = navigator as NavigatorWithDeviceMemory;
  current = {
    collectedAt: reportNow(),
    appVersion: appVersion(),
    cacheMode,
    declaredZoomPercent: zoomPercent,
    networkProfile,
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      hardwareConcurrency:
        Number.isFinite(navigator.hardwareConcurrency) &&
        navigator.hardwareConcurrency > 0
          ? navigator.hardwareConcurrency
          : null,
      deviceMemoryGb: finiteNumber(nav.deviceMemory),
      viewportWidth: Math.max(0, Math.floor(window.innerWidth)),
      viewportHeight: Math.max(0, Math.floor(window.innerHeight)),
      devicePixelRatio: window.devicePixelRatio,
    },
    context: {
      theme: currentTheme(),
      activeSheetRows: workspaceContext.activeSheetRows,
      totalWorkspaceRows: workspaceContext.totalWorkspaceRows,
    },
    metrics: {
      lcpMs: null,
      inpMs: null,
      interactionCount: 0,
      cls: 0,
      ttfbMs: null,
      startupInteractiveMs: null,
      longTaskCount: 0,
      maxLongTaskMs: 0,
    },
    interactions: [],
  };
  currentInteractionDurations = new Map();
  currentPersistedIndex = -1;
  observe("largest-contentful-paint", buffered, (entry) => {
    const value = finiteNumber(entry.startTime);
    if (current !== null && value !== null) current.metrics.lcpMs = value;
  });
  observe("event", buffered, (entry) => collectInteraction(entry), 16);
  observe("layout-shift", buffered, (entry) =>
    updateLayoutShift(entry as PerformanceEntry & LayoutShiftEntry),
  );
  observe("longtask", buffered, (entry) => {
    const duration = finiteNumber(
      (entry as PerformanceEntry & LongTaskEntry).duration,
    );
    if (duration === null) return;
    longTaskCount += 1;
    maxLongTaskMs = Math.max(maxLongTaskMs, duration);
  });
  refreshCurrentMetrics();
}

/** App 完成平台判定后调用一次；仅 browser 平台开放本地采样。 */
export function initializeFieldPerformanceCapture(isBrowser: boolean): void {
  if (initialized) return;
  initialized = true;
  supported = isBrowser;
  if (!supported) {
    updateSnapshot();
    return;
  }
  const state = readPersistedState();
  if (state !== null) {
    enabled = state.enabled;
    cacheMode = state.cacheMode;
    zoomPercent = state.zoomPercent;
    networkProfile = state.networkProfile;
    sessions = state.sessions;
  }
  updateSnapshot();
  if (enabled) startCapture(true);
}

/** 仅更新聚合行数，不接触工作区内容；由组合根订阅 Store 时调用。 */
export function updateFieldPerformanceWorkspace(context: {
  activeSheetRows: number;
  totalWorkspaceRows: number;
}): void {
  workspaceContext = {
    activeSheetRows: nonNegativeInteger(context.activeSheetRows),
    totalWorkspaceRows: nonNegativeInteger(context.totalWorkspaceRows),
  };
  if (current !== null) schedulePersist();
}

/** 生成带版本和隐私声明的报告；纯数据，不触发下载。 */
export function buildFieldPerformanceReport(
  inputSessions: readonly FieldPerformanceSession[],
  generatedAt = reportNow(),
): FieldPerformanceReport {
  return {
    schemaVersion: FIELD_PERFORMANCE_REPORT_SCHEMA_VERSION,
    kind: "mamep-local-web-performance",
    generatedAt,
    privacy: {
      anonymous: true,
      uploaded: false,
      containsWorkspaceContent: false,
      containsDeviceMessages: false,
    },
    targets: {
      startupInteractiveMs: FIELD_PERFORMANCE_INTERACTIVE_BUDGET_MS,
      inpMs: FIELD_PERFORMANCE_INP_BUDGET_MS,
    },
    inpMethod: "event-timing-p98-interaction-max",
    sessions: inputSessions.map(cloneSession),
  };
}

function setEnabled(nextEnabled: boolean): void {
  if (!supported || enabled === nextEnabled) return;
  enabled = nextEnabled;
  if (enabled) {
    startCapture(false);
  } else {
    stopCapture();
  }
  persistState();
  updateSnapshot();
}

function setCacheMode(nextMode: FieldPerformanceCacheMode): void {
  if (!validCacheMode(nextMode) || cacheMode === nextMode) return;
  cacheMode = nextMode;
  persistState();
  updateSnapshot();
}

function setZoomPercent(nextZoom: FieldPerformanceZoomPercent): void {
  if (!validZoomPercent(nextZoom) || zoomPercent === nextZoom) return;
  zoomPercent = nextZoom;
  persistState();
  updateSnapshot();
}

function setNetworkProfile(nextProfile: FieldPerformanceNetworkProfile): void {
  if (!validNetworkProfile(nextProfile) || networkProfile === nextProfile) {
    return;
  }
  networkProfile = nextProfile;
  persistState();
  updateSnapshot();
}

function clearSessions(): void {
  sessions = [];
  currentPersistedIndex = -1;
  persistState();
  updateSnapshot();
  if (enabled) {
    const wasCapturing = current !== null;
    for (const observer of observers.splice(0)) observer.disconnect();
    current = null;
    currentInteractionDurations = new Map();
    clsValue = 0;
    clsWindowValue = 0;
    clsWindowStart = 0;
    clsLastEntry = 0;
    longTaskCount = 0;
    maxLongTaskMs = 0;
    if (wasCapturing) startCapture(false);
  }
}

function exportReport(): void {
  if (current !== null) checkpointCurrentSession();
  const report = buildFieldPerformanceReport(sessions);
  const timestamp = report.generatedAt.replace(/[^0-9]/g, "");
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mamep-web-performance-${timestamp}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function subscribeFieldPerformanceSettings(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFieldPerformanceSettings(): FieldPerformanceSettings | null {
  return snapshot;
}

function checkpointOnHide(): void {
  if (document.visibilityState === "hidden") checkpointCurrentSession();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", checkpointOnHide);
}
