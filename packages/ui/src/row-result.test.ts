/**
 * 三态状态点纯函数测试（TDD，docs/AGENTS.md §20/§17/§18.2）。
 * 覆盖：手动读/写成功清除与成功点、失败写入、verify 结果映射（§18.2）、
 * 轮询成功不产生成功点、轮询失败幂等（同态返回原引用，zustand 零更新）、
 * 编辑完成态置位/清除、编辑覆盖成功态。
 */
import { describe, expect, it } from "vitest";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { WriteOutcome } from "@mamep2026/communication";
import {
  applyCellCommit,
  applyManualResult,
  applyPollResultStatus,
  applyRowEdit,
  createEmptyRowStatusState,
  type RowStatusState,
} from "./row-result";

function timeoutError(): ReturnType<typeof createMamepError> {
  return createMamepError({
    code: "REQUEST_TIMEOUT",
    category: "timeout",
    userMessageKey: "errors.requestTimeout",
    technicalMessage: "no response within timeout",
  });
}

function modbusError(): ReturnType<typeof createMamepError> {
  return createMamepError({
    code: "MODBUS_EXCEPTION_02",
    category: "modbus-exception",
    userMessageKey: "errors.modbusException",
    technicalMessage: "modbus exception 02",
  });
}

describe("applyManualResult（手动读/写结果）", () => {
  it("读取成功：清除失败态与编辑完成态，写成功点(kind=read)", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: { r1: { messageKey: "errors.requestTimeout", detail: null } },
      rowDirty: { r1: true },
    };
    const next = applyManualResult(state, "r1", ok(42), "read");
    expect(next.rowResults["r1"]).toBeUndefined();
    expect(next.rowDirty["r1"]).toBeUndefined();
    expect(next.rowSuccess["r1"]).toEqual({ kind: "read" });
  });

  it("读取失败：写失败态(messageKey+code)，清除成功点", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowSuccess: { r1: { kind: "read" } },
    };
    const next = applyManualResult(state, "r1", fail(timeoutError()), "read");
    expect(next.rowResults["r1"]).toEqual({
      messageKey: "errors.requestTimeout",
      detail: "REQUEST_TIMEOUT",
    });
    expect(next.rowSuccess["r1"]).toBeUndefined();
  });

  it("写入成功(no-verify)：写成功点(kind=write)并清除失败态", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: { r1: { messageKey: "errors.requestTimeout", detail: null } },
    };
    const next = applyManualResult(state, "r1", ok({ kind: "write-succeeded-no-verify" as const }), "write", {
      writeOutcome: { kind: "write-succeeded-no-verify" },
    });
    expect(next.rowResults["r1"]).toBeUndefined();
    expect(next.rowSuccess["r1"]).toEqual({ kind: "write" });
  });

  it("写入失败：写失败态并清除成功点，保留编辑完成态（失败值未同步，红点优先显示）", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowDirty: { r1: true },
      rowSuccess: { r1: { kind: "write" } },
    };
    const next = applyManualResult(state, "r1", fail(modbusError()), "write");
    expect(next.rowResults["r1"]).toEqual({
      messageKey: "errors.modbusException",
      detail: "MODBUS_EXCEPTION_02",
    });
    expect(next.rowSuccess["r1"]).toBeUndefined();
    // 失败态不清编辑完成态：失败清除后若值仍未同步，恢复显示编辑完成态。
    expect(next.rowDirty["r1"]).toBe(true);
  });

  it("幂等：同因子失败重复写入返回原引用（zustand 零更新）", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: { r1: { messageKey: "errors.requestTimeout", detail: "REQUEST_TIMEOUT" } },
    };
    const next = applyManualResult(state, "r1", fail(timeoutError()), "read");
    expect(next).toBe(state);
  });

  it("幂等：不同因子失败更新为新失败态", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: { r1: { messageKey: "errors.requestTimeout", detail: "REQUEST_TIMEOUT" } },
    };
    const next = applyManualResult(state, "r1", fail(modbusError()), "read");
    expect(next).not.toBe(state);
    expect(next.rowResults["r1"]).toEqual({
      messageKey: "errors.modbusException",
      detail: "MODBUS_EXCEPTION_02",
    });
  });

  it("幂等：同 kind 成功点重复写入返回原引用", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowSuccess: { r1: { kind: "read" } },
    };
    const next = applyManualResult(state, "r1", ok(1), "read");
    expect(next).toBe(state);
  });

  it("写入成功且已无失败态时，rowResults 引用保持不变（remove 幂等）", () => {
    const state = createEmptyRowStatusState();
    const next = applyManualResult(state, "r1", ok({ kind: "write-succeeded-no-verify" as const }), "write", {
      writeOutcome: { kind: "write-succeeded-no-verify" },
    });
    expect(next.rowResults).toBe(state.rowResults);
    expect(next.rowSuccess["r1"]).toEqual({ kind: "write" });
  });

  it("防御：写入成功但未提供 writeOutcome（调用方契约破坏）不产生成功点，保持原状态", () => {
    const state: RowStatusState = createEmptyRowStatusState();
    const next = applyManualResult(state, "r1", ok(1), "write");
    // 写路径无 outcome 即结果未知：绝不新增成功点（绝不允许「失败却绿点」）。
    expect(next).toBe(state);
    expect(next.rowSuccess["r1"]).toBeUndefined();
    expect(next.rowResults["r1"]).toBeUndefined();
  });

  it("防御：writeOutcome.kind 未被 WRITE_OUTCOME_STATUS 覆盖（未来扩展遗漏）不产生成功点，保持原状态", () => {
    const state: RowStatusState = createEmptyRowStatusState();
    // 模拟未来 WriteOutcome 扩展但映射未同步的运行时情形（§18.2 注释列举的候选 kind）。
    const unknownOutcome = {
      kind: "write-succeeded-verify-mismatched",
    } as unknown as WriteOutcome;
    const next = applyManualResult(state, "r1", ok(unknownOutcome), "write", {
      writeOutcome: unknownOutcome,
    });
    // 未知结果不判定成功也不判定失败：保持原状态，绝不 setSuccess。
    expect(next).toBe(state);
    expect(next.rowSuccess["r1"]).toBeUndefined();
    expect(next.rowResults["r1"]).toBeUndefined();
  });
});

describe("applyPollResultStatus（轮询/全表读取逐行结果）", () => {
  it("轮询成功：清除失败态与编辑完成态，且不产生成功点", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: { r1: { messageKey: "errors.requestTimeout", detail: null } },
      rowDirty: { r1: true },
      rowSuccess: { r1: { kind: "read" } },
    };
    const next = applyPollResultStatus(state, "r1", ok(7));
    expect(next.rowResults["r1"]).toBeUndefined();
    expect(next.rowDirty["r1"]).toBeUndefined();
    // 成功点不被轮询清除：保留最近一次手动操作的成功反馈。
    expect(next.rowSuccess["r1"]).toEqual({ kind: "read" });
  });

  it("轮询失败：写失败态(detail=null)，不清成功点", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowSuccess: { r1: { kind: "read" } },
    };
    const next = applyPollResultStatus(state, "r1", fail(timeoutError()));
    expect(next.rowResults["r1"]).toEqual({
      messageKey: "errors.requestTimeout",
      detail: null,
    });
    expect(next.rowSuccess["r1"]).toEqual({ kind: "read" });
  });

  it("幂等：轮询同因子失败重复返回原引用（设备掉线时零更新）", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: { r1: { messageKey: "errors.requestTimeout", detail: null } },
    };
    const first = applyPollResultStatus(state, "r1", fail(timeoutError()));
    expect(first).toBe(state);
  });

  it("幂等：轮询成功且该行本就无失败态/编辑完成态时返回原引用", () => {
    const state = createEmptyRowStatusState();
    const next = applyPollResultStatus(state, "r1", ok(1));
    expect(next).toBe(state);
  });
});

describe("applyRowEdit（Data 编辑提交）", () => {
  it("值变化：置编辑完成态并清除成功点", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowSuccess: { r1: { kind: "read" } },
    };
    const next = applyRowEdit(state, "r1", "100", "200");
    expect(next.rowDirty["r1"]).toBe(true);
    expect(next.rowSuccess["r1"]).toBeUndefined();
  });

  it("编辑清除失败态：读取/写入失败后编辑 Data，失败态清除并显示编辑完成态（回归）", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: {
        r1: { messageKey: "errors.requestTimeout", detail: "REQUEST_TIMEOUT" },
      },
    };
    const next = applyRowEdit(state, "r1", "100", "200");
    expect(next.rowResults["r1"]).toBeUndefined();
    expect(next.rowDirty["r1"]).toBe(true);
    // 失败态 + 编辑完成态同时存在时，纯函数保证编辑后失败态被清除（显示灰点而非红点）。
  });

  it("编辑回原值（前后一致）：清除编辑完成态与失败态", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowDirty: { r1: true },
      rowResults: {
        r1: { messageKey: "errors.requestTimeout", detail: "REQUEST_TIMEOUT" },
      },
    };
    const next = applyRowEdit(state, "r1", "100", "100");
    expect(next.rowDirty["r1"]).toBeUndefined();
    expect(next.rowResults["r1"]).toBeUndefined();
  });

  it("幂等：已编辑完成态且值未变（重复提交）返回原引用", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowDirty: { r1: true },
    };
    const next = applyRowEdit(state, "r1", "100", "200");
    expect(next.rowDirty["r1"]).toBe(true);
    // 值未变但 rowDirty 已为 true：setDirty 幂等 → 原引用。
    const again = applyRowEdit(state, "r1", "100", "200");
    expect(again).toBe(state);
    void next;
  });

  it("编辑覆盖成功态：值变化时成功点被清除（下一次操作覆盖语义）", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowSuccess: { r1: { kind: "write" } },
      rowDirty: { r1: true },
    };
    const next = applyRowEdit(state, "r1", "100", "100");
    expect(next.rowDirty["r1"]).toBeUndefined();
    expect(next.rowSuccess["r1"]).toBeUndefined();
  });
});

describe("applyCellCommit（单元格提交校验，Data/地址）", () => {
  function dataInvalidError(): ReturnType<typeof createMamepError> {
    return createMamepError({
      code: "DATA_INVALID_NUMBER",
      category: "validation",
      userMessageKey: "errors.dataInvalidNumber",
      technicalMessage: "invalid integer input",
    });
  }

  it("成功（值变化）：清除校验错误、置编辑完成态、清成功点", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      cellValidationErrors: {
        "r1:data": {
          messageKey: "errors.dataInvalidNumber",
          detail: "DATA_INVALID_NUMBER",
        },
      },
      rowSuccess: { r1: { kind: "read" } },
    };
    const next = applyCellCommit(state, "r1", "100", "200", ok(200));
    expect(next.cellValidationErrors["r1:data"]).toBeUndefined();
    expect(next.rowDirty["r1"]).toBe(true);
    expect(next.rowSuccess["r1"]).toBeUndefined();
  });

  it("成功（回原值）：清除校验错误与编辑完成态", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      cellValidationErrors: {
        "r1:data": {
          messageKey: "errors.dataInvalidNumber",
          detail: "DATA_INVALID_NUMBER",
        },
      },
      rowDirty: { r1: true },
    };
    const next = applyCellCommit(state, "r1", "100", "100", ok(100));
    expect(next.cellValidationErrors["r1:data"]).toBeUndefined();
    expect(next.rowDirty["r1"]).toBeUndefined();
  });

  it("失败：记录校验错误、清设备失败态与成功点、保留编辑完成态（值仍未同步）", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      rowResults: {
        r1: { messageKey: "errors.requestTimeout", detail: null },
      },
      rowDirty: { r1: true },
      rowSuccess: { r1: { kind: "write" } },
    };
    const next = applyCellCommit(state, "r1", "100", "zz", fail(dataInvalidError()));
    expect(next.cellValidationErrors["r1:data"]).toEqual({
      messageKey: "errors.dataInvalidNumber",
      detail: "DATA_INVALID_NUMBER",
    });
    expect(next.rowResults["r1"]).toBeUndefined();
    expect(next.rowSuccess["r1"]).toBeUndefined();
    expect(next.rowDirty["r1"]).toBe(true);
  });

  it("失败幂等：同因子校验失败重复返回原引用", () => {
    const state: RowStatusState = {
      ...createEmptyRowStatusState(),
      cellValidationErrors: {
        "r1:data": {
          messageKey: "errors.dataInvalidNumber",
          detail: "DATA_INVALID_NUMBER",
        },
      },
    };
    const next = applyCellCommit(state, "r1", "100", "zz", fail(dataInvalidError()));
    expect(next).toBe(state);
  });
});
