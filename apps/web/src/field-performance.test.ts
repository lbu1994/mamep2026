import { describe, expect, it } from "vitest";
import {
  buildFieldPerformanceReport,
  estimateInteractionToNextPaintMs,
  FIELD_PERFORMANCE_MAX_SESSIONS,
  FIELD_PERFORMANCE_STORAGE_VERSION,
  parsePersistedFieldPerformanceState,
  type FieldPerformanceSession,
} from "./field-performance";
import {
  FIELD_PERFORMANCE_STORAGE_KEY,
  isFieldPerformanceOptInEnabled,
} from "./field-performance-config";

function sampleSession(index = 0): FieldPerformanceSession {
  return {
    collectedAt: `2026-11-21T00:00:${String(index).padStart(2, "0")}.000Z`,
    appVersion: "0.6.0",
    cacheMode: index % 2 === 0 ? "cold" : "warm",
    declaredZoomPercent: 100,
    networkProfile: "wifi",
    environment: {
      userAgent: "test-browser",
      language: "zh-CN",
      hardwareConcurrency: 4,
      deviceMemoryGb: 8,
      viewportWidth: 390,
      viewportHeight: 844,
      devicePixelRatio: 3,
    },
    context: {
      theme: "dark",
      activeSheetRows: 1000,
      totalWorkspaceRows: 1000,
    },
    metrics: {
      lcpMs: 2400,
      inpMs: 180,
      interactionCount: 3,
      cls: 0.01,
      ttfbMs: 320,
      startupInteractiveMs: 2800,
      longTaskCount: 1,
      maxLongTaskMs: 72,
    },
    interactions: [
      { interactionId: 1, durationMs: 40 },
      { interactionId: 1, durationMs: 180 },
      { interactionId: 2, durationMs: 80 },
    ],
  };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value !== "object" || value === null) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

describe("field performance", () => {
  it("启动期只读取显式开启标记，损坏数据视为关闭", () => {
    const storage = (raw: string | null) => ({
      getItem: (key: string) =>
        key === FIELD_PERFORMANCE_STORAGE_KEY ? raw : null,
    });

    expect(isFieldPerformanceOptInEnabled(storage(null))).toBe(false);
    expect(isFieldPerformanceOptInEnabled(storage("{bad json"))).toBe(false);
    expect(
      isFieldPerformanceOptInEnabled(
        storage(
          JSON.stringify({
            version: 1,
            enabled: true,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("按 interactionId 聚合后计算 P98，不把同一交互的多个事件累加", () => {
    const interactions = Array.from({ length: 100 }, (_, index) => ({
      interactionId: index + 1,
      durationMs: index + 1,
    }));
    interactions.push({ interactionId: 100, durationMs: 1_000 });
    interactions.push({ interactionId: 100, durationMs: 120 });

    expect(estimateInteractionToNextPaintMs(interactions)).toBe(99);
    expect(
      estimateInteractionToNextPaintMs([
        { interactionId: 1, durationMs: 20 },
        { interactionId: 2, durationMs: 80 },
      ]),
    ).toBe(80);
  });

  it("报告只包含声明的匿名时序字段和行数，不包含行内容或设备报文", () => {
    const report = buildFieldPerformanceReport(
      [sampleSession()],
      "2026-11-21T01:02:03.000Z",
    );
    const keys = collectKeys(report);

    expect(report.privacy).toEqual({
      anonymous: true,
      uploaded: false,
      containsWorkspaceContent: false,
      containsDeviceMessages: false,
    });
    expect(keys.has("activeSheetRows")).toBe(true);
    for (const forbidden of [
      "cellText",
      "addressDraft",
      "registerValues",
      "bytes",
      "bytesHex",
      "workspace",
      "deviceData",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("损坏状态回退为空，并对持久化会话数量设硬上限", () => {
    expect(parsePersistedFieldPerformanceState("{bad json")).toBeNull();
    expect(
      parsePersistedFieldPerformanceState(
        JSON.stringify({
          version: 999,
          enabled: true,
          cacheMode: "cold",
          zoomPercent: 100,
          networkProfile: "local",
          sessions: [],
        }),
      ),
    ).toBeNull();

    const sessions = Array.from(
      { length: FIELD_PERFORMANCE_MAX_SESSIONS + 5 },
      (_, index) => sampleSession(index),
    );
    const parsed = parsePersistedFieldPerformanceState(
      JSON.stringify({
        version: FIELD_PERFORMANCE_STORAGE_VERSION,
        enabled: true,
        cacheMode: "warm",
        zoomPercent: 125,
        networkProfile: "slow-4g",
        sessions,
      }),
    );

    expect(parsed?.sessions).toHaveLength(FIELD_PERFORMANCE_MAX_SESSIONS);
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.cacheMode).toBe("warm");
    expect(parsed?.zoomPercent).toBe(125);
    expect(parsed?.networkProfile).toBe("slow-4g");
  });
});
