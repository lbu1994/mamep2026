/**
 * 行剪贴板模型（纯函数）。
 * - 复制/剪切只携带可粘贴字段，运行时状态（轮询/追踪/结果值）一律清零；
 * - 地址以内部十进制数值传递，粘贴时按目标表进制重新格式化，避免跨表进制歧义；
 * - 系统剪贴板 CSV：表头 Name,Register,Data,Type,Comment，Register 为十进制数值；
 *   多寄存器范围行（ADR-030）编码为 "start-end"（十进制），解码时恢复 registerCount；
 * - 非法数据不得静默丢弃：粘贴返回结构化 issue 汇总（docs/AGENTS.md §32-26）。
 */
import {
  createEmptyRow,
  dataTypes,
  RegisterAddress,
  type DataType,
  type RegisterRadix,
  type RegisterRow,
  type RegisterSheet,
} from "@mamep2026/domain";
import { formatRegisterAddress, formatRegisterAddressRange } from "@mamep2026/data-conversion";
import { resizeRegisters } from "./child-register";
import { renumberRows } from "./row-operations";

/** 可粘贴的行字段；地址为内部数值（未提交地址为 null）。 */
export interface RowClipboardData {
  name: string;
  addressValue: number | null;
  /** 覆盖的连续寄存器数（ADR-030）：范围行 >1，单寄存器行恒为 1。 */
  registerCount: number;
  dataType: DataType;
  cellText: string;
  comment: string;
}

/** 粘贴/解码时收集的行级问题（不静默丢弃，交由 UI 提示）。 */
export type ClipboardIssueCode = "INVALID_ADDRESS" | "UNKNOWN_TYPE";
export interface ClipboardIssue {
  rowIndex: number;
  code: ClipboardIssueCode;
}

const CSV_HEADER = ["Name", "Register", "Data", "Type", "Comment"];

/** 提取可粘贴字段；运行时状态（轮询/追踪/结果值）不入剪贴板。 */
export function toClipboardData(row: RegisterRow): RowClipboardData {
  return {
    name: row.name,
    addressValue: row.addressValue?.value ?? null,
    registerCount: row.registerCount,
    dataType: row.dataType,
    cellText: row.cellText,
    comment: row.comment,
  };
}

/** 按表格顺序提取选中行的剪贴板载荷（不修改原表）。 */
export function copyRowsToClipboard(
  sheet: RegisterSheet,
  rowIds: readonly string[],
): RowClipboardData[] {
  const idSet = new Set(rowIds);
  return sheet.rows.filter((row) => idSet.has(row.rowId)).map(toClipboardData);
}

/** 剪切：从原表移除选中行并返回载荷。 */
export function cutRowsFromSheet(
  sheet: RegisterSheet,
  rowIds: readonly string[],
): { sheet: RegisterSheet; payload: RowClipboardData[] } {
  const idSet = new Set(rowIds);
  const payload: RowClipboardData[] = [];
  const rows = sheet.rows.filter((row) => {
    if (idSet.has(row.rowId)) {
      payload.push(toClipboardData(row));
      return false;
    }
    return true;
  });
  return {
    sheet: { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() },
    payload,
  };
}

/**
 * 在目标行之后粘贴载荷行（新 rowId、运行时状态清零、renumber）；
 * 目标行不存在时追加末尾；地址按目标表进制重新格式化。
 */
export function pasteClipboardRows(
  sheet: RegisterSheet,
  afterRowId: string,
  payload: readonly RowClipboardData[],
  radix: RegisterRadix,
): { sheet: RegisterSheet; issues: ClipboardIssue[] } {
  const issues: ClipboardIssue[] = [];
  const newRows = payload.map((data, index) => {
    const row = createEmptyRow();
    row.name = data.name;
    row.comment = data.comment;
    row.dataType = data.dataType;
    row.cellText = data.cellText;
    // 多寄存器范围行（ADR-030）：恢复覆盖寄存器数（运行时 registerValues 清零）。
    row.registerCount = data.registerCount;
    // 子行元数据初始化（2026-08-27）：按父行 dataType 生成默认数组（剪贴板不携带子行元数据）。
    row.registers = resizeRegisters(row, data.registerCount);
    if (data.addressValue !== null) {
      const addressResult = RegisterAddress.create(data.addressValue);
      if (addressResult.ok) {
        row.addressValue = addressResult.value;
        // 范围行（ADR-030）：addressDraft 用范围格式化（"start-end"），与 commitAddress 一致。
        row.addressDraft =
          data.registerCount > 1
            ? formatRegisterAddressRange(
                addressResult.value.value,
                data.registerCount,
                radix,
              )
            : formatRegisterAddress(addressResult.value.value, radix);
      } else {
        issues.push({ rowIndex: index, code: "INVALID_ADDRESS" });
      }
    }
    return row;
  });
  const index = sheet.rows.findIndex((row) => row.rowId === afterRowId);
  const rows =
    index === -1
      ? [...sheet.rows, ...newRows]
      : [
          ...sheet.rows.slice(0, index + 1),
          ...newRows,
          ...sheet.rows.slice(index + 1),
        ];
  return {
    sheet: { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() },
    issues,
  };
}

function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

/** 把载荷编码为系统剪贴板 CSV 文本（RFC4180 风格转义）。 */
export function encodeClipboardCsv(
  payload: readonly RowClipboardData[],
): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of payload) {
    // Register 字段：范围行（registerCount>1）编码为 "start-end"（十进制）。
    const registerField =
      row.addressValue === null
        ? ""
        : row.registerCount > 1
          ? `${row.addressValue}-${row.addressValue + row.registerCount - 1}`
          : String(row.addressValue);
    lines.push(
      [
        row.name,
        registerField,
        row.cellText,
        row.dataType,
        row.comment,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

/** 字符级 CSV 解析：支持引号包裹、双引号转义与字段内换行。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 解码系统剪贴板 CSV；非法行保留可恢复字段并返回 issue，不静默丢弃。 */
export function decodeClipboardCsv(text: string): {
  rows: RowClipboardData[];
  issues: ClipboardIssue[];
} {
  const rows: RowClipboardData[] = [];
  const issues: ClipboardIssue[] = [];
  const parsed = parseCsv(text);
  let start = 0;
  if (
    parsed.length > 0 &&
    (parsed[0] as string[])[0]?.trim().toLowerCase() === "name"
  ) {
    start = 1; // 跳过表头
  }
  for (let i = start; i < parsed.length; i += 1) {
    const fields = parsed[i] as string[];
    if (fields.every((field) => field.trim() === "")) continue;
    const rowIndex = rows.length;
    const [name = "", register = "", cellText = "", type = "", comment = ""] =
      fields;
    let addressValue: number | null = null;
    let registerCount = 1;
    const registerText = register.trim();
    if (registerText !== "") {
      // 单值或范围（"start-end"，ADR-030）：均为十进制。
      const rangeMatch = /^(\d+)-(\d+)$/.exec(registerText);
      const single = /^[0-9]+$/.test(registerText);
      if (rangeMatch !== null) {
        const start = Number.parseInt(rangeMatch[1] ?? "", 10);
        const end = Number.parseInt(rangeMatch[2] ?? "", 10);
        if (end >= start) {
          const count = end - start + 1;
          const addressResult = RegisterAddress.create(start);
          if (addressResult.ok && count <= 65536) {
            addressValue = addressResult.value.value;
            registerCount = count;
          } else {
            issues.push({ rowIndex, code: "INVALID_ADDRESS" });
          }
        } else {
          issues.push({ rowIndex, code: "INVALID_ADDRESS" });
        }
      } else if (single) {
        const addressResult = RegisterAddress.create(
          Number.parseInt(registerText, 10),
        );
        if (addressResult.ok) {
          addressValue = addressResult.value.value;
        } else {
          issues.push({ rowIndex, code: "INVALID_ADDRESS" });
        }
      } else {
        issues.push({ rowIndex, code: "INVALID_ADDRESS" });
      }
    }
    const typeText = type.trim();
    let dataType: DataType = "hex";
    if ((dataTypes as readonly string[]).includes(typeText)) {
      dataType = typeText as DataType;
    } else if (typeText !== "") {
      issues.push({ rowIndex, code: "UNKNOWN_TYPE" });
    }
    rows.push({ name, addressValue, registerCount, dataType, cellText, comment });
  }
  return { rows, issues };
}
