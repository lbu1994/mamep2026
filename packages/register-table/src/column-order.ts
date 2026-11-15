/**
 * 寄存器表列顺序工具：按持久化的列 key 顺序重排列定义。
 * 语义：null / 空数组 = 未定制 → 返回默认（传入）顺序；
 * 容错：order 中引用不存在的 key 忽略；base 中未出现在 order 的列追加到末尾，
 * 使未来新增列自动出现在末尾、已删除列不残留（持久化数据不依赖列定义快照）。
 */
export function applyColumnOrder<T extends { key?: unknown }>(
  base: readonly T[],
  order: readonly string[] | null,
): T[] {
  if (order === null || order.length === 0) return [...base];
  const byKey = new Map(base.map((col) => [String(col.key), col]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    const col = byKey.get(key);
    if (col === undefined || seen.has(key)) continue;
    ordered.push(col);
    seen.add(key);
  }
  for (const col of base) {
    if (!seen.has(String(col.key))) ordered.push(col);
  }
  return ordered;
}
