/**
 * 通信日志事件（docs/AGENTS.md §21）。
 * UI 只展示 时间/方向/原始字节；结构化字段供后续扩展与诊断。
 */
export type RequestSource =
  | "manual-read"
  | "manual-write"
  | "batch-read"
  | "polling"
  | "trace"
  | "plugin"
  | "connection-control";

export type CommunicationLogStatus =
  "success" | "failure" | "timeout" | "cancelled" | "discarded";

export interface CommunicationLogEvent {
  timestamp: number;
  direction: "request" | "response";
  bytes: Uint8Array;
  /** 协议：rtu / tcp（2026-08-23 TCP 接线）。 */
  protocol: "rtu" | "tcp";
  /** slaveAddressOrUnitId：RTU 为从站地址，TCP 为 Unit ID。 */
  slaveAddress: number | null;
  functionCode: number | null;
  /** 用户输入地址（Address Adjust 之前的地址） */
  userAddress: number | null;
  /** 实际发送地址（Address Adjust 之后的地址） */
  sentAddress: number | null;
  quantity: number | null;
  attempt: number;
  status: CommunicationLogStatus;
  errorCode: string | null;
  exceptionCode: number | null;
  source: RequestSource;
  durationMs: number | null;
}

export function formatBytesHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}
