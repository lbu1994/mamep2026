/**
 * 多寄存器组合类型转换。
 *
 * 范围行（Address 列 `start-end`，registerCount>1）一次请求读写多个连续寄存器，组合宽度由
 * 范围长度决定：32 位 = 2、64 位 = 4、二进制 1/2/3/4、HEX 与字符串任意数量。字节序默认大端
 * （高字在前，Modbus 惯例）。
 *
 * 合法寄存器数（跨字段校验，错误显示在进制列并禁止读写）：
 * - Unsigned/Signed（含各 scale）：1 / 2 / 4；
 * - Binary：1 / 2 / 3 / 4；
 * - HEX / String：任意数量（>= 1）。
 */
import {
  createMamepError,
  isBuiltinDataType,
  type DataType,
  type Result,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { isFloatType, formatFloatWords, parseFloatWords } from "./floating-point";
import {
  getScaleDigits,
  groupBinaryBits,
  isScaled,
  isSigned,
} from "./data-types";

const DECIMAL_ALLOWED = [1, 2, 4];
const BINARY_ALLOWED = [1, 2, 3, 4];

const MULTI_ERROR_MESSAGE_KEY: Record<string, string> = {
  DATA_EMPTY: "errors.dataEmpty",
  DATA_INVALID_REGISTER_COUNT: "errors.dataInvalidNumber",
  DATA_HEX_INVALID: "errors.dataInvalidNumber",
  DATA_HEX_TOO_LONG: "errors.dataOutOfRange",
  DATA_BINARY_INVALID: "errors.dataInvalidNumber",
  DATA_BINARY_TOO_LONG: "errors.dataOutOfRange",
  DATA_INVALID_NUMBER: "errors.dataInvalidNumber",
  DATA_TOO_MANY_DECIMALS: "errors.dataTooManyDecimals",
  DATA_OUT_OF_RANGE: "errors.dataOutOfRange",
  DATA_STRING_TOO_LONG: "errors.dataOutOfRange",
  DATA_STRING_NON_ASCII: "errors.dataInvalidNumber",
  DATA_UNSUPPORTED_TYPE: "errors.internal",
};

function multiError(code: string, technicalMessage: string) {
  return createMamepError({
    code,
    category: "validation",
    userMessageKey: MULTI_ERROR_MESSAGE_KEY[code] ?? "errors.internal",
    technicalMessage,
  });
}

/** 类型允许的寄存器数；hex/string 返回 "any"（任意数量，>=1）。 */
export function allowedRegisterCounts(
  type: DataType,
): readonly number[] | "any" {
  if (type === "hex" || type === "string") return "any";
  if (type === "binary") return BINARY_ALLOWED;
  if (type === "float32") return [2];
  if (type === "float64") return [4];
  // bool：单寄存器（线圈/离散输入一行一个位）。
  if (type === "bool") return [1];
  // 插件类型（范围收敛）：仅单寄存器（registerCount 恒 1），范围行拒绝。
  if (!isBuiltinDataType(type)) return [1];
  return DECIMAL_ALLOWED;
}

/** 校验「范围长度 × 类型合法集」。 */
export function isValidRegisterCount(type: DataType, count: number): boolean {
  const allowed = allowedRegisterCounts(type);
  if (allowed === "any") return count >= 1;
  return allowed.includes(count);
}

/** 把组合值（各寄存器原始值，大端）格式化为单元格显示文本。 */
export function formatRawValues(values: number[], type: DataType): string {
  if (isFloatType(type)) {
    const formatted = formatFloatWords(values, type);
    if (!formatted.ok) throw new Error(formatted.error.technicalMessage);
    return formatted.value;
  }
  const combined = values.reduce(
    (acc, value) => (acc << 16n) | BigInt(value & 0xffff),
    0n,
  );
  switch (type) {
    case "hex":
      return values
        .map((value) => value.toString(16).toUpperCase().padStart(4, "0"))
        .join(" ");
    case "binary":
      // 每 8 位一组：32 位 4 组、48 位 6 组、64 位 8 组。
      return groupBinaryBits(
        values.map((value) => value.toString(2).padStart(16, "0")).join(""),
      );
    case "string":
      return decodeAscii(values);
    case "unsigned":
      return combined.toString(10);
    case "signed":
      return signedComposite(combined, values.length * 16).toString(10);
    default: {
      if (!isScaled(type)) {
        throw new Error(`unsupported data type: ${String(type)}`);
      }
      return formatScaledComposite(
        combined,
        values.length * 16,
        isSigned(type),
        getScaleDigits(type),
      );
    }
  }
}

/** 把单元格文本按类型解析为各寄存器原始值（长度 = registerCount，0..65535）。 */
export function parseCompositeText(
  text: string,
  type: DataType,
  registerCount: number,
): Result<number[]> {
  if (!isValidRegisterCount(type, registerCount)) {
    return fail(
      multiError(
        "DATA_INVALID_REGISTER_COUNT",
        `register count ${registerCount} not allowed for ${type}`,
      ),
    );
  }
  const trimmed = text.trim();
  if (trimmed === "") {
    return fail(multiError("DATA_EMPTY", "cell text is empty"));
  }
  if (isFloatType(type)) return parseFloatWords(trimmed, type);
  switch (type) {
    case "hex":
      return parseCompositeHex(trimmed, registerCount);
    case "binary":
      return parseCompositeBinary(trimmed, registerCount);
    case "string":
      return parseCompositeString(text, registerCount);
    case "unsigned":
      return parseCompositeInteger(trimmed, registerCount, false, null);
    case "signed":
      return parseCompositeInteger(trimmed, registerCount, true, null);
    default: {
      if (!isScaled(type)) {
        return fail(
          multiError(
            "DATA_UNSUPPORTED_TYPE",
            `unsupported data type: ${String(type)}`,
          ),
        );
      }
      return parseCompositeInteger(
        trimmed,
        registerCount,
        isSigned(type),
        getScaleDigits(type),
      );
    }
  }
}

/** 大端组合值按指定位数解释为有符号 BigInt（补码）。 */
function signedComposite(combined: bigint, bits: number): bigint {
  const modulus = 1n << BigInt(bits);
  const signBit = 1n << BigInt(bits - 1);
  if ((combined & signBit) !== 0n) return combined - modulus;
  return combined;
}

/** ASCII 解码：每寄存器 2 字节（高字节在前）。 */
function decodeAscii(values: number[]): string {
  let out = "";
  for (const value of values) {
    out += String.fromCharCode((value >> 8) & 0xff, value & 0xff);
  }
  return out;
}

/** 缩放组合值格式化：整数部分.小数部分（十进制定点，防浮点误差）。 */
function formatScaledComposite(
  combined: bigint,
  bits: number,
  signed: boolean,
  digits: number,
): string {
  const value = signed ? signedComposite(combined, bits) : combined;
  const scale = 10n ** BigInt(digits);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const intPart = abs / scale;
  const fracPart = String(abs % scale).padStart(digits, "0");
  return `${sign}${intPart}.${fracPart}`;
}

/** hex：空格分隔的 4 位组，或连续串（按 4 位切分）。 */
function parseCompositeHex(
  text: string,
  registerCount: number,
): Result<number[]> {
  const tokens = text.split(/\s+/);
  const groups: string[] = [];
  if (tokens.length === 1) {
    let hex = tokens[0] ?? "";
    if (/^0[xX]/.test(hex)) hex = hex.slice(2);
    if (hex.length === 0 || hex.length % 4 !== 0) {
      return fail(
        multiError(
          "DATA_HEX_INVALID",
          `hex groups must be 4 digits each: ${JSON.stringify(text)}`,
        ),
      );
    }
    for (let i = 0; i < hex.length; i += 4) groups.push(hex.slice(i, i + 4));
  } else {
    for (const token of tokens) {
      let hex = token;
      if (/^0[xX]/.test(hex)) hex = hex.slice(2);
      groups.push(hex);
    }
  }
  if (groups.length !== registerCount) {
    return fail(
      multiError(
        "DATA_INVALID_REGISTER_COUNT",
        `expected ${registerCount} registers, got ${groups.length} hex groups`,
      ),
    );
  }
  const values: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]+$/.test(group) || group.length > 4) {
      return fail(
        multiError(
          "DATA_HEX_INVALID",
          `invalid hex group: ${JSON.stringify(group)}`,
        ),
      );
    }
    values.push(Number.parseInt(group, 16));
  }
  return ok(values);
}

/** binary：位串（忽略任意空白，与单寄存器 parseBinary 对称），不足 registerCount*16 位前补零。 */
function parseCompositeBinary(
  text: string,
  registerCount: number,
): Result<number[]> {
  const compact = text.replace(/\s+/g, "");
  const width = registerCount * 16;
  if (!/^[01]+$/.test(compact)) {
    return fail(
      multiError(
        "DATA_BINARY_INVALID",
        `binary input must only contain 0 and 1: ${JSON.stringify(text)}`,
      ),
    );
  }
  if (compact.length > width) {
    return fail(
      multiError(
        "DATA_BINARY_TOO_LONG",
        `binary input exceeds ${width} bits for ${registerCount} registers`,
      ),
    );
  }
  const padded = compact.padStart(width, "0");
  const values: number[] = [];
  for (let i = 0; i < registerCount; i++) {
    values.push(Number.parseInt(padded.slice(i * 16, (i + 1) * 16), 2));
  }
  return ok(values);
}

/** string：ASCII，每寄存器 2 字符（高字节在前），不足补空格。 */
function parseCompositeString(
  text: string,
  registerCount: number,
): Result<number[]> {
  const maxChars = registerCount * 2;
  if (text.length > maxChars) {
    return fail(
      multiError(
        "DATA_STRING_TOO_LONG",
        `string exceeds ${maxChars} characters for ${registerCount} registers: ${JSON.stringify(text)}`,
      ),
    );
  }
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0xff) {
      return fail(
        multiError(
          "DATA_STRING_NON_ASCII",
          `non-ASCII characters are not supported: ${JSON.stringify(text)}`,
        ),
      );
    }
  }
  const padded = text.padEnd(maxChars, " ");
  const values: number[] = [];
  for (let i = 0; i < registerCount; i++) {
    values.push((padded.charCodeAt(i * 2) << 8) | padded.charCodeAt(i * 2 + 1));
  }
  return ok(values);
}

/** 十进制（可缩放）解析为大端寄存器字数组。 */
function parseCompositeInteger(
  text: string,
  registerCount: number,
  signed: boolean,
  scaleDigits: number | null,
): Result<number[]> {
  const bits = registerCount * 16;
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = signed
    ? (1n << BigInt(bits - 1)) - 1n
    : (1n << BigInt(bits)) - 1n;

  let value: bigint;
  if (scaleDigits === null) {
    if (!/^[+-]?\d+$/.test(text)) {
      return fail(
        multiError(
          "DATA_INVALID_NUMBER",
          `invalid integer input: ${JSON.stringify(text)}`,
        ),
      );
    }
    value = BigInt(text);
  } else {
    const parsed = parseScaledBigInt(text, scaleDigits, signed);
    if (!parsed.ok) return parsed;
    value = parsed.value;
  }

  if (value < min || value > max) {
    return fail(
      multiError(
        "DATA_OUT_OF_RANGE",
        `value out of range for ${registerCount} register(s) ${signed ? "signed" : "unsigned"}`,
      ),
    );
  }

  const words: number[] = [];
  for (let i = 0; i < registerCount; i++) {
    const shift = BigInt(16 * (registerCount - 1 - i));
    words.push(Number((value >> shift) & 0xffffn));
  }
  return ok(words);
}

/** 缩放十进制 → BigInt（十进制定点，防浮点误差）。 */
function parseScaledBigInt(
  text: string,
  digits: number,
  signed: boolean,
): Result<bigint> {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) {
    return fail(
      multiError(
        "DATA_INVALID_NUMBER",
        `invalid decimal input: ${JSON.stringify(text)}`,
      ),
    );
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";
  if (sign === -1n && !signed) {
    return fail(
      multiError("DATA_INVALID_NUMBER", `negative value not allowed: ${text}`),
    );
  }
  if (fracPart.length > digits) {
    return fail(
      multiError(
        "DATA_TOO_MANY_DECIMALS",
        `${text} has ${fracPart.length} decimals, allows ${digits}`,
      ),
    );
  }
  const scale = 10n ** BigInt(digits);
  const scaled =
    sign * (BigInt(intPart) * scale + BigInt(fracPart.padEnd(digits, "0")));
  return ok(scaled);
}
