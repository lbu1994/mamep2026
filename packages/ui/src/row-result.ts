/**
 * 寄存器行「操作结果三态状态点」纯函数（Data 列，docs/AGENTS.md §17/§18/§20）。
 * - 失败态 rowResults：最近一次失败（messageKey + detail）；成功即清除；
 * - 编辑完成态 rowDirty：Data 编辑提交且值变化（尚未同步到设备）；
 * - 成功态 rowSuccess：手动读/写成功后（轮询成功不产生成功点，值更新即反馈）。
 *
 * 纯函数、无副作用、可独立单测；zustand 订阅靠「同态返回原引用」短路（幂等），
 * 保证轮询/设备掉线等高频失败场景下 store 零更新（性能关键，见轮询设计）。
 * 本模块不触碰 React、antd 或平台 API。
 */
import type { Result } from "@mamep2026/domain";
import type { WriteOutcome } from "@mamep2026/communication";

/** 失败态：messageKey 用于 i18n 渲染用户文案（§20），detail 为稳定错误码/详情。 */
export interface RowFailure {
  messageKey: string;
  detail: string | null;
}

/** 行失败态映射（key = rowId）。undefined 表示该行无失败态。 */
export type RowResults = Record<string, RowFailure | undefined>;

export type RowSuccessKind = "read" | "write";

/** 行成功态（仅手动操作产生）：kind 决定 Tooltip 文案「读取成功/写入成功」。 */
export interface RowSuccess {
  kind: RowSuccessKind;
}

export type RowSuccessMap = Record<string, RowSuccess | undefined>;

/** 三态状态的完整切片（app-store 持有），纯函数整体操作、可整体单测。 */
export interface RowStatusState {
  rowResults: RowResults;
  rowDirty: Record<string, boolean>;
  rowSuccess: RowSuccessMap;
  /** 单元格提交校验错误（纯 UI 会话状态，不持久化）：Data/地址列编辑提交非法值时记录，成功提交清除。
   *  键 = `${rowId}:data`（Data 列）或 `${rowId}:address`（地址列），两列独立不串显。 */
  cellValidationErrors: Record<string, RowFailure | undefined>;
}

export function createEmptyRowStatusState(): RowStatusState {
  return {
    rowResults: {},
    rowDirty: {},
    rowSuccess: {},
    cellValidationErrors: {},
  };
}

/** §18.2 写后回读结果 → 三态（success/failure/none）。 */
export type WriteResultStatus = "success" | "failure" | "none";

// 写后回读（2026-08-26）：WriteOutcome 扩展为 5 种 kind，由 Record 保证类型穷尽：
//   write-succeeded-no-verify         -> success
//   write-succeeded-verify-matched    -> success
//   write-succeeded-verify-mismatched -> failure
//   write-succeeded-verify-failed     -> failure
//   cancelled-before-verify           -> none（写入已成功仅回读取消，不显示失败态）
const WRITE_OUTCOME_STATUS: Record<WriteOutcome["kind"], WriteResultStatus> = {
  "write-succeeded-no-verify": "success",
  "write-succeeded-verify-matched": "success",
  "write-succeeded-verify-mismatched": "failure",
  "write-succeeded-verify-failed": "failure",
  "cancelled-before-verify": "none",
};

/** 写后回读失败态：verify-failed 携带真实错误 key/detail；mismatched 用固定不一致文案。 */
function writeFailureFromOutcome(
  outcome: WriteOutcome | undefined,
): RowFailure {
  if (outcome?.kind === "write-succeeded-verify-failed") {
    return { messageKey: outcome.userMessageKey, detail: outcome.errorCode };
  }
  // 写入成功但回读值不一致。
  return { messageKey: "errors.writeVerifyMismatch", detail: null };
}

export interface ApplyManualResultOptions {
  /** 写入结果（ok 时按 kind 决定成功/失败/保持，§18.2）。 */
  writeOutcome?: WriteOutcome;
}

/**
 * 手动读/写结果：成功清除失败态/编辑完成态并写成功点；失败写失败态（带 detail）并清成功点。
 * 写入失败不清编辑完成态（§18.1 保留用户输入；失败清除后若值仍未同步，恢复显示编辑完成态）。
 */
export function applyManualResult(
  state: RowStatusState,
  rowId: string,
  result: Result<unknown>,
  kind: RowSuccessKind,
  options: ApplyManualResultOptions = {},
): RowStatusState {
  if (!result.ok) {
    const rowResults = setFailure(state.rowResults, rowId, {
      messageKey: result.error.userMessageKey,
      detail: result.error.code,
    });
    const rowSuccess = removeSuccess(state.rowSuccess, rowId);
    if (rowResults === state.rowResults && rowSuccess === state.rowSuccess) {
      return state;
    }
    return { ...state, rowResults, rowSuccess };
  }
  const writeOutcome = options.writeOutcome;
  const writeStatus: WriteResultStatus | undefined =
    writeOutcome !== undefined
      ? WRITE_OUTCOME_STATUS[writeOutcome.kind]
      : undefined;
  // 写路径结果未知（缺 outcome 或 kind 未映射）或回读取消（cancelled-before-verify）：
  // 保持原状态，绝不产生成功点（§18.2 防御，杜绝「失败却绿点」）。
  if (
    kind === "write" &&
    (writeOutcome === undefined || writeStatus !== "success" && writeStatus !== "failure")
  ) {
    return state;
  }
  const isSuccess = kind === "read" || writeStatus === "success";
  const isFailure = writeStatus === "failure";
  const rowDirty = removeDirty(state.rowDirty, rowId);
  const rowSuccess = isSuccess
    ? setSuccess(state.rowSuccess, rowId, kind)
    : removeSuccess(state.rowSuccess, rowId);
  const rowResults = isFailure
    ? // 写入成功但回读不一致/回读失败：显示失败态（§18.2）。
      setFailure(state.rowResults, rowId, writeFailureFromOutcome(writeOutcome))
    : removeFailure(state.rowResults, rowId);
  if (
    rowResults === state.rowResults &&
    rowDirty === state.rowDirty &&
    rowSuccess === state.rowSuccess
  ) {
    return state;
  }
  return { ...state, rowResults, rowDirty, rowSuccess };
}

/**
 * 轮询/全表读取逐行结果：成功清除失败态与编辑完成态（不产生成功点，值更新即反馈）；
 * 失败幂等写失败态（detail=null 稳定，同态返回原引用 → zustand 零更新）。
 */
export function applyPollResultStatus(
  state: RowStatusState,
  rowId: string,
  result: Result<unknown>,
): RowStatusState {
  if (!result.ok) {
    const rowResults = setFailure(state.rowResults, rowId, {
      messageKey: result.error.userMessageKey,
      detail: null,
    });
    if (rowResults === state.rowResults) return state;
    return { ...state, rowResults };
  }
  const rowResults = removeFailure(state.rowResults, rowId);
  const rowDirty = removeDirty(state.rowDirty, rowId);
  if (rowResults === state.rowResults && rowDirty === state.rowDirty) {
    return state;
  }
  return { ...state, rowResults, rowDirty };
}

/**
 * Data 编辑提交：编辑是用户主动的新操作，清除该行失败态（用户已接管值，红点不再压过
 * 编辑完成态）；值变化置编辑完成态（并覆盖成功态）；编辑回原值（前后一致）清除编辑完成态。
 */
export function applyRowEdit(
  state: RowStatusState,
  rowId: string,
  before: string,
  after: string,
): RowStatusState {
  const rowResults = removeFailure(state.rowResults, rowId);
  const rowDirty =
    before === after
      ? removeDirty(state.rowDirty, rowId)
      : setDirty(state.rowDirty, rowId);
  const rowSuccess = removeSuccess(state.rowSuccess, rowId);
  if (
    rowResults === state.rowResults &&
    rowDirty === state.rowDirty &&
    rowSuccess === state.rowSuccess
  ) {
    return state;
  }
  return { ...state, rowResults, rowDirty, rowSuccess };
}

/**
 * 单元格提交（Data 列 / 地址列）校验结果 → 状态：
 * - 成功：清除校验错误，复用 applyRowEdit 语义（值变化置编辑完成态并清成功点、回原值清编辑完成态）；
 * - 失败：记录校验错误（cellValidationErrors，驱动单元格红框+Tooltip），清除设备失败态与成功点
 *   （用户已接管值），保留编辑完成态（值仍未同步）；不清空输入（输入由 store 回写，§23）。
 */
export function applyCellCommit(
  state: RowStatusState,
  rowId: string,
  before: string,
  after: string,
  result: Result<unknown>,
): RowStatusState {
  const key = `${rowId}:data`;
  if (!result.ok) {
    const cellValidationErrors = setValidationError(
      state.cellValidationErrors,
      key,
      {
        messageKey: result.error.userMessageKey,
        detail: result.error.code,
      },
    );
    const rowResults = removeFailure(state.rowResults, rowId);
    const rowSuccess = removeSuccess(state.rowSuccess, rowId);
    if (
      cellValidationErrors === state.cellValidationErrors &&
      rowResults === state.rowResults &&
      rowSuccess === state.rowSuccess
    ) {
      return state;
    }
    return { ...state, cellValidationErrors, rowResults, rowSuccess };
  }
  const edit = applyRowEdit(state, rowId, before, after);
  const cellValidationErrors = removeValidationError(
    state.cellValidationErrors,
    key,
  );
  if (edit === state && cellValidationErrors === state.cellValidationErrors) {
    return state;
  }
  return { ...edit, cellValidationErrors };
}

/**
 * 地址列校验错误状态：失败记录、成功清除；不触碰三态状态点
 * （地址列无编辑完成态/成功点，§17.2 仅红框+Tooltip 反馈）。
 * 键 = `${rowId}:address`，与 Data 列（rowId:data）独立不串显。
 */
export function applyCellValidation(
  state: RowStatusState,
  rowId: string,
  result: Result<unknown>,
): RowStatusState {
  const key = `${rowId}:address`;
  const cellValidationErrors = result.ok
    ? removeValidationError(state.cellValidationErrors, key)
    : setValidationError(state.cellValidationErrors, key, {
        messageKey: result.error.userMessageKey,
        detail: result.error.code,
      });
  if (cellValidationErrors === state.cellValidationErrors) return state;
  return { ...state, cellValidationErrors };
}

// ---- 内部：幂等 set/remove（同态返回原引用，zustand 不触发订阅更新）----

function setFailure(
  current: RowResults,
  rowId: string,
  failure: RowFailure,
): RowResults {
  const existing = current[rowId];
  if (
    existing !== undefined &&
    existing.messageKey === failure.messageKey &&
    existing.detail === failure.detail
  ) {
    return current;
  }
  return { ...current, [rowId]: failure };
}

function removeFailure(current: RowResults, rowId: string): RowResults {
  if (current[rowId] === undefined) return current;
  const next = { ...current };
  delete next[rowId];
  return next;
}

function setDirty(
  current: Record<string, boolean>,
  rowId: string,
): Record<string, boolean> {
  if (current[rowId] === true) return current;
  return { ...current, [rowId]: true };
}

function removeDirty(
  current: Record<string, boolean>,
  rowId: string,
): Record<string, boolean> {
  if (current[rowId] === undefined) return current;
  const next = { ...current };
  delete next[rowId];
  return next;
}

function setSuccess(
  current: RowSuccessMap,
  rowId: string,
  kind: RowSuccessKind,
): RowSuccessMap {
  const existing = current[rowId];
  if (existing !== undefined && existing.kind === kind) return current;
  return { ...current, [rowId]: { kind } };
}

function removeSuccess(current: RowSuccessMap, rowId: string): RowSuccessMap {
  if (current[rowId] === undefined) return current;
  const next = { ...current };
  delete next[rowId];
  return next;
}

function setValidationError(
  current: Record<string, RowFailure | undefined>,
  rowId: string,
  failure: RowFailure,
): Record<string, RowFailure | undefined> {
  const existing = current[rowId];
  if (
    existing !== undefined &&
    existing.messageKey === failure.messageKey &&
    existing.detail === failure.detail
  ) {
    return current;
  }
  return { ...current, [rowId]: failure };
}

function removeValidationError(
  current: Record<string, RowFailure | undefined>,
  rowId: string,
): Record<string, RowFailure | undefined> {
  if (current[rowId] === undefined) return current;
  const next = { ...current };
  delete next[rowId];
  return next;
}
