/**
 * Data 单元格提交（docs/AGENTS.md §17、§23；TECH_DESIGN.md §6.8）。
 * 对称于 address.ts 的 commitAddress：
 * - 按 Type 校验（parseCellText），失败返回结构化错误、由调用方保留输入；
 * - 成功提交保留用户原文（不规范化——规范化是读取成功后 formatRawValue 的事，
 *   单一当前值模型 §15.1：cellText 即用户可见的当前值）。
 */
import type { RegisterRow, Result } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import {
  createDataTypeResolver,
  parseCompositeText,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";

/** 提交 Data 单元格草稿：按 Type 校验；失败返回结构化错误，成功更新 cellText（保留原文）。
 *  多寄存器行（ADR-030）：组合文本按 parseCompositeText 校验（范围长度 × 类型合法集）。
 *  ADR-043 E-3：插件类型经 resolver 解析（缺省仅内置）。 */
export function commitCellText(
  row: RegisterRow,
  text: string,
  resolver?: DataTypeResolver,
): Result<RegisterRow> {
  const resolve = resolver ?? defaultResolver;
  const parsed =
    row.registerCount > 1
      ? parseCompositeText(text, row.dataType, row.registerCount)
      : resolve.parse(text, row.dataType);
  if (!parsed.ok) return parsed;
  return ok({ ...row, cellText: text, updatedAt: Date.now() });
}

/** 模块级缺省解析器（仅内置，无插件注册——保持纯函数契约）。 */
const defaultResolver: DataTypeResolver = createDataTypeResolver();
