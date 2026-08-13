/**
 * 寄存器地址：内部表示为 0 至 65535 的整数（docs/AGENTS.md §16.6）。
 * UI 显示为 4 位大写十六进制（由 data-conversion 包负责格式化）。
 */
import { createMamepError, type MamepError } from "./errors";
import { fail, ok, type Result } from "./result";

export class RegisterAddress {
  readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(input: unknown): Result<RegisterAddress> {
    if (typeof input !== "number" || !Number.isInteger(input)) {
      const error: MamepError = createMamepError({
        code: "REGISTER_ADDRESS_INVALID",
        category: "validation",
        userMessageKey: "errors.registerAddressInvalid",
        technicalMessage: `register address must be an integer, got ${String(input)}`,
      });
      return fail(error);
    }
    if (input < 0 || input > 65535) {
      return fail(
        createMamepError({
          code: "REGISTER_ADDRESS_OUT_OF_RANGE",
          category: "validation",
          userMessageKey: "errors.registerAddressOutOfRange",
          technicalMessage: `register address must be within 0..65535, got ${input}`,
        }),
      );
    }
    return ok(new RegisterAddress(input));
  }
}
