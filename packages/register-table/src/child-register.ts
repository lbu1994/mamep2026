/**
 * 范围行子行（每寄存器）编辑逻辑（2026-08-27）。
 *
 * 数据模型：父行 `RegisterRow.registers[i]` 存子行独立元数据（name/comment/dataType），
 * `registerValues[i]` 存该寄存器原始值（单一事实源）。子行 Type/Scale 只影响该子行对
 * 单个寄存器（16 位）的显示与编辑解析，不改变父行 dataType 与读写协议行为（已确认决策）。
 *
 * 同步语义：
 * - 子行 Data 提交：用子行自身 dataType 经 parseCellText 解析单个 16 位原始值 →
 *   写 registerValues[i] → 重算父行 cellText（formatRawValues，按父行 dataType）；
 * - registerValues 为 null 时先由父行 cellText（parseCompositeText）派生基准数组，
 *   派生失败（如父行尚未输入）则全 0 填充，再置 index；
 * - 子行元数据（name/comment/dataType）编辑只改 registers[i]，不动 registerValues。
 */
import {
  createMamepError,
  createRegisterSubRowMetas,
  RawRegisterValue,
  type DataType,
  type RegisterRow,
  type RegisterSubRowMeta,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  createDataTypeResolver,
  formatRawValues,
  parseCompositeText,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";

/** 模块级缺省解析器（仅内置；ADR-043 E-3 插件类型由 UI 注入 resolver）。 */
const defaultResolver: DataTypeResolver = createDataTypeResolver();

/** 子行元数据补丁（name/comment/dataType 任意子集）。 */
export interface ChildMetaPatch {
  name?: string;
  comment?: string;
  dataType?: DataType;
}

/** 取子行 dataType：优先子行独立元数据，缺省回退父行 dataType（迁移/未编辑过）。 */
export function childDataType(row: RegisterRow, index: number): DataType {
  return row.registers?.[index]?.dataType ?? row.dataType;
}

/** 保证 registers 数组存在且长度=registerCount（单寄存器行返回 null）。 */
export function ensureRegisters(
  row: RegisterRow,
): RegisterSubRowMeta[] | null {
  if (row.registerCount <= 1) return null;
  if (row.registers !== null && row.registers.length === row.registerCount) {
    return row.registers;
  }
  return createRegisterSubRowMetas(row.registerCount, row.dataType);
}

/**
 * 按新范围长度调整子行元数据：按索引保留/截断/补齐（缺省继承父行 dataType）。
 * 范围长度未变且已有 registers 时原引用返回（不触发重渲染）；count<=1 返回 null。
 */
export function resizeRegisters(
  row: RegisterRow,
  count: number,
): RegisterSubRowMeta[] | null {
  if (count <= 1) return null;
  if (count === row.registerCount && row.registers !== null) {
    return row.registers;
  }
  const base = row.registers ?? [];
  const next: RegisterSubRowMeta[] = [];
  for (let i = 0; i < count; i += 1) {
    const existing = base[i];
    next.push(
      existing !== undefined
        ? existing
        : { name: "", comment: "", dataType: row.dataType },
    );
  }
  return next;
}

/** 提交子行 Data：按子行自身 dataType 解析单个寄存器值并回写 registerValues[i]，重算父行 cellText。 */
export function commitChildCellText(
  row: RegisterRow,
  index: number,
  text: string,
  resolver?: DataTypeResolver,
): Result<RegisterRow> {
  if (row.registerCount <= 1) {
    return fail(
      createMamepError({
        code: "CHILD_OF_SINGLE_ROW",
        category: "validation",
        userMessageKey: "errors.internal",
        technicalMessage: "cannot edit child cell of a single-register row",
      }),
    );
  }
  if (index < 0 || index >= row.registerCount) {
    return fail(
      createMamepError({
        code: "CHILD_INDEX_OUT_OF_RANGE",
        category: "validation",
        userMessageKey: "errors.internal",
        technicalMessage: `child index ${index} out of range 0..${row.registerCount - 1}`,
      }),
    );
  }
  const type = childDataType(row, index);
  const parsed = (resolver ?? defaultResolver).parse(text, type);
  if (!parsed.ok) return parsed;
  // registerValues 基准：优先父行 cellText 派生（用户可见文本为准），派生失败全 0 填充。
  let base: number[] | null = row.registerValues?.map((v) => v.value) ?? null;
  if (base === null) {
    const derived = parseCompositeText(
      row.cellText,
      row.dataType,
      row.registerCount,
    );
    base = derived.ok
      ? derived.value
      : Array.from({ length: row.registerCount }, () => 0);
  }
  base[index] = parsed.value;
  const registerValues: RawRegisterValue[] = [];
  for (const value of base) {
    const created = RawRegisterValue.create(value);
    if (!created.ok) return created;
    registerValues.push(created.value);
  }
  return ok({
    ...row,
    registerValues,
    // 重算父行组合文本（§15.1 单一当前值模型：子行编辑后父行显示随之规范化）。
    cellText: formatRawValues(base, row.dataType),
    updatedAt: Date.now(),
  });
}

/** 更新子行独立元数据（name/comment/dataType 任意子集），只改 registers[i]，不动值。 */
export function setChildMeta(
  row: RegisterRow,
  index: number,
  patch: ChildMetaPatch,
): Result<RegisterRow> {
  if (index < 0 || index >= row.registerCount) {
    return fail(
      createMamepError({
        code: "CHILD_INDEX_OUT_OF_RANGE",
        category: "validation",
        userMessageKey: "errors.internal",
        technicalMessage: `child index ${index} out of range 0..${row.registerCount - 1}`,
      }),
    );
  }
  const registers = ensureRegisters(row);
  if (registers === null) {
    return fail(
      createMamepError({
        code: "CHILD_OF_SINGLE_ROW",
        category: "validation",
        userMessageKey: "errors.internal",
        technicalMessage: "cannot edit child meta of a single-register row",
      }),
    );
  }
  const current = registers[index];
  if (
    current !== undefined &&
    (patch.name === undefined || patch.name === current.name) &&
    (patch.comment === undefined || patch.comment === current.comment) &&
    (patch.dataType === undefined || patch.dataType === current.dataType)
  ) {
    // 无实际变化：原引用返回（零更新，切断级联重渲染/自动保存）。
    return ok(row);
  }
  const next = registers.map((meta, i) =>
    i === index ? { ...meta, ...patch } : meta,
  );
  return ok({ ...row, registers: next, updatedAt: Date.now() });
}
