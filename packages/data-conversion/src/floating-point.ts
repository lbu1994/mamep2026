import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";

export type FloatDataType = "float32" | "float64";

const WORD_BYTES = 2;
const FLOAT32_FRACTION_BITS = 23;
const FLOAT32_MIN_NORMAL_EXPONENT = -126;
const FLOAT32_MAX_NORMAL_EXPONENT = 127;
const FLOAT32_MIN_UNIT_EXPONENT =
  FLOAT32_MIN_NORMAL_EXPONENT - FLOAT32_FRACTION_BITS;
const FLOAT_WORDS = { float32: 2, float64: 4 } as const;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Identify the two fixed-width IEEE 754 types. */
export function isFloatType(type: string): type is FloatDataType {
  return type === "float32" || type === "float64";
}

function floatError(code: string, message: string) {
  return createMamepError({
    code,
    category: "validation",
    userMessageKey:
      code === "DATA_OUT_OF_RANGE"
        ? "errors.dataOutOfRange"
        : "errors.dataInvalidNumber",
    technicalMessage: message,
  });
}

/** Decode high-word-first, big-endian words. Reject wrong widths and non-finite values. */
export function decodeFloatWords(
  values: readonly number[],
  type: FloatDataType,
): Result<number> {
  if (values.length !== FLOAT_WORDS[type]) {
    return fail(
      floatError(
        "DATA_INVALID_REGISTER_COUNT",
        `${type} requires ${FLOAT_WORDS[type]} registers`,
      ),
    );
  }
  const view = new DataView(new ArrayBuffer(values.length * WORD_BYTES));
  for (const [wordIndex, word] of values.entries()) {
    if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
      return fail(
        floatError(
          "DATA_OUT_OF_RANGE",
          "register word must be an unsigned 16-bit integer",
        ),
      );
    }
    view.setUint16(wordIndex * WORD_BYTES, word, false);
  }
  const value =
    type === "float32" ? view.getFloat32(0, false) : view.getFloat64(0, false);
  return Number.isFinite(value)
    ? ok(value)
    : fail(floatError("DATA_NON_FINITE", `${type} value must be finite`));
}

/** Format the decoded value using a round-trip decimal string; preserve negative zero. */
export function formatFloatWords(
  values: readonly number[],
  type: FloatDataType,
): Result<string> {
  const decoded = decodeFloatWords(values, type);
  if (!decoded.ok) return decoded;
  return ok(Object.is(decoded.value, -0) ? "-0" : String(decoded.value));
}

/**
 * Parse decimal or scientific notation and round to nearest, ties to even.
 * Reject non-finite values, overflow and nonzero input rounded to zero.
 * Return high-word-first words; no warning or confirmation is required.
 */
export function parseFloatWords(
  text: string,
  type: FloatDataType,
): Result<number[]> {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) {
    return fail(
      floatError(
        "DATA_INVALID_NUMBER",
        "expected a finite decimal floating-point value",
      ),
    );
  }
  const value = Number(trimmed);
  const rounded =
    type === "float32" ? roundDecimalToFloat32(trimmed, value) : value;
  const mantissa = trimmed.split(/[eE]/)[0] ?? "";
  if (!Number.isFinite(rounded) || (rounded === 0 && /[1-9]/.test(mantissa))) {
    return fail(
      floatError("DATA_OUT_OF_RANGE", `${type} overflow or underflow to zero`),
    );
  }
  const view = new DataView(new ArrayBuffer(FLOAT_WORDS[type] * WORD_BYTES));
  if (type === "float32") view.setFloat32(0, rounded, false);
  else view.setFloat64(0, rounded, false);
  return ok(
    Array.from({ length: FLOAT_WORDS[type] }, (_, wordIndex) =>
      view.getUint16(wordIndex * WORD_BYTES, false),
    ),
  );
}

/**
 * Round the decimal rational directly to binary32 to avoid a second rounding
 * through binary64 at binary32 midpoints. Number bounds the exponent first.
 */
function roundDecimalToFloat32(text: string, value: number): number {
  const candidate = Math.fround(value);
  if (!Number.isFinite(value) || value === 0) return candidate;
  // Values outside this interval cannot round to a finite, nonzero binary32.
  if (
    Math.abs(value) > 2 ** (FLOAT32_MAX_NORMAL_EXPONENT + 1) ||
    Math.abs(value) < 2 ** (FLOAT32_MIN_UNIT_EXPONENT - 1)
  )
    return candidate;
  const [mantissa = "", exponentText = "0"] = text
    .replace(/^[+-]/, "")
    .split(/[eE]/);
  const [integer = "", fraction = ""] = mantissa.split(".");
  const digits = (integer + fraction).replace(/^0+/, "").replace(/0+$/, "");
  const trailingZeros =
    (integer + fraction).length -
    (integer + fraction).replace(/0+$/, "").length;
  const decimalExponent =
    Number(exponentText) - fraction.length + trailingZeros;
  let numerator = BigInt(digits);
  let denominator = 1n;
  if (decimalExponent >= 0) numerator *= 10n ** BigInt(decimalExponent);
  else denominator = 10n ** BigInt(-decimalExponent);

  // Find the binary exponent using exact integer comparisons.
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  const belowPower =
    exponent >= 0
      ? numerator < denominator << BigInt(exponent)
      : numerator << BigInt(-exponent) < denominator;
  if (belowPower) exponent -= 1;
  const unitExponent = Math.max(
    exponent - FLOAT32_FRACTION_BITS,
    FLOAT32_MIN_UNIT_EXPONENT,
  );
  if (unitExponent < 0) numerator <<= BigInt(-unitExponent);
  else denominator <<= BigInt(unitExponent);
  let significand = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && (significand & 1n) === 1n)
  ) {
    significand += 1n;
  }
  const rounded = Number(significand) * 2 ** unitExponent;
  return Math.fround(text.startsWith("-") ? -rounded : rounded);
}
