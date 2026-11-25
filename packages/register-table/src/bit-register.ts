/**
 * 位明细展开的领域逻辑。
 *
 * 语义：
 * - 单寄存器行（registerCount=1）或范围行的寄存器子行（该寄存器自身 dataType 为 binary）
 *   可展开为 16 行位明细（bit15 → bit0，MSB first）；
 * - 位值切换只更新**当前值**（`registerValues[registerIndex]` + 父行 `cellText`），
 *   **不触发任何设备写入**（是否写设备仍由用户按 Write 决定）；
 * - 未读取（`registerValues` 缺失）时以「父行 `cellText` 派生，失败全 0」为基准
 *   （与 `commitChildCellText` 同语义）；
 * - 位注释存 `RegisterRow.bitComments`（外层=寄存器序号，内层长度 16、下标=bit 号），
 *   按需创建；某寄存器全空存 `null`、整体全空 `bitComments = null`；
 * - 纯函数、不可变、不依赖 UI/store；设备请求路径不经过本模块。
 */
import {
  createMamepError,
  RawRegisterValue,
  type RegisterBitComments,
  type RegisterBitNames,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  createDataTypeResolver,
  formatRawValues,
  formatFloatWords,
  isFloatType,
  parseCompositeText,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";

/** 每个 16 位寄存器的位数（位明细行数）。 */
export const BITS_PER_REGISTER = 16;

/** 单个位的取值。 */
export type BitValue = 0 | 1;

/** 位明细条目（供 UI 构造派生虚拟行；顺序 bit15 → bit0）。 */
export interface BitEntry {
  /** bit 号（0..15）。 */
  bit: number;
  /** 该位当前值；null=该寄存器尚未读取。 */
  value: BitValue | null;
  /** 位掩码文本（如 `0x8000`、`0x0001`）。 */
  maskText: string;
  /** 位名称：无名称为空串，位 Name 列可编辑。 */
  name: string;
  /** 位注释（无注释为空串）。 */
  comment: string;
}

/** 模块级缺省解析器（仅内置插件类型由 UI 注入 resolver）。 */
const defaultResolver: DataTypeResolver = createDataTypeResolver();

function bitError(code: string, technicalMessage: string) {
  return createMamepError({
    code,
    category: "validation",
    userMessageKey: "errors.internal",
    technicalMessage,
  });
}

/** 位掩码文本：bit0 → `0x0001` … bit15 → `0x8000`（4 位大写 HEX）。 */
export function bitMaskText(bit: number): string {
  return `0x${(1 << bit).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** 校验寄存器序号与 bit 号（越界返回结构化错误）。 */
function validateTarget(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
): Result<true> {
  if (registerIndex < 0 || registerIndex >= row.registerCount) {
    return fail(
      bitError(
        "BIT_REGISTER_INDEX_OUT_OF_RANGE",
        `register index ${registerIndex} out of range 0..${row.registerCount - 1}`,
      ),
    );
  }
  if (bit < 0 || bit >= BITS_PER_REGISTER) {
    return fail(
      bitError(
        "BIT_INDEX_OUT_OF_RANGE",
        `bit ${bit} out of range 0..${BITS_PER_REGISTER - 1}`,
      ),
    );
  }
  return ok(true);
}

/** 读取某寄存器的原始值数组：优先 `registerValues`（长度一致时），否则由 `cellText` 派生，失败全 0。 */
function registerValueBase(row: RegisterRow): number[] {
  const stored = row.registerValues;
  if (stored !== null && stored.length === row.registerCount) {
    return stored.map((value) => value.value);
  }
  const derived = parseCompositeText(
    row.cellText,
    row.dataType,
    row.registerCount,
  );
  return derived.ok
    ? derived.value
    : Array.from({ length: row.registerCount }, () => 0);
}

/** 按父行类型格式化当前值数组为单元格文本（单寄存器走 resolver.format，范围行走组合文本）。 */
function formatCurrentValue(
  row: RegisterRow,
  values: number[],
  resolver?: DataTypeResolver,
): string {
  if (row.registerCount > 1) {
    return formatRawValues(values, row.dataType);
  }
  const value = values[0] ?? 0;
  return (resolver ?? defaultResolver).format(value, row.dataType);
}

/** 读取位值：该寄存器尚未读取时返回 null。 */
export function readRegisterBit(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
): BitValue | null {
  if (registerIndex < 0 || registerIndex >= row.registerCount) return null;
  if (bit < 0 || bit >= BITS_PER_REGISTER) return null;
  const stored = row.registerValues;
  const raw =
    stored !== null && stored.length === row.registerCount
      ? stored[registerIndex]?.value
      : undefined;
  if (raw === undefined) return null;
  return ((raw >> bit) & 1) === 1 ? 1 : 0;
}

/** 读取位名称（越界或无名称返回空串）。 */
export function readBitName(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
): string {
  return row.bitNames?.[registerIndex]?.[bit] ?? "";
}

/** 读取位注释（越界或无注释返回空串）。 */
export function readBitComment(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
): string {
  return row.bitComments?.[registerIndex]?.[bit] ?? "";
}

/** 构造某寄存器的 16 条位明细（顺序 bit15 → bit0）。 */
export function buildBitEntries(
  row: RegisterRow,
  registerIndex: number,
): BitEntry[] {
  const entries: BitEntry[] = [];
  for (let bit = BITS_PER_REGISTER - 1; bit >= 0; bit -= 1) {
    entries.push({
      bit,
      value: readRegisterBit(row, registerIndex, bit),
      maskText: bitMaskText(bit),
      name: readBitName(row, registerIndex, bit),
      comment: readBitComment(row, registerIndex, bit),
    });
  }
  return entries;
}

/**
 * 设置某寄存器的一个位（0/1）：更新当前值并重算父行 `cellText`。
 * **不写设备**；未读取时按 `cellText` 派生基准（失败全 0）。
 */
export function setRegisterBit(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
  value: BitValue,
  resolver?: DataTypeResolver,
): Result<RegisterRow> {
  const valid = validateTarget(row, registerIndex, bit);
  if (!valid.ok) return valid;
  const base = registerValueBase(row);
  const current = base[registerIndex] ?? 0;
  const mask = 1 << bit;
  const next = value === 1 ? current | mask : current & ~mask & 0xffff;
  if (next === current && row.registerValues !== null) {
    // 无变化：原引用返回（零更新，切断级联重渲染/自动保存）。
    return ok(row);
  }
  base[registerIndex] = next;
  if (isFloatType(row.dataType)) {
    const formatted = formatFloatWords(base, row.dataType);
    if (!formatted.ok) return formatted;
  }
  const registerValues: RawRegisterValue[] = [];
  for (const raw of base) {
    const created = RawRegisterValue.create(raw);
    if (!created.ok) return created;
    registerValues.push(created.value);
  }
  return ok({
    ...row,
    registerValues,
    cellText: formatCurrentValue(row, base, resolver),
    updatedAt: Date.now(),
  });
}

/** 把任意长度的注释数组归一为 16 项（截断/以空串补齐）。 */
function normalizeBitSlots(slots: readonly string[]): string[] {
  const next: string[] = [];
  for (let bit = 0; bit < BITS_PER_REGISTER; bit += 1) {
    next.push(slots[bit] ?? "");
  }
  return next;
}

/** 保证 bitComments 外层长度为 registerCount、每项为长度 16 的数组或 null（不修改入参）。 */
function ensureBitComments(
  bitComments: RegisterBitComments | null,
  registerCount: number,
): (string[] | null)[] {
  const base = bitComments ?? [];
  const next: (string[] | null)[] = [];
  for (let i = 0; i < registerCount; i += 1) {
    const group = base[i];
    next.push(
      group === undefined || group === null ? null : normalizeBitSlots(group),
    );
  }
  return next;
}

/** 写入位名称（空串=清除该位名称）；全空归一为 `null`。语义与 `setBitComment` 完全对称。 */
export function setBitName(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
  name: string,
): Result<RegisterRow> {
  const valid = validateTarget(row, registerIndex, bit);
  if (!valid.ok) return valid;
  if (readBitName(row, registerIndex, bit) === name) {
    // 无实际变化：原引用返回（不产生撤销条目/自动保存）。
    return ok(row);
  }
  const groups = ensureBitNames(row.bitNames, row.registerCount);
  const slots = groups[registerIndex] ?? normalizeBitSlots([]);
  slots[bit] = name;
  groups[registerIndex] = slots.every((slot) => slot === "") ? null : slots;
  const allEmpty = groups.every((group) => group === null);
  return ok({
    ...row,
    bitNames: allEmpty ? null : groups,
    updatedAt: Date.now(),
  });
}

/** 保证 bitNames 外层长度为 registerCount、每项为长度 16 的数组或 null（不修改入参）。 */
function ensureBitNames(
  bitNames: RegisterBitNames | null,
  registerCount: number,
): (string[] | null)[] {
  const base = bitNames ?? [];
  const next: (string[] | null)[] = [];
  for (let i = 0; i < registerCount; i += 1) {
    const group = base[i];
    next.push(
      group === undefined || group === null ? null : normalizeBitSlots(group),
    );
  }
  return next;
}

/** 写入位注释（空串=清除该位注释）；全空归一为 `null`。 */
export function setBitComment(
  row: RegisterRow,
  registerIndex: number,
  bit: number,
  comment: string,
): Result<RegisterRow> {
  const valid = validateTarget(row, registerIndex, bit);
  if (!valid.ok) return valid;
  if (readBitComment(row, registerIndex, bit) === comment) {
    // 无实际变化：原引用返回（不产生撤销条目/自动保存）。
    return ok(row);
  }
  const groups = ensureBitComments(row.bitComments, row.registerCount);
  const slots = groups[registerIndex] ?? normalizeBitSlots([]);
  slots[bit] = comment;
  groups[registerIndex] = slots.every((slot) => slot === "") ? null : slots;
  const allEmpty = groups.every((group) => group === null);
  return ok({
    ...row,
    bitComments: allEmpty ? null : groups,
    updatedAt: Date.now(),
  });
}

/**
 * 范围长度变化时同步位注释：按寄存器序号保留/截断/补齐（与 `resizeRegisters` 同处调用）。
 * 结果全空时返回 null。
 */
export function resizeBitComments(
  bitComments: RegisterBitComments | null,
  count: number,
): RegisterBitComments | null {
  if (bitComments === null) return null;
  if (count <= 0) return null;
  const next = ensureBitComments(bitComments, count);
  return next.every((group) => group === null) ? null : next;
}

/**
 * 范围长度变化时同步位名称：按寄存器序号保留/截断/补齐（与 `resizeBitComments` 对称）。
 * 结果全空时返回 null。
 */
export function resizeBitNames(
  bitNames: RegisterBitNames | null,
  count: number,
): RegisterBitNames | null {
  if (bitNames === null) return null;
  if (count <= 0) return null;
  const next = ensureBitNames(bitNames, count);
  return next.every((group) => group === null) ? null : next;
}
