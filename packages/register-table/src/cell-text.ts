/**
 * Data 单元格提交（docs/AGENTS.md §17、§23；TECH_DESIGN.md §6.8）。
 * 对称于 address.ts 的 commitAddress：
 * - 按 Type 校验（parseCellText / parseCompositeText），失败返回结构化错误、由调用方保留输入；
 * - 成功提交写回**规范显示形式**：即设备读回后 `formatRawValue` /
 *   `formatRawValues` / 插件 resolver.format 的同一形式（单一当前值模型 §15.1：cellText 即
 *   用户可见的当前值，输入/粘贴/读取三条路径收敛到同一形式）；
 * - 成功提交**同时同步 `registerValues`**：保持「原始值单一事实源」
 *   不变式，使派生展示（范围行子行 `tree-rows`、位明细 `bit-register`）与位切换
 *   基准跟随父行文本，而不是停在旧读值。
 * - Float inputs round on commit; integer and fixed-point inputs never round.
 */
import {
  RawRegisterValue,
  type DataType,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import {
  createDataTypeResolver,
  formatRawValues,
  parseCompositeText,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";

/** 解析成功的产物：规范显示文本 + 对应原始值（范围行多个、单寄存器单个）。 */
interface CanonicalizedCell {
  text: string;
  values: number[];
}

/**
 * 解析当前文本并产出「规范显示文本 + 原始值」（提交/规范化的单一实现点）：
 * - 范围行（registerCount>1）：`parseCompositeText`；
 * - 单寄存器：`resolver.parse`（内置类型或插件类型）。
 * 解析失败原样返回结构化错误（调用方保留用户输入，§23）。
 */
function canonicalizeCell(
  row: Pick<RegisterRow, "dataType" | "registerCount">,
  text: string,
  resolver?: DataTypeResolver,
): Result<CanonicalizedCell> {
  const resolve = resolver ?? defaultResolver;
  if (row.registerCount > 1) {
    const parsed = parseCompositeText(text, row.dataType, row.registerCount);
    if (!parsed.ok) return parsed;
    return ok({
      text: formatRawValues(parsed.value, row.dataType),
      values: parsed.value,
    });
  }
  const parsed = resolve.parse(text, row.dataType);
  if (!parsed.ok) return parsed;
  return ok({
    text: resolve.format(parsed.value, row.dataType),
    values: [parsed.value],
  });
}

/**
 * 计算规范显示文本：解析成功后按类型格式化。
 * - 范围行（registerCount>1）：`formatRawValues`（组合文本，如 hex `1234 ABCD`、binary 每 8 位分组）；
 * - 单寄存器：`resolver.format`（内置类型或插件类型）。
 * 解析失败返回结构化错误（调用方保留用户输入，§23）。提交与粘贴共用本函数。
 */
export function canonicalCellText(
  row: Pick<RegisterRow, "dataType" | "registerCount">,
  text: string,
  resolver?: DataTypeResolver,
): Result<string> {
  const canonical = canonicalizeCell(row, text, resolver);
  return canonical.ok ? ok(canonical.value.text) : canonical;
}

/** 提交 Data 单元格草稿：按 Type 校验（失败返回结构化错误，成功写回规范显示文本）。
 *  多寄存器行：组合文本按 parseCompositeText 校验（范围长度 × 类型合法集）。
 * 成功时同步 `registerValues`（解析出的原始值），保证子行/位明细与父行文本一致。
 * 插件类型经 resolver 解析/格式化（缺省仅内置）。 */
export function commitCellText(
  row: RegisterRow,
  text: string,
  resolver?: DataTypeResolver,
): Result<RegisterRow> {
  const canonical = canonicalizeCell(row, text, resolver);
  if (!canonical.ok) return canonical;
  const registerValues: RawRegisterValue[] = [];
  for (const value of canonical.value.values) {
    const created = RawRegisterValue.create(value);
    if (!created.ok) return created;
    registerValues.push(created.value);
  }
  return ok({
    ...row,
    cellText: canonical.value.text,
    registerValues,
    updatedAt: Date.now(),
  });
}

/** 模块级缺省解析器（仅内置，无插件注册——保持纯函数契约）。 */
const defaultResolver: DataTypeResolver = createDataTypeResolver();

/**
 * Type/Scale 切换时即时刷新显示文本：
 * 把当前值按新 Type 重新显示，**原始值不变** ——
 * - 先用**切换前**的 `row.dataType` 解析当前文本（范围行 `parseCompositeText` / 单寄存器 `resolver.parse`）；
 * - 解析成功 → 按新 `dataType` 格式化写回（范围行 `formatRawValues` / 单寄存器 `resolver.format`）；
 * - 解析失败或文本为空 → **保留原文**（空则保持空，不生成 0，§23）；
 * - 新 Type 不支持该行组合宽度（bool / 未知插件类型 + `registerCount > 1`）→ 保留原文；
 * - 绝不按新进制重新解释当前文本（`171` 切 hex 得 `00AB`，不得得 `0171`）。
 *
 * 不改 `registerValues`（设备读回值 / 子行数据源）；`dataType` 未变化时返回原引用。
 */
export function retargetRowDataType(
  row: RegisterRow,
  dataType: DataType,
  resolver?: DataTypeResolver,
): RegisterRow {
  if (dataType === row.dataType) return row;
  return {
    ...row,
    dataType,
    cellText: reformatByType(row, dataType, resolver),
    updatedAt: Date.now(),
  };
}

/** 按新 Type 重新格式化当前文本（解析失败 / 空文本 / 组合宽度不支持一律保留原文）。 */
function reformatByType(
  row: RegisterRow,
  nextType: DataType,
  resolver?: DataTypeResolver,
): string {
  const text = row.cellText;
  if (text.trim() === "") return text;
  if (row.registerCount > 1) {
    const parsed = parseCompositeText(text, row.dataType, row.registerCount);
    if (!parsed.ok) return text;
    try {
      return formatRawValues(parsed.value, nextType);
    } catch {
      // 组合宽度在新 Type 下不被支持（bool / 未知插件类型，formatRawValues 抛错）：保留原文。
      return text;
    }
  }
  const resolve = resolver ?? defaultResolver;
  const parsed = resolve.parse(text, row.dataType);
  if (!parsed.ok) return text;
  if (!resolve.isValidRegisterCount(nextType, 1)) return text;
  return resolve.format(parsed.value, nextType);
}
