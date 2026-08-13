/**
 * 16 位寄存器原始值：0 至 65535 的整数。
 * 只能通过受控工厂 create 创建（docs/AGENTS.md §9.2、§16.1）。
 */
import { createMamepError, type MamepError } from "./errors";
import { fail, ok, type Result } from "./result";

export class RawRegisterValue {
  readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(input: unknown): Result<RawRegisterValue> {
    const error = validateRawRegisterValue(input);
    if (error !== null) return fail(error);
    return ok(new RawRegisterValue(input as number));
  }
}

function validateRawRegisterValue(input: unknown): MamepError | null {
  if (typeof input !== "number") {
    return createMamepError({
      code: "RAW_VALUE_INVALID_TYPE",
      category: "validation",
      userMessageKey: "errors.rawValueInvalidType",
      technicalMessage: `raw register value must be a number, got ${String(input)}`,
    });
  }
  if (!Number.isInteger(input)) {
    return createMamepError({
      code: "RAW_VALUE_NOT_INTEGER",
      category: "validation",
      userMessageKey: "errors.rawValueNotInteger",
      technicalMessage: `raw register value must be an integer, got ${input}`,
    });
  }
  if (input < 0 || input > 65535) {
    return createMamepError({
      code: "RAW_VALUE_OUT_OF_RANGE",
      category: "validation",
      userMessageKey: "errors.rawValueOutOfRange",
      technicalMessage: `raw register value must be within 0..65535, got ${input}`,
    });
  }
  return null;
}
