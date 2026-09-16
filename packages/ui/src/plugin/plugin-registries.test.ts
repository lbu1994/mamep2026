/**
 * plugin-registries 消费方单测：protocolForSheetType（ADR-041/043 E-2）。
 */
import { describe, expect, it } from "vitest";
import {
  protocolForSheetType,
  type TableTypeContribution,
} from "./plugin-registries";
import type { Contribution } from "@mamep2026/plugin-api";

const noContributions: readonly Contribution<TableTypeContribution>[] = [];

describe("protocolForSheetType", () => {
  it("核心 holding-register → rtu", () => {
    expect(protocolForSheetType("holding-register", noContributions, [])).toBe(
      "rtu",
    );
  });

  it("基础表（ADR-043 E-2）：coil/discrete-input/input-register → 基础表 codec 协议 ID", () => {
    const supported = [
      "modbus-basic-tables:coil",
      "modbus-basic-tables:discrete-input",
      "modbus-basic-tables:input-register",
    ];
    expect(protocolForSheetType("coil", noContributions, supported)).toBe(
      "modbus-basic-tables:coil",
    );
    expect(
      protocolForSheetType("discrete-input", noContributions, supported),
    ).toBe("modbus-basic-tables:discrete-input");
    expect(
      protocolForSheetType("input-register", noContributions, supported),
    ).toBe("modbus-basic-tables:input-register");
  });

  it("基础表协议不在能力矩阵内 → 回退 rtu（能力门控）", () => {
    expect(protocolForSheetType("coil", noContributions, [])).toBe("rtu");
  });

  it("插件表类型 → 查 tableType 贡献的 protocolId", () => {
    const contributions: readonly Contribution<TableTypeContribution>[] = [
      {
        pluginId: "yaskawa-memobus-67h-010dh-010eh",
        payload: {
          id: "holding-register",
          protocolId: "yaskawa-memobus-67h-010dh-010eh",
          titleKey: "plugins.yaskawaTableTypeTitle",
        },
      },
    ];
    expect(
      protocolForSheetType(
        "yaskawa-memobus-67h-010dh-010eh:holding-register",
        contributions,
        ["yaskawa-memobus-67h-010dh-010eh"],
      ),
    ).toBe("yaskawa-memobus-67h-010dh-010eh");
  });

  it("插件表类型协议不在能力矩阵内 → 回退 rtu", () => {
    const contributions: readonly Contribution<TableTypeContribution>[] = [
      {
        pluginId: "yaskawa-memobus-67h-010dh-010eh",
        payload: {
          id: "holding-register",
          protocolId: "yaskawa-memobus-67h-010dh-010eh",
          titleKey: "plugins.yaskawaTableTypeTitle",
        },
      },
    ];
    expect(
      protocolForSheetType(
        "yaskawa-memobus-67h-010dh-010eh:holding-register",
        contributions,
        [],
      ),
    ).toBe("rtu");
  });

  it("未知表类型 → 回退 rtu", () => {
    expect(protocolForSheetType("unknown:type", noContributions, [])).toBe(
      "rtu",
    );
  });
});
