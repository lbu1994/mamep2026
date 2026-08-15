/**
 * 轮询纯函数（docs/TECH_DESIGN.md §13、docs/AGENTS.md §17/§12.5）。
 * - 轮询目标：仅含 WP 开关且地址合法的行；Address Adjust ON 时发送地址 = 用户地址 − 1，地址 0 跳过；
 * - 结果应用：generation 校验（结果地址必须仍是该行当前的轮询发送地址，避免旧地址迟到结果覆盖）；
 *   全表读取结果（address = 0）不参与轮询 generation 校验。
 * 本模块为纯函数，供 Application/Host 消费，不触碰 React 或平台 API。
 */
import type { RegisterRow, RegisterSheet } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { applyReadValueToRow } from "./row-operations";

export interface PollingTarget {
  key: string;
  address: number;
}

/** 从工作区表格构建轮询目标（Address Adjust 已应用到发送地址）。 */
export function buildPollingTargets(
  sheets: readonly RegisterSheet[],
  addressAdjust: "off" | "on",
): PollingTarget[] {
  const targets: PollingTarget[] = [];
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (!row.pollingEnabled) continue;
      const address = row.addressValue?.value;
      if (address === undefined) continue;
      if (addressAdjust === "on" && address === 0) continue;
      targets.push({
        key: row.rowId,
        address: addressAdjust === "on" ? address - 1 : address,
      });
    }
  }
  return targets;
}

/** 结果对应的请求地址是否仍是该行当前轮询发送地址（generation 失效检测）。 */
export function pollResultAddressMatches(
  row: RegisterRow,
  address: number,
  addressAdjust: "off" | "on",
): boolean {
  // 全表读取结果（address = 0）不参与轮询 generation 校验。
  if (address === 0) return true;
  const rowAddress = row.addressValue?.value;
  if (rowAddress === undefined) return false;
  const expected = addressAdjust === "on" ? rowAddress - 1 : rowAddress;
  return address === expected;
}

/**
 * 应用轮询/全表读取结果：定位行 → generation 校验 → 按 Type 格式化并更新原始值。
 * 行不存在或地址已失效时返回 null（调用方忽略）。
 * 性能优化：设备值未变化（lastKnownRawValue 相同）且显示文本与当前 Type 格式化一致时，
 * 返回原行引用——调用方（store.updateRow）据此短路，不重建 rows/sheet/workspace，
 * 避免高频轮询触发无谓的重渲染、自动保存与轮询目标重建。
 */
export function applyPollResult(
  sheets: readonly RegisterSheet[],
  key: string,
  address: number,
  raw: number,
  addressAdjust: "off" | "on",
): RegisterRow | null {
  for (const sheet of sheets) {
    const row = sheet.rows.find((r) => r.rowId === key);
    if (row === undefined) continue;
    if (!pollResultAddressMatches(row, address, addressAdjust)) return null;
    if (
      row.lastKnownRawValue !== null &&
      row.lastKnownRawValue.value === raw &&
      row.cellText === formatRawValue(raw, row.dataType)
    ) {
      return row;
    }
    const applied = applyReadValueToRow(row, raw);
    return applied.ok ? applied.value : null;
  }
  return null;
}
