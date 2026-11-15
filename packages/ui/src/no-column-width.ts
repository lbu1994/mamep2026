/**
 * No 列宽度自适应。
 *
 * 背景：No 单元格内容 = antd 树形展开图标（范围行的「加号按钮」，
 * 折叠态即 +，由 antd 树形数据自动注入到首列）+ 行号。固定 40px 时两位数行号
 * 放不下 → 换行 → 行高从 29px 变 47px（两行）。
 *
 * 约束：虚拟滚动表（ant-table-tbody-virtual-holder）列宽必须在列定义级静态确定，
 * 不支持逐行测量 / ResizeObserver 逐行自适应。故按「本表最大行号位数」计算列宽，
 * 保证「展开图标 + 行号」始终单行完整显示。
 *
 * 常量取值依据（实测，13px UI 字体）：
 * - td 内边距 6px × 2 = 12px
 * - antd 展开图标 14×14，margin `3px 4px 0 0` → 水平占位 14 + 4 = 18px
 * - 数字每字符 ≈ 7px（Segoe UI）；取 9px 留跨平台/字体安全余量
 * - 与展开图标间距 2px
 * - 不低于既有默认宽 40px（行号 1 位时列不致过窄）
 */

/** No 列最小宽度（px），避免 1 位行号时列过窄。 */
export const NO_COLUMN_MIN_WIDTH = 40;
/** No 单元格左右内边距（td padding 6px × 2，px）。 */
export const NO_CELL_PADDING_X = 12;
/** antd 树形展开图标本体宽（px，14×14）。 */
export const NO_EXPAND_ICON_WIDTH = 14;
/** antd 展开图标自带右外边距（px，margin 4px 0 0）。 */
export const NO_EXPAND_ICON_MARGIN_X = 4;
/** 展开图标与行号之间的额外间距（px）。 */
export const NO_ICON_GAP = 2;
/** 行号每字符宽（px）：实测 ≈7，取 9 留安全余量（跨平台/字体）。 */
export const NO_DIGIT_WIDTH = 9;

/** 行号位数：maxOrder<=0（空表）视作 1 位。 */
export function orderDigitCount(maxOrder: number): number {
  return maxOrder <= 0 ? 1 : String(maxOrder).length;
}

/**
 * 按本表最大行号计算 No 列宽：
 * 内边距 + 展开图标（含其外边距）+ 间距 + 最大行号位数 × 单字符宽，且不低于最小宽。
 */
export function computeNoColumnWidth(maxOrder: number): number {
  const contentWidth =
    NO_EXPAND_ICON_WIDTH +
    NO_EXPAND_ICON_MARGIN_X +
    NO_ICON_GAP +
    orderDigitCount(maxOrder) * NO_DIGIT_WIDTH;
  return Math.max(NO_COLUMN_MIN_WIDTH, NO_CELL_PADDING_X + contentWidth);
}
