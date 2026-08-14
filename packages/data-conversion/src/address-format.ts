/**
 * 寄存器地址格式化与草稿解析（docs/AGENTS.md §16.6、§17.2、ADR-014）。
 * - HEX：显示 4 位大写十六进制；输入仅 1~4 位十六进制字符（不接受 0x 前缀）；
 * - DEC：显示十进制；输入仅十进制数字 0~65535（超范围报错）；
 * - 校验失败必须返回结构化错误，调用方保留用户输入（不得清空）。
 */
import {
  createMamepError,
  type RegisterRadix,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";

/** 按进制格式化地址值：HEX 4 位大写补零；DEC 十进制（不补零）。 */
export function formatRegisterAddress(
  value: number,
  radix: RegisterRadix,
): string {
  if (radix === "hex") {
    return value.toString(16).toUpperCase().padStart(4, "0");
  }
  return String(value);
}

/** 解析地址草稿：空白返回 null（不发送请求）；非法返回结构化错误。 */
export function parseRegisterAddressDraft(
  text: string,
  radix: RegisterRadix,
): Result<number | null> {
  const trimmed = text.trim();
  if (trimmed === "") return ok(null);

  if (radix === "hex") {
    if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
      return fail(
        createMamepError({
          code: "ADDRESS_INVALID_CHARACTERS",
          category: "validation",
          userMessageKey: "errors.addressInvalidCharacters",
          technicalMessage: `address draft contains invalid characters: ${JSON.stringify(text)}`,
        }),
      );
    }
    if (trimmed.length > 4) {
      return fail(
        createMamepError({
          code: "ADDRESS_TOO_LONG",
          category: "validation",
          userMessageKey: "errors.addressTooLong",
          technicalMessage: `address draft has more than 4 hex digits: ${JSON.stringify(text)}`,
        }),
      );
    }
    return ok(Number.parseInt(trimmed, 16));
  }

  // DEC：仅十进制数字，值域 0~65535。
  if (!/^[0-9]+$/.test(trimmed)) {
    return fail(
      createMamepError({
        code: "ADDRESS_INVALID_CHARACTERS",
        category: "validation",
        userMessageKey: "errors.addressInvalidCharacters",
        technicalMessage: `address draft contains invalid characters: ${JSON.stringify(text)}`,
      }),
    );
  }
  const value = Number.parseInt(trimmed, 10);
  if (value > 65535) {
    return fail(
      createMamepError({
        code: "ADDRESS_OUT_OF_RANGE",
        category: "validation",
        userMessageKey: "errors.addressOutOfRange",
        technicalMessage: `address draft exceeds 65535: ${JSON.stringify(text)}`,
      }),
    );
  }
  return ok(value);
}
