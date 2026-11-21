/** 本地性能采样的存储键和启动期轻量读取；不加载观察器或报告实现。 */
export const FIELD_PERFORMANCE_STORAGE_KEY = "mamep:field-performance";
export const FIELD_PERFORMANCE_STORAGE_VERSION = 1;

export interface FieldPerformanceStorage {
  getItem(key: string): string | null;
}

/** 只判断上次是否已显式开启，损坏或版本不符一律视为关闭。 */
export function isFieldPerformanceOptInEnabled(
  storage?: FieldPerformanceStorage | null,
): boolean {
  try {
    const target =
      storage === undefined
        ? typeof localStorage === "undefined"
          ? null
          : localStorage
        : storage;
    if (target === null) return false;
    const raw = target.getItem(FIELD_PERFORMANCE_STORAGE_KEY);
    if (raw === null || raw === "") return false;
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).version ===
        FIELD_PERFORMANCE_STORAGE_VERSION &&
      (parsed as Record<string, unknown>).enabled === true
    );
  } catch {
    return false;
  }
}
