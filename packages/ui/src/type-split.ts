/**
 * Map Type and Scale columns to a DataType ID.
 * Only unsigned and signed types support scaling. Floating-point types
 * select their own register width and always use scale 1.
 */
import { isBuiltinDataType, type DataType } from "@mamep2026/domain";

/** 进制列取值（与 domain DataType 前缀对应）。bool 为基础表位值类型。 */
export type DataRadix =
  | "hex"
  | "unsigned"
  | "signed"
  | "binary"
  | "string"
  | "bool"
  | "float32"
  | "float64";

/** scale 列取值（字符串表示，便于 Select 直接使用）。 */
export type ScaleValue = "1" | "0.1" | "0.01" | "0.001" | "0.0001";

export const RADIX_OPTIONS: readonly DataRadix[] = [
  "hex",
  "unsigned",
  "signed",
  "binary",
  "string",
  "bool",
  "float32",
  "float64",
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
  bool: "table.bool",
  float32: "table.float32",
  float64: "table.float64",
};

/** DataType → 进制（开放联合：显式收窄，插件类型回退 signed 显示）。 */
export function dataTypeToRadix(type: DataType): DataRadix {
  if (type === "float32") return "float32";
  if (type === "float64") return "float64";
  if (type === "hex" || type === "binary" || type === "string") {
    return type as DataRadix;
  }
  if (type === "bool") return "bool";
  if (type === "unsigned" || type.startsWith("unsigned-")) return "unsigned";
  if (type.startsWith("signed-")) return "signed";
  return "signed";
}

/**
 * 内置类型在滚动占位态使用的 i18n key。
 *
 * 占位态必须与正式 Select 使用同一显示文案，不能把内部 DataType/radix 代码
 *（如 `hex`、`signed`）直接暴露给用户；插件类型没有通用内置 key，调用方
 *应保留其 id 或由插件贡献提供标题。
 */
export function dataTypeLabelKey(type: DataType): string | null {
  if (!isBuiltinDataType(type)) return null;
  return RADIX_LABEL_KEYS[dataTypeToRadix(type)];
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

/** 进制 + scale → DataType（hex/binary/string/bool 忽略 scale 返回自身）。 */
export function combineRadixScale(
  radix: DataRadix,
  scale: ScaleValue,
): DataType {
  if (
    radix === "hex" ||
    radix === "binary" ||
    radix === "string" ||
    radix === "bool" ||
    radix === "float32" ||
    radix === "float64"
  ) {
    return radix;
  }
  return scale === "1" ? radix : (`${radix}-${scale}` as DataType);
}

/** scale 是否对当前进制可用（仅 unsigned/signed）。 */
export function isScaleApplicable(radix: DataRadix): boolean {
  return radix === "unsigned" || radix === "signed";
}
