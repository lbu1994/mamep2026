/**
 * 通信日志 CSV 导出模型（docs/TECH_DESIGN.md §20.2/§20.3/§46、docs/AGENTS.md §21、
 * PRD §8.3 P1「日志导出」/ §15.3.6）。
 *
 * 仅提供「导出」，不提供搜索/过滤/查询（用户对导出数据用 Excel 等第三方软件自行筛选）。
 * 只导出当前缓冲区内容（§20.4）；导出前由 UI 提示可能包含设备地址与通信数据（§20.6/§15.3.6）。
 *
 * 约定：
 * - 列名固定英文、不随界面语言（docs/AGENTS.md §26 / TECH_DESIGN §24.6）；
 * - 原始报文保持大写十六进制、字节间空格、不本地化（§20.5/§21）；
 * - 字段含逗号/引号/换行按 RFC 4180 转义（双引号包裹 + 内部引号翻倍）；
 * - 行分隔符 CRLF（Excel 兼容）。
 */
import type { CommunicationLogEntry } from "./stores";

/** CSV 列（固定英文列名；顺序即导出顺序）。 */
export const COMMUNICATION_LOG_CSV_COLUMNS = [
  "seq",
  "timestamp",
  "direction",
  "protocol",
  "slaveAddress",
  "functionCode",
  "userAddress",
  "sentAddress",
  "quantity",
  "attempt",
  "status",
  "errorCode",
  "exceptionCode",
  "source",
  "durationMs",
  "bytesHex",
] as const;
export type CommunicationLogCsvColumn =
  (typeof COMMUNICATION_LOG_CSV_COLUMNS)[number];

/** RFC 4180 字段转义：含逗号/引号/换行时双引号包裹，内部引号翻倍；null/undefined 为空串。 */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 本地时间 RFC3339（带毫秒与 UTC 偏移）：`YYYY-MM-DDTHH:mm:ss.SSS±HH:MM`。
 * 时间展示允许按平台 Locale（docs/AGENTS.md §26），导出采用稳定格式便于 Excel 排序/筛选。
 * 非有限时间戳返回空串。
 */
export function formatTimestampRfc3339Local(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  const d = new Date(timestamp);
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${offset}`
  );
}

/** 单条日志 → CSV 行（列顺序与 COMMUNICATION_LOG_CSV_COLUMNS 一致）。 */
export function communicationLogCsvRow(
  entry: CommunicationLogEntry,
): string {
  const fields: unknown[] = [
    entry.seq,
    formatTimestampRfc3339Local(entry.timestamp),
    entry.direction,
    entry.protocol,
    entry.slaveAddress,
    entry.functionCode,
    entry.userAddress,
    entry.sentAddress,
    entry.quantity,
    entry.attempt,
    entry.status,
    entry.errorCode,
    entry.exceptionCode,
    entry.source,
    entry.durationMs,
    entry.bytesHex,
  ];
  return fields.map(escapeCsvField).join(",");
}

/**
 * 导出当前缓冲区为 CSV 文本：表头 + 每行一条日志，CRLF 行分隔，末尾换行。
 * 空缓冲区导出仅表头（仍是合法 CSV；UI 层通常禁用空导出入口）。
 */
export function serializeCommunicationLogToCsv(
  entries: readonly CommunicationLogEntry[],
): string {
  const header = COMMUNICATION_LOG_CSV_COLUMNS.join(",");
  const lines = entries.map(communicationLogCsvRow);
  return [header, ...lines].join("\r\n") + "\r\n";
}

/**
 * 导出文件名（用户已确认：含协议标识）：`comm-log-<protocol>-<YYYYMMDD-HHmmss>.csv`。
 * protocol 取缓冲区单一协议；混用 RTU/TCP（重连切换等）时用 `mixed` 如实标注。
 */
export function communicationLogExportFileName(
  entries: readonly CommunicationLogEntry[],
  now = Date.now(),
): string {
  const protocols = new Set(entries.map((e) => e.protocol));
  const protocol = protocols.size === 1 ? [...protocols][0]! : "mixed";
  const d = new Date(now);
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `comm-log-${protocol}-${stamp}.csv`;
}
