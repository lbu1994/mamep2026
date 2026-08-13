/**
 * 寄存器地址格式化与草稿解析（docs/AGENTS.md §16.6、§17.2）。
 * 显示：4 位大写十六进制；输入：可选 0x 前缀、去首尾空格、最多 4 位有效十六进制字符。
 * 校验失败必须返回结构化错误，调用方保留用户输入（不得清空）。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";

export function formatRegisterAddress(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

/** 解析地址草稿：空白返回 null（不发送请求）；非法返回结构化错误。 */
export function parseRegisterAddressDraft(text: string): Result<number | null> {
  const trimmed = text.trim();
  if (trimmed === "") return ok(null);

  let hexPart = trimmed;
  if (/^0[xX]/.test(hexPart)) {
    hexPart = hexPart.slice(2);
  }

  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    return fail(
      createMamepError({
        code: "ADDRESS_INVALID_CHARACTERS",
        category: "validation",
        userMessageKey: "errors.addressInvalidCharacters",
        technicalMessage: `address draft contains invalid characters: ${JSON.stringify(text)}`,
      }),
    );
  }
  if (hexPart.length > 4) {
    return fail(
      createMamepError({
        code: "ADDRESS_TOO_LONG",
        category: "validation",
        userMessageKey: "errors.addressTooLong",
        technicalMessage: `address draft has more than 4 hex digits: ${JSON.stringify(text)}`,
      }),
    );
  }

  return ok(Number.parseInt(hexPart, 16));
}
