/**
 * 轮询纯函数（docs/TECH_DESIGN.md §13、docs/AGENTS.md §17/§12.5）。
 * - 轮询目标：仅含 WP 开关且地址合法的行；表级地址变换（ADR-042）启用时发送地址 = 变换 apply
 *   （内置 builtin.address-adjust = 用户地址 − 1），变换校验失败（地址 0）跳过；
 * - 结果应用：generation 校验（结果地址必须仍是该行当前的轮询发送地址，避免旧地址迟到结果覆盖）；
 *   全表读取结果（address = 0）不参与轮询 generation 校验。
 * - 每表独立应用各自 addressTransform 配置（ADR-042：非活动表轮询同样按各行所属 sheet 配置）。
 * 本模块为纯函数，供 Application/Host 消费，不触碰 React 或平台 API。
 */
import type {
  AddressTransform,
  PollResultContext,
  RegisterRow,
  RegisterSheet,
  RequestRoute,
} from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { applyAddressTransform, resolveSheetAddressTransform } from "./address";
import { applyReadValueToRow, applyReadValuesToRow } from "./row-operations";

export interface PollingTarget {
  key: string;
  /** 行所属表；结果回写时用于拒绝切表/重绑后的旧响应。 */
  sheetId: string;
  address: number;
  /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器。 */
  quantity?: number;
  /** 由所属表创建的路由快照。 */
  route: RequestRoute;
}

/** 解析表级地址变换（ADR-042）：启用时返回变换；未配置/关闭/未知 id 返回 null。 */
function sheetTransform(
  sheet: Pick<RegisterSheet, "addressTransform">,
  resolve?: (transformId: string) => AddressTransform | null,
): AddressTransform | null {
  return resolveSheetAddressTransform(sheet.addressTransform, resolve);
}

/** 从工作区表格构建轮询目标（表级地址变换已应用到发送地址，ADR-042）。 */
export function buildPollingTargets(
  sheets: readonly RegisterSheet[],
  options?: {
    resolveAddressTransform?: (id: string) => AddressTransform | null;
    resolveProtocol?: (sheetType: string) => string;
  },
): PollingTarget[] {
  const resolve = options?.resolveAddressTransform;
  const resolveProtocol = options?.resolveProtocol ?? (() => "rtu");
  const targets: PollingTarget[] = [];
  for (const sheet of sheets) {
    const transform = sheetTransform(sheet, resolve);
    for (const row of sheet.rows) {
      if (!row.pollingEnabled) continue;
      const address = row.addressValue?.value;
      if (address === undefined) continue;
      const sent = applyAddressTransform(address, transform);
      if (!sent.ok) continue;
      targets.push({
        key: row.rowId,
        sheetId: sheet.sheetId,
        address: sent.value,
        // 多寄存器行（ADR-030）：一次 FC03 轮询全部连续寄存器。
        quantity: row.registerCount,
        route: {
          unitAddress: sheet.slaveAddress,
          protocol: resolveProtocol(sheet.type),
        },
      });
    }
  }
  return targets;
}

/** 结果对应的请求地址是否仍是该行当前轮询发送地址（generation 失效检测，按行所属表变换）。 */
export function pollResultAddressMatches(
  row: RegisterRow,
  sheet: Pick<RegisterSheet, "addressTransform">,
  address: number,
  resolve?: (transformId: string) => AddressTransform | null,
): boolean {
  const rowAddress = row.addressValue?.value;
  if (rowAddress === undefined) return false;
  const transform = sheetTransform(sheet, resolve);
  const sent = applyAddressTransform(rowAddress, transform);
  if (!sent.ok) return false;
  return address === sent.value;
}

/**
 * 校验结果仍指向当前工作区中同一个表的同一行。
 *
 * route 必须等于该表当前配置（Unit ID + 协议）；sheetId 防止行重绑到其他表后
 * 仍按全局 rowId 回写。resolveProtocol 缺省时只校验 Unit ID，生产装配必须提供。
 */
export function pollResultTargetMatches(
  sheets: readonly RegisterSheet[],
  event: Pick<PollResultContext, "key" | "sheetId" | "address" | "route">,
  options?: {
    resolveAddressTransform?: (id: string) => AddressTransform | null;
    resolveProtocol?: (sheetType: string) => string;
  },
): boolean {
  const sheet = sheets.find((candidate) => candidate.sheetId === event.sheetId);
  if (sheet === undefined) return false;
  const row = sheet.rows.find((candidate) => candidate.rowId === event.key);
  if (row === undefined) return false;
  if (event.route.unitAddress !== sheet.slaveAddress) return false;
  if (
    options?.resolveProtocol !== undefined &&
    event.route.protocol !== options.resolveProtocol(sheet.type)
  ) {
    return false;
  }
  return pollResultAddressMatches(
    row,
    sheet,
    event.address,
    options?.resolveAddressTransform,
  );
}

/**
 * 应用轮询/全表读取结果：定位行 → generation 校验 → 按 Type 格式化并更新原始值。
 * 行不存在或地址已失效时返回 null（调用方忽略）。
 * 性能优化：设备值未变化（registerValues 相同）且显示文本与当前 Type 格式化一致时，
 * 返回原行引用——调用方（store.updateRow）据此短路，不重建 rows/sheet/workspace，
 * 避免高频轮询触发无谓的重渲染、自动保存与轮询目标重建。
 */
export function applyPollResult(
  sheets: readonly RegisterSheet[],
  event: Pick<PollResultContext, "key" | "sheetId" | "address" | "route">,
  raw: number | number[],
  options?: {
    resolveAddressTransform?: (id: string) => AddressTransform | null;
    resolveProtocol?: (sheetType: string) => string;
  },
): RegisterRow | null {
  if (!pollResultTargetMatches(sheets, event, options)) return null;
  for (const sheet of sheets) {
    if (sheet.sheetId !== event.sheetId) continue;
    const row = sheet.rows.find((candidate) => candidate.rowId === event.key);
    if (row === undefined) continue;
    // 多寄存器行（ADR-030）：一次请求读回 values[]，按组合类型格式化。
    if (Array.isArray(raw)) {
      const applied = applyReadValuesToRow(row, raw);
      return applied.ok ? applied.value : null;
    }
    if (
      row.registerValues !== null &&
      row.registerValues[0]?.value === raw &&
      row.cellText === formatRawValue(raw, row.dataType)
    ) {
      return row;
    }
    const applied = applyReadValueToRow(row, raw);
    return applied.ok ? applied.value : null;
  }
  return null;
}
