/**
 * 地址提交与 Address Adjust（docs/AGENTS.md §17.2、ADR-013、ADR-014、ADR-030、ADR-042）。
 * - 编辑态 addressDraft 与提交值 addressValue 分离；
 * - 校验失败保留用户输入并返回结构化错误；
 * - 成功提交后按进制归一化：HEX 4 位大写补零；DEC 去首尾空格（不补零）；
 * - 范围行（ADR-030）：draft 支持 `start-end`，提交后更新 registerCount（覆盖寄存器数）；
 * - Address Adjust（ADR-042 插件 Phase D）：表级 addressTransform 配置 → 运行时变换 apply，
 *   ON 时发送地址 = 用户地址 − 1（0 下溢报错），日志记录双地址。
 */
import {
  BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID,
  createMamepError,
  RegisterAddress,
  type AddressAdjustMode,
  type AddressTransform,
  type AddressTransformConfig,
  type RegisterRadix,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  formatRegisterAddressRange,
  isValidRegisterCount,
  parseRegisterAddressDraft,
} from "@mamep2026/data-conversion";
import { resizeRegisters } from "./child-register";

/** 提交地址草稿：更新 addressValue + registerCount；draft 保留（不因校验清空），成功提交按进制归一化。 */
export function commitAddress(
  row: RegisterRow,
  draft: string,
  radix: RegisterRadix,
): Result<RegisterRow> {
  const parsed = parseRegisterAddressDraft(draft, radix);
  if (!parsed.ok) return parsed;
  const parsedValue = parsed.value;
  const addressResult =
    parsedValue === null ? null : RegisterAddress.create(parsedValue.value);
  if (addressResult !== null && !addressResult.ok) return addressResult;
  const count = parsedValue === null ? 1 : parsedValue.count;
  const normalizedDraft =
    parsedValue === null
      ? draft
      : radix === "hex"
        ? formatRegisterAddressRange(parsedValue.value, count, radix)
        : draft.trim();
  return ok({
    ...row,
    addressDraft: normalizedDraft,
    addressValue: addressResult === null ? null : addressResult.value,
    registerCount: count,
    // 范围长度变化时旧读值不再对齐，清空 registerValues（ADR-030）。
    registerValues:
      count === row.registerCount ? row.registerValues : null,
    // 子行元数据按索引保留/截断/补齐（2026-08-27，不随值清空）。
    registers: resizeRegisters(row, count),
    updatedAt: Date.now(),
  });
}

/** 校验行「范围长度 × 类型合法集」（ADR-030 决策 7/8/10）：不匹配时禁止读写并在类型列报错。 */
export function isRowTypeCountValid(
  row: Pick<RegisterRow, "dataType" | "registerCount">,
): boolean {
  return isValidRegisterCount(row.dataType, row.registerCount);
}

/** 类型列校验错误（范围长度与类型合法集不匹配）：null=合法。 */
export function rowTypeCountError(
  row: Pick<RegisterRow, "dataType" | "registerCount">,
): { messageKey: string; detail: string } | null {
  if (isRowTypeCountValid(row)) return null;
  return {
    messageKey: "errors.dataInvalidRegisterCount",
    detail: "DATA_INVALID_REGISTER_COUNT",
  };
}

/** 内置 Address Adjust 变换（ADR-042）：ON 时发送 = 用户地址 − 1，0 下溢报错。 */
export const BUILTIN_ADDRESS_ADJUST_TRANSFORM: AddressTransform = {
  id: BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID,
  protocol: "rtu",
  titleKey: "table.addressAdjust",
  defaultConfig: { enabled: false },
  apply(userAddress) {
    if (userAddress === 0) {
      return fail(
        createMamepError({
          code: "ADDRESS_ADJUST_UNDERFLOW",
          category: "validation",
          userMessageKey: "errors.addressAdjustUnderflow",
          technicalMessage: "address 0 cannot be adjusted by -1",
        }),
      );
    }
    return ok(userAddress - 1);
  },
  validate(userAddress) {
    if (userAddress === 0) {
      return fail(
        createMamepError({
          code: "ADDRESS_ADJUST_UNDERFLOW",
          category: "validation",
          userMessageKey: "errors.addressAdjustUnderflow",
          technicalMessage: "address 0 cannot be adjusted by -1",
        }),
      );
    }
    return ok(null);
  },
};

/** 解析内置地址变换（按 id）；未知 id 返回 null（自定义变换由宿主注入 resolver，ADR-042）。 */
export function resolveBuiltinAddressTransform(
  transformId: string,
): AddressTransform | null {
  return transformId === BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID
    ? BUILTIN_ADDRESS_ADJUST_TRANSFORM
    : null;
}

/** 由表的 addressTransform 配置解析运行时变换（enabled 时按 transformId 查）；null=不调整。 */
export function resolveSheetAddressTransform(
  config: AddressTransformConfig | null,
  resolve: (transformId: string) => AddressTransform | null = resolveBuiltinAddressTransform,
): AddressTransform | null {
  if (config === null || !config.enabled) return null;
  return resolve(config.transformId);
}

/** 应用地址变换：null=不调整直接返回；否则变换 apply（0 下溢等失败返回结构化错误）。 */
export function applyAddressTransform(
  userAddress: number,
  transform: AddressTransform | null,
): Result<number> {
  return transform === null ? ok(userAddress) : transform.apply(userAddress);
}

/** 计算实际发送地址（兼容旧签名，语义委托内置变换）。 */
export function computeSentAddress(
  userAddress: number,
  addressAdjust: AddressAdjustMode,
): Result<number> {
  return applyAddressTransform(
    userAddress,
    addressAdjust === "on" ? BUILTIN_ADDRESS_ADJUST_TRANSFORM : null,
  );
}
