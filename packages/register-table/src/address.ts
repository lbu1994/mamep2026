/**
 * 地址提交与 Address Adjust（docs/AGENTS.md §17.2、ADR-013）。
 * - 编辑态 addressDraft 与提交值 addressValue 分离；
 * - 校验失败保留用户输入并返回结构化错误；
 * - Address Adjust ON 时发送地址 = 用户地址 − 1，日志记录双地址。
 */
import {
  createMamepError,
  RegisterAddress,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { parseRegisterAddressDraft } from "@mamep2026/data-conversion";

/** 提交地址草稿：更新 addressValue；draft 始终保留（不因校验清空）。 */
export function commitAddress(
  row: RegisterRow,
  draft: string,
): Result<RegisterRow> {
  const parsed = parseRegisterAddressDraft(draft);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const addressResult = value === null ? null : RegisterAddress.create(value);
  if (addressResult !== null && !addressResult.ok) return addressResult;
  return ok({
    ...row,
    addressDraft: draft,
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
