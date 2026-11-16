/**
 * 单行读/写请求的统一入口（PRD §8.3 P1 键盘操作）。
 * ReadCell/WriteCell（按钮路径）与表格级快捷键（F8 读选中行 / Ctrl+Shift+Enter 写选中行）
 * 共用同一套「请求 → 结果 → 状态点/回读覆盖/消息」逻辑，避免两处复制漂移。
 * 纯函数式（依赖经 deps 注入），便于单测。
 */
import type { ApplicationMessage } from "@mamep2026/logging";
import type {
  RegisterRow,
  RegisterSheet,
  Result,
  RowId,
  SheetId,
} from "@mamep2026/domain";
import {
  applyReadValueToRow,
  applyReadValuesToRow,
} from "@mamep2026/register-table";
import { useAppStore } from "./app-store";
import type { CommunicationHost, HostIdentity, PluginHost } from "./host";
import { requestRouteForSheet } from "./request-route";
import type { ApplyManualResultOptions } from "./row-result";

export interface RowIoDeps {
  updateRow: (rowId: RowId, updater: (row: RegisterRow) => RegisterRow) => void;
  recordManualResult: (
    rowId: RowId,
    result: Result<unknown>,
    kind: "read" | "write",
    options?: ApplyManualResultOptions,
  ) => void;
  appendMessage: (message: ApplicationMessage) => void;
}

function findSheetAndRow(
  rowId: RowId,
): { sheet: RegisterSheet; row: RegisterRow } | null {
  for (const sheet of useAppStore.getState().workspace.sheets) {
    const row = sheet.rows.find((candidate) => candidate.rowId === rowId);
    if (row !== undefined) return { sheet, row };
  }
  return null;
}

/**
 * 单行读取（FC03）：与 ReadCell 按钮路径同一逻辑。
 * 读取失败不改变 Data 单元格内容（§17/§25），失败原因经状态点 Tooltip 展示。
 */
export async function readRowById(
  host: HostIdentity & CommunicationHost & PluginHost,
  rowId: RowId,
  deps: Pick<RowIoDeps, "updateRow" | "recordManualResult">,
): Promise<void> {
  const found = findSheetAndRow(rowId);
  if (found === null) return;
  const { sheet, row } = found;
  const result = await host.readRow(row, requestRouteForSheet(host, sheet));
  // 手动读结果 → 三态状态点（成功清失败态写成功点；失败写失败态并带错误码）。
  deps.recordManualResult(rowId, result, "read");
  if (result.ok) {
    // 多寄存器行：applyReadValuesToRow 更新 registerValues（子行数据源）
    // + cellText（组合文本）；单寄存器行走原路径。
    deps.updateRow(rowId, (r) => {
      const resolver = useAppStore.getState().dataTypeResolver;
      const applied = Array.isArray(result.value)
        ? applyReadValuesToRow(r, result.value)
        : applyReadValueToRow(r, result.value, resolver);
      return applied.ok ? applied.value : r;
    });
  }
}

/** 写后回读成功（一致/不一致）：按读取规则（Type 格式化）强制覆盖单元格（§15.1）。 */
function applyReadBackValue(
  deps: Pick<RowIoDeps, "updateRow">,
  rowId: RowId,
  raws: readonly number[],
): void {
  deps.updateRow(rowId, (row) => {
    const resolver = useAppStore.getState().dataTypeResolver;
    const applied =
      raws.length === 1
        ? applyReadValueToRow(row, raws[0] ?? 0, resolver)
        : applyReadValuesToRow(row, raws);
    return applied.ok ? applied.value : row;
  });
}

/**
 * 单行写（FC0x10，含每表写后回读配置）：与 WriteCell 按钮路径同一逻辑。
 * 回读失败不改写入成功结论（§18.2），提示回读失败原因。
 */
export async function writeRowById(
  host: HostIdentity & CommunicationHost & PluginHost,
  sheetId: SheetId,
  rowId: RowId,
  deps: Pick<RowIoDeps, "updateRow" | "recordManualResult" | "appendMessage">,
): Promise<void> {
  const state = useAppStore.getState();
  const sheet = state.workspace.sheets.find((sh) => sh.sheetId === sheetId);
  if (sheet === undefined) return;
  const row = sheet?.rows.find((r) => r.rowId === rowId);
  if (row === undefined) return;
  // 本表写后回读配置（每表独立）。
  const writeVerify = sheet?.writeVerify ?? {
    mode: "off" as const,
    delayMs: null,
  };
  const result = await host.writeRow(
    row,
    { writeVerify },
    requestRouteForSheet(host, sheet),
  );
  // 手动写结果 → 三态状态点（writeOutcome 支持 §18.2 verify 结果映射）。
  deps.recordManualResult(
    rowId,
    result,
    "write",
    result.ok ? { writeOutcome: result.value } : undefined,
  );
  if (!result.ok) {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "error",
      messageKey: "messages.writeFailed",
      params: { detail: result.error.code },
      detail: result.error.code,
    });
    return;
  }
  const outcome = result.value;
  if (outcome.kind === "write-succeeded-verify-matched") {
    applyReadBackValue(deps, rowId, outcome.readValues);
    deps.appendMessage({
      timestamp: Date.now(),
      level: "info",
      messageKey: "messages.writeVerifyMatched",
      params: { address: row.addressDraft },
      detail: null,
    });
  } else if (outcome.kind === "write-succeeded-verify-mismatched") {
    applyReadBackValue(deps, rowId, outcome.readValues);
    deps.appendMessage({
      timestamp: Date.now(),
      level: "warning",
      messageKey: "messages.writeVerifyMismatch",
      params: {
        address: row.addressDraft,
        expected: outcome.expectedValues.join(", "),
        read: outcome.readValues.join(", "),
      },
      detail: null,
    });
  } else if (outcome.kind === "write-succeeded-verify-failed") {
    // 回读失败：写入成功结论不变（§18.2），提示回读失败原因。
    deps.appendMessage({
      timestamp: Date.now(),
      level: "warning",
      messageKey: outcome.userMessageKey,
      params: { detail: outcome.errorCode },
      detail: outcome.errorCode,
    });
  } else {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "info",
      messageKey: "messages.writeSucceeded",
      params: { address: row.addressDraft },
      detail: null,
    });
  }
}
