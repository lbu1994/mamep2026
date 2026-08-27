/**
 * Type 双列拆分辅助（ADR-030）：进制 + scale 两列映射回单一 DataType。
 * - 进制（radix）5 种：hex / unsigned / signed / binary / string；
 * - scale 5 种：1 / 0.1 / 0.01 / 0.001 / 0.0001，仅 unsigned/signed 可用；
 * - hex/binary/string 的 scale 恒为 1（下拉禁用）；
 * - 纯函数，便于 jsdom 单测。
 */
import type { DataType } from "@mamep2026/domain";

/** 进制列取值（与 domain DataType 前缀对应）。 */
export type DataRadix = "hex" | "unsigned" | "signed" | "binary" | "string";

/** scale 列取值（字符串表示，便于 Select 直接使用）。 */
export type ScaleValue = "1" | "0.1" | "0.01" | "0.001" | "0.0001";

export const RADIX_OPTIONS: readonly DataRadix[] = [
  "hex",
  "unsigned",
  "signed",
  "binary",
  "string",
];

export const SCALE_OPTIONS: readonly ScaleValue[] = [
  "1",
  "0.1",
  "0.01",
  "0.001",
  "0.0001",
];

/** 进制列的 i18n key（对应 i18n table.*）。 */
export const RADIX_LABEL_KEYS: Record<DataRadix, string> = {
  hex: "table.hex",
  unsigned: "table.unsigned",
  signed: "table.signed",
  binary: "table.binary",
  string: "table.string",
};

/** DataType → 进制。 */
export function dataTypeToRadix(type: DataType): DataRadix {
  if (type === "hex" || type === "binary" || type === "string") return type;
  if (type === "unsigned" || type.startsWith("unsigned-")) return "unsigned";
  return "signed";
}

/** DataType → scale（无后缀 = 1）。 */
export function dataTypeToScale(type: DataType): ScaleValue {
  const match = /-(0\.1|0\.01|0\.001|0\.0001)$/.exec(type);
  if (match === null) return "1";
  const value = match[1] as string;
  // 与 SCALE_OPTIONS 对齐（输入受 DataType 联合约束，此处仅防御）。
  return SCALE_OPTIONS.includes(value as ScaleValue)
    ? (value as ScaleValue)
    : "1";
}

/** 进制 + scale → DataType（hex/binary/string 忽略 scale 返回自身）。 */
export function combineRadixScale(
  radix: DataRadix,
  scale: ScaleValue,
): DataType {
  if (radix === "hex" || radix === "binary" || radix === "string") {
    return radix;
  }
  return scale === "1" ? radix : (`${radix}-${scale}` as DataType);
}

/** scale 是否对当前进制可用（仅 unsigned/signed）。 */
export function isScaleApplicable(radix: DataRadix): boolean {
  return radix === "unsigned" || radix === "signed";
}
