/**
 * 寄存器表列宽拖拽辅助（2026-08-16）。
 * 纯常量/纯函数，不依赖 React/antd，便于在 jsdom 中单测（jsdom 无法模拟真实拖拽）。
 */

/**
 * 各列可拖拽的最小宽度（px）。
 * 窄功能列（No/TM/WP/READ/WRITE）40；数据列（Name/Register/Data/Type/Comment）80；
 * 操作列（Actions）96，避免操作按钮换行。
 */
export const COLUMN_MIN_WIDTHS: Record<string, number> = {
  no: 40,
  tm: 40,
  name: 80,
  address: 80,
  wp: 40,
  read: 40,
  write: 40,
  data: 80,
  type: 80,
  comment: 80,
  actions: 96,
};

/** 未收录列的兜底最小宽度（px）。 */
const FALLBACK_MIN_WIDTH = 40;

/**
 * 拖拽列宽下限钳制：低于该列 minWidth 时钳到 minWidth，防止列被拖得过窄。
 * @param columnKey 列 key（未收录列使用兜底值）。
 * @param width 拖拽得到的宽度（px）。
 * @param minWidths 各列最小宽度表（默认全表配置，便于单测注入）。
 */
export function clampColumnWidth(
  columnKey: string,
  width: number,
  minWidths: Readonly<Record<string, number>> = COLUMN_MIN_WIDTHS,
): number {
  const min = minWidths[columnKey] ?? FALLBACK_MIN_WIDTH;
  return Math.max(min, width);
}
