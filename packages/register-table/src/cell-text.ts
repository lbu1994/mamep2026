/**
 * Data 单元格提交（docs/AGENTS.md §17、§23；TECH_DESIGN.md §6.8）。
 * 对称于 address.ts 的 commitAddress：
 * - 按 Type 校验（parseCellText / parseCompositeText），失败返回结构化错误、由调用方保留输入；
 * - 成功提交写回**规范显示形式**（ADR-051，2026-09-11）：即设备读回后 `formatRawValue` /
 *   `formatRawValues` / 插件 resolver.format 的同一形式（单一当前值模型 §15.1：cellText 即
 *   用户可见的当前值，输入/粘贴/读取三条路径收敛到同一形式）。
 * - 规范化不做任何舍入或截断：超范围/超小数位仍返回结构化错误。
 */
import type { RegisterRow, Result } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import {
  createDataTypeResolver,
  formatRawValues,
  parseCompositeText,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";

/**
 * 计算规范显示文本（ADR-051）：解析成功后按类型格式化。
 * - 范围行（registerCount>1）：`formatRawValues`（组合文本，如 hex `1234 ABCD`、binary 每 8 位分组）；
 * - 单寄存器：`resolver.format`（内置类型或插件类型）。
 * 解析失败返回结构化错误（调用方保留用户输入，§23）。提交与粘贴共用本函数。
 */
export function canonicalCellText(
  row: Pick<RegisterRow, "dataType" | "registerCount">,
  text: string,
  resolver?: DataTypeResolver,
): Result<string> {
  const resolve = resolver ?? defaultResolver;
  if (row.registerCount > 1) {
    const parsed = parseCompositeText(text, row.dataType, row.registerCount);
    if (!parsed.ok) return parsed;
    return ok(formatRawValues(parsed.value, row.dataType));
  }
  const parsed = resolve.parse(text, row.dataType);
  if (!parsed.ok) return parsed;
  return ok(resolve.format(parsed.value, row.dataType));
}

/** 提交 Data 单元格草稿：按 Type 校验（失败返回结构化错误，成功写回规范显示文本，ADR-051）。
 *  多寄存器行（ADR-030）：组合文本按 parseCompositeText 校验（范围长度 × 类型合法集）。
 *  ADR-043 E-3：插件类型经 resolver 解析/格式化（缺省仅内置）。 */
export function commitCellText(
  row: RegisterRow,
  text: string,
  resolver?: DataTypeResolver,
): Result<RegisterRow> {
  const canonical = canonicalCellText(row, text, resolver);
  if (!canonical.ok) return canonical;
  return ok({ ...row, cellText: canonical.value, updatedAt: Date.now() });
}

/** 模块级缺省解析器（仅内置，无插件注册——保持纯函数契约）。 */
const defaultResolver: DataTypeResolver = createDataTypeResolver();
