/**
 * Modbus RTU 从站地址：已确认允许范围 0~255。
 * 从站地址 0 为广播语义；不实现广播写入，配置为 0 时设备按标准不应答。
 */
import { createMamepError, type MamepError } from "./errors";
import { fail, ok, type Result } from "./result";

export class SlaveAddress {
  readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(input: unknown): Result<SlaveAddress> {
    if (typeof input !== "number" || !Number.isInteger(input)) {
      const error: MamepError = createMamepError({
        code: "SLAVE_ADDRESS_INVALID",
        category: "validation",
        userMessageKey: "errors.slaveAddressInvalid",
        technicalMessage: `slave address must be an integer, got ${String(input)}`,
      });
      return fail(error);
    }
    if (input < 0 || input > 255) {
      return fail(
        createMamepError({
          code: "SLAVE_ADDRESS_OUT_OF_RANGE",
          category: "validation",
          userMessageKey: "errors.slaveAddressOutOfRange",
          technicalMessage: `slave address must be within 0..255, got ${input}`,
        }),
      );
    }
    return ok(new SlaveAddress(input));
  }
}
