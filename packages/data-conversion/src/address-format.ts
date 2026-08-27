/**
 * 寄存器地址格式化与草稿解析（docs/AGENTS.md §16.6、§17.2、ADR-014、ADR-030）。
 * - HEX：显示 4 位大写十六进制；输入仅 1~4 位十六进制字符（不接受 0x 前缀）；
 * - DEC：显示十进制；输入仅十进制数字 0~65535（超范围报错）；
 * - 范围行（ADR-030）：支持 `start-end`（HEX `0400-0401` / DEC `1000-1001`），
 *   解析为 { value: 起始地址, count: 覆盖寄存器数 }；
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

/** 按进制格式化地址范围（ADR-030）：HEX "0400-0401"；DEC "1000-1001"；count=1 时即单地址。 */
export function formatRegisterAddressRange(
  value: number,
  count: number,
  radix: RegisterRadix,
): string {
  if (count <= 1) return formatRegisterAddress(value, radix);
  return `${formatRegisterAddress(value, radix)}-${formatRegisterAddress(
    value + count - 1,
    radix,
  )}`;
}

/** 解析后的地址：起始地址 + 覆盖的连续寄存器数（ADR-030 范围行）。 */
export interface ParsedRegisterAddress {
  value: number;
  count: number;
}

/** 解析地址草稿：空白返回 null（不发送请求）；非法返回结构化错误。 */
export function parseRegisterAddressDraft(
  text: string,
  radix: RegisterRadix,
): Result<ParsedRegisterAddress | null> {
  const trimmed = text.trim();
  if (trimmed === "") return ok(null);

  const parts = trimmed.split("-");
  if (parts.length === 1) {
    const single = parseAddressPart(parts[0] ?? "", radix);
    if (!single.ok) return single;
    return ok({ value: single.value, count: 1 });
  }
  if (parts.length === 2) {
    const start = parseAddressPart(parts[0] ?? "", radix);
    if (!start.ok) return start;
    const end = parseAddressPart(parts[1] ?? "", radix);
    if (!end.ok) return end;
    if (end.value < start.value) {
      return fail(
        createMamepError({
          code: "ADDRESS_RANGE_REVERSED",
          category: "validation",
          userMessageKey: "errors.addressRangeReversed",
          technicalMessage: `range end before start: ${JSON.stringify(text)}`,
        }),
      );
    }
    return ok({ value: start.value, count: end.value - start.value + 1 });
  }
  return fail(
    createMamepError({
      code: "ADDRESS_INVALID_CHARACTERS",
      category: "validation",
      userMessageKey: "errors.addressInvalidCharacters",
      technicalMessage: `address range must be start-end: ${JSON.stringify(text)}`,
    }),
  );
}

/** 解析范围单段（HEX 1~4 位 / DEC 0~65535）。 */
function parseAddressPart(
  part: string,
  radix: RegisterRadix,
): Result<number> {
  if (radix === "hex") {
    if (!/^[0-9a-fA-F]+$/.test(part)) {
      return fail(
        createMamepError({
          code: "ADDRESS_INVALID_CHARACTERS",
          category: "validation",
          userMessageKey: "errors.addressInvalidCharacters",
          technicalMessage: `address draft contains invalid characters: ${JSON.stringify(part)}`,
        }),
      );
    }
    if (part.length > 4) {
      return fail(
        createMamepError({
          code: "ADDRESS_TOO_LONG",
          category: "validation",
          userMessageKey: "errors.addressTooLong",
          technicalMessage: `address draft has more than 4 hex digits: ${JSON.stringify(part)}`,
        }),
      );
    }
    return ok(Number.parseInt(part, 16));
  }

  // DEC：仅十进制数字，值域 0~65535。
  if (!/^[0-9]+$/.test(part)) {
    return fail(
      createMamepError({
        code: "ADDRESS_INVALID_CHARACTERS",
        category: "validation",
        userMessageKey: "errors.addressInvalidCharacters",
        technicalMessage: `address draft contains invalid characters: ${JSON.stringify(part)}`,
      }),
    );
  }
  const value = Number.parseInt(part, 10);
  if (value > 65535) {
    return fail(
      createMamepError({
        code: "ADDRESS_OUT_OF_RANGE",
        category: "validation",
        userMessageKey: "errors.addressOutOfRange",
        technicalMessage: `address draft exceeds 65535: ${JSON.stringify(part)}`,
      }),
    );
  }
  return ok(value);
}
