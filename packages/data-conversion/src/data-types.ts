/**
 * 16 位数据类型转换（docs/TECH_DESIGN.md §16）。
 * 缩放类型使用确定性的十进制字符串整数运算，禁止浮点误差容差、无提示舍入或截断。
 * Type 只改变解释、输入与显示，不改变寄存器原始值。
 */
import {
  createMamepError,
  isBuiltinDataType,
  type DataType,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";

const SCALE_DIGITS: Partial<Record<DataType, number>> = {
  "unsigned-0.1": 1,
  "unsigned-0.01": 2,
  "unsigned-0.001": 3,
  "unsigned-0.0001": 4,
  "signed-0.1": 1,
  "signed-0.01": 2,
  "signed-0.001": 3,
  "signed-0.0001": 4,
};

/**
 * 错误码 → i18n userMessageKey（packages/ui/src/i18n 驼峰 key，en-US 主 + zh-CN）。
 * 必须与 i18n 文案 key 一致，避免错误文案断链。
 */
const DATA_ERROR_MESSAGE_KEY: Record<string, string> = {
  DATA_EMPTY: "errors.dataEmpty",
  DATA_HEX_INVALID: "errors.dataInvalidNumber",
  DATA_HEX_TOO_LONG: "errors.dataOutOfRange",
  DATA_BINARY_INVALID: "errors.dataInvalidNumber",
  DATA_BINARY_TOO_LONG: "errors.dataOutOfRange",
  DATA_INVALID_NUMBER: "errors.dataInvalidNumber",
  DATA_TOO_MANY_DECIMALS: "errors.dataTooManyDecimals",
  DATA_OUT_OF_RANGE: "errors.dataOutOfRange",
  DATA_STRING_TOO_LONG: "errors.dataOutOfRange",
  DATA_STRING_NON_ASCII: "errors.dataInvalidNumber",
  DATA_BOOL_INVALID: "errors.dataInvalidNumber",
  DATA_UNSUPPORTED_TYPE: "errors.internal",
};

function dataError(code: string, technicalMessage: string) {
  return createMamepError({
    code,
    category: "validation",
    userMessageKey: DATA_ERROR_MESSAGE_KEY[code] ?? "errors.internal",
    technicalMessage,
  });
}

export function isScaled(type: DataType): boolean {
  return SCALE_DIGITS[type] !== undefined;
}

/**
 * 是否为有符号内置类型（查内置表而非前缀推断，避免插件类型名如
 * "signed-custom" 被误判为有符号缩放类型）。
 */
export function isSigned(type: DataType): boolean {
  return (
    type === "signed" || (type.startsWith("signed-") && isBuiltinDataType(type))
  );
}

/** 缩放位数（0.1→1 … 0.0001→4）；非缩放类型返回 0（导出供组合转换复用）。 */
export function getScaleDigits(type: DataType): number {
  return SCALE_DIGITS[type] ?? 0;
}

/**
 * 二进制位串按每 8 位（1 字节）一组加单空格：
 * 16 位 → `00000000 11111111`；32 位 4 组、48 位 6 组、64 位 8 组。
 * 单寄存器与范围行共用（范围行不额外强调寄存器边界，统一单空格）。
 */
export function groupBinaryBits(bits: string): string {
  return bits.replace(/(.{8})(?=.)/g, "$1 ");
}

/** 把原始值按类型格式化为单元格显示文本。 */
export function formatRawValue(raw: number, type: DataType): string {
  switch (type) {
    case "hex":
      return raw.toString(16).toUpperCase().padStart(4, "0");
    case "binary":
      return groupBinaryBits(raw.toString(2).padStart(16, "0"));
    case "string":
      return String.fromCharCode((raw >> 8) & 0xff, raw & 0xff);
    case "bool":
      return raw === 0 ? "0" : "1";
    case "unsigned":
      return String(raw);
    case "signed": {
      const signed = raw >= 0x8000 ? raw - 0x10000 : raw;
      return String(signed);
    }
    default: {
      if (!isScaled(type)) {
        throw new Error(`unsupported data type: ${String(type)}`);
      }
      return formatScaled(raw, type);
    }
  }
}

function formatScaled(raw: number, type: DataType): string {
  const digits = SCALE_DIGITS[type] ?? 0;
  const scale = 10 ** digits;
  const signedValue = isSigned(type) && raw >= 0x8000 ? raw - 0x10000 : raw;
  const sign = signedValue < 0 ? "-" : "";
  const abs = Math.abs(signedValue);
  const intPart = Math.trunc(abs / scale);
  const fracPart = String(abs % scale).padStart(digits, "0");
  return `${sign}${intPart}.${fracPart}`;
}

/** 把单元格文本按类型解析为原始值（0..65535）。失败返回结构化错误，不清空输入。 */
export function parseCellText(text: string, type: DataType): Result<number> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return fail(dataError("DATA_EMPTY", "cell text is empty"));
  }

  switch (type) {
    case "hex":
      return parseHex(trimmed);
    case "binary":
      return parseBinary(trimmed);
    case "string":
      return parseSingleString(trimmed);
    case "bool":
      return parseBool(trimmed);
    case "unsigned":
      return parseInteger(trimmed, false);
    case "signed":
      return parseInteger(trimmed, true);
    default: {
      if (!isScaled(type)) {
        return fail(
          dataError(
            "DATA_UNSUPPORTED_TYPE",
            `unsupported data type: ${String(type)}`,
          ),
        );
      }
      return parseScaled(trimmed, type);
    }
  }
}

/** bool：仅接受 0/1（线圈/离散输入位值）。 */
function parseBool(text: string): Result<number> {
  if (text === "0") return ok(0);
  if (text === "1") return ok(1);
  return fail(
    dataError(
      "DATA_BOOL_INVALID",
      `bool input must be 0 or 1: ${JSON.stringify(text)}`,
    ),
  );
}

function parseHex(text: string): Result<number> {
  let hexPart = text;
  if (/^0[xX]/.test(hexPart)) hexPart = hexPart.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    return fail(
      dataError(
        "DATA_HEX_INVALID",
        `invalid hex input: ${JSON.stringify(text)}`,
      ),
    );
  }
  if (hexPart.length > 4) {
    return fail(
      dataError(
        "DATA_HEX_TOO_LONG",
        `hex input exceeds 4 digits: ${JSON.stringify(text)}`,
      ),
    );
  }
  return ok(Number.parseInt(hexPart, 16));
}

/**
 * 二进制解析：忽略任意空白（空格/制表/换行）后校验，位数上限按去空白后的位数判定；
 * 与范围行 `parseCompositeBinary` 对称，便于粘贴已分组的文本（如 `0000 0000 1111 1111`）。
 * 仍不接受 `0b` 前缀。
 */
function parseBinary(text: string): Result<number> {
  const compact = text.replace(/\s+/g, "");
  if (!/^[01]+$/.test(compact)) {
    return fail(
      dataError(
        "DATA_BINARY_INVALID",
        `binary input must only contain 0 and 1 without prefix: ${JSON.stringify(text)}`,
      ),
    );
  }
  if (compact.length > 16) {
    return fail(
      dataError(
        "DATA_BINARY_TOO_LONG",
        `binary input exceeds 16 bits: ${JSON.stringify(text)}`,
      ),
    );
  }
  return ok(Number.parseInt(compact, 2));
}

/** 单寄存器字符串（registerCount=1）：最多 2 字符，高字节在前，不足补空格。 */
function parseSingleString(text: string): Result<number> {
  if (text.length > 2) {
    return fail(
      dataError(
        "DATA_STRING_TOO_LONG",
        `string exceeds 2 characters for a single register: ${JSON.stringify(text)}`,
      ),
    );
  }
  const padded = text.padEnd(2, " ");
  const hi = padded.charCodeAt(0);
  const lo = padded.charCodeAt(1);
  if (hi > 0xff || lo > 0xff) {
    return fail(
      dataError(
        "DATA_STRING_NON_ASCII",
        `non-ASCII characters are not supported: ${JSON.stringify(text)}`,
      ),
    );
  }
  return ok((hi << 8) | lo);
}

function parseInteger(text: string, signed: boolean): Result<number> {
  if (!/^[+-]?\d+$/.test(text)) {
    return fail(
      dataError(
        "DATA_INVALID_NUMBER",
        `invalid integer input: ${JSON.stringify(text)}`,
      ),
    );
  }
  const value = Number(text);
  if (signed) {
    if (value < -32768 || value > 32767) {
      return fail(
        dataError("DATA_OUT_OF_RANGE", `signed value out of range: ${text}`),
      );
    }
    return ok(value < 0 ? value + 0x10000 : value);
  }
  if (value < 0 || value > 65535) {
    return fail(
      dataError("DATA_OUT_OF_RANGE", `unsigned value out of range: ${text}`),
    );
  }
  return ok(value);
}

function parseScaled(text: string, type: DataType): Result<number> {
  // 只接受普通十进制表示；拒绝科学计数法与本地化小数点。
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) {
    return fail(
      dataError(
        "DATA_INVALID_NUMBER",
        `invalid decimal input: ${JSON.stringify(text)}`,
      ),
    );
  }

  const digits = SCALE_DIGITS[type] ?? 0;
  const scale = 10 ** digits;
  const sign = match[1] === "-" ? -1 : 1;
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";

  if (sign === -1 && !isSigned(type)) {
    return fail(
      dataError(
        "DATA_INVALID_NUMBER",
        `negative value not allowed for ${type}: ${text}`,
      ),
    );
  }

  // 小数位超过类型精度：报错，不静默舍入或截断。
  if (fracPart.length > digits) {
    return fail(
      dataError(
        "DATA_TOO_MANY_DECIMALS",
        `${text} has ${fracPart.length} decimals, ${type} allows ${digits}`,
      ),
    );
  }

  // 整数位过长直接越界，避免大数精度丢失后的边界误判。
  if (intPart.length > 6) {
    return fail(dataError("DATA_OUT_OF_RANGE", `value out of range: ${text}`));
  }

  const scaledValue =
    sign * (Number(intPart) * scale + Number(fracPart.padEnd(digits, "0")));

  if (isSigned(type)) {
    if (scaledValue < -32768 || scaledValue > 32767) {
      return fail(
        dataError(
          "DATA_OUT_OF_RANGE",
          `signed scaled value out of range: ${text}`,
        ),
      );
    }
    return ok(scaledValue < 0 ? scaledValue + 0x10000 : scaledValue);
  }
  if (scaledValue < 0 || scaledValue > 65535) {
    return fail(
      dataError(
        "DATA_OUT_OF_RANGE",
        `unsigned scaled value out of range: ${text}`,
      ),
    );
  }
  return ok(scaledValue);
}
