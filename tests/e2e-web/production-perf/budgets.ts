/**
 * Web 生产性能回归预算。
 *
 * Lighthouse 的移动预算是在标准慢速 4G + CPU 节流模拟下对当前基线
 * 保留约 15% 波动的防退化上限，不是低性能真机的性能承诺。真实设备
 * 与部署环境仍需独立验证。
 */
const KIB = 1024;

export const WEB_PERF_BUDGETS = {
  schemaVersion: 1,
  lighthouse: {
    sampleCount: 3,
    desktop: {
      fcpMs: 500,
      lcpMs: 1_800,
      ttiMs: 1_900,
      tbtMs: 100,
      cls: 0.02,
      requestCount: 90,
      totalTransferBytes: 650 * KIB,
      maxChunkBytes: 72 * KIB,
    },
    mobile: {
      fcpMs: 2_000,
      lcpMs: 7_000,
      ttiMs: 7_500,
      tbtMs: 600,
      cls: 0.15,
      requestCount: 90,
      totalTransferBytes: 650 * KIB,
      maxChunkBytes: 72 * KIB,
    },
  },
  playwright: {
    firstInteractiveMs: 3_000,
    hotRestoreMs: 300,
    importRenderMs: 300,
    scrollJumpMs: 100,
    scrollLongTaskMs: 50,
    workspaceRestoreLongTaskMs: 50,
    settingsEventMs: 200,
    interactionEventMs: 200,
    cellEditMedianMs: 100,
    firstScreenTransferBytes: 650 * KIB,
    firstScreenRequestCount: 90,
    firstScreenMaxChunkBytes: 72 * KIB,
  },
} as const;
