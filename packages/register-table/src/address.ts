/**
 * 地址提交与 Address Adjust（docs/AGENTS.md §17.2、ADR-013、ADR-014）。
 * - 编辑态 addressDraft 与提交值 addressValue 分离；
 * - 校验失败保留用户输入并返回结构化错误；
 * - 成功提交后按进制归一化：HEX 4 位大写补零；DEC 去首尾空格（不补零）；
 * - Address Adjust ON 时发送地址 = 用户地址 − 1，日志记录双地址。
 */
import {
  createMamepError,
  RegisterAddress,
  type RegisterRadix,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  formatRegisterAddress,
  parseRegisterAddressDraft,
} from "@mamep2026/data-conversion";

/** 提交地址草稿：更新 addressValue；draft 保留（不因校验清空），成功提交按进制归一化。 */
export function commitAddress(
  row: RegisterRow,
  draft: string,
  radix: RegisterRadix,
): Result<RegisterRow> {
  const parsed = parseRegisterAddressDraft(draft, radix);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const addressResult = value === null ? null : RegisterAddress.create(value);
  if (addressResult !== null && !addressResult.ok) return addressResult;
  const normalizedDraft =
    value === null
      ? draft
      : radix === "hex"
        ? formatRegisterAddress(value, "hex")
        : draft.trim();
  return ok({
    ...row,
    addressDraft: normalizedDraft,
    addressValue: addressResult === null ? null : addressResult.value,
    updatedAt: Date.now(),
  });
}

/** 计算实际发送地址（Address Adjust）。用户地址 0 且 ON 时下溢报错。 */
export function computeSentAddress(
  userAddress: number,
  addressAdjust: "off" | "on",
): Result<number> {
  if (addressAdjust === "on") {
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
  }
  return ok(userAddress);
}
