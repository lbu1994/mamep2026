import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { RtuConnectionProfile } from "@mamep2026/domain";
import {
  ANDROID_SUPPORTED_BAUD_RATES,
  validateSerialParameters,
} from "./serial-parameters";

function profileWith(
  overrides: Partial<RtuConnectionProfile> = {},
): RtuConnectionProfile {
  return { ...createDefaultRtuProfile("USB-RS485"), ...overrides };
}

describe("validateSerialParameters（Android 链路口径）", () => {
  it("接受默认 9600 / 8N1 / 无流控", () => {
    expect(validateSerialParameters(profileWith())).toEqual({ ok: true });
  });

  it("接受全部已声明支持的波特率", () => {
    for (const baudRate of ANDROID_SUPPORTED_BAUD_RATES) {
      expect(validateSerialParameters(profileWith({ baudRate }))).toEqual({
        ok: true,
      });
    }
  });

  it("拒绝不在支持集合内的波特率（如 921600）", () => {
    const result = validateSerialParameters(profileWith({ baudRate: 921600 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("921600");
  });

  it("接受 7 数据位 / 2 停止位 / 奇偶校验 / RTS-CTS", () => {
    expect(
      validateSerialParameters(
        profileWith({
          dataBits: 7,
          stopBits: 2,
          parity: "even",
          flowControl: "rts-cts",
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("接受奇校验 + XON/XOFF", () => {
    expect(
      validateSerialParameters(
        profileWith({ parity: "odd", flowControl: "xon-xoff" }),
      ),
    ).toEqual({ ok: true });
  });
});
