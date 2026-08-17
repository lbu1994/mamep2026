/**
 * 应用消息与通信日志存储（docs/AGENTS.md §21、docs/TECH_DESIGN.md §20）。
 * 有保留上限、订阅与清空；通信日志 UI 只展示 时间/方向/原始字节（bytesHex）。
 */
import type { CommunicationLogEvent } from "@mamep2026/communication";
import { formatBytesHex } from "@mamep2026/communication";

export type MessageLevel = "info" | "warning" | "error";

export interface ApplicationMessage {
  timestamp: number;
  level: MessageLevel;
  messageKey: string;
  /** 可选 i18n 插值参数，UI 渲染时传给 t()。 */
  params?: Record<string, string | number>;
  detail: string | null;
}

export interface CommunicationLogEntry {
  /** 会话内自增序号：作为 UI 虚拟列表（Listy）的稳定 rowKey，不持久化、不回绕。 */
  seq: number;
  timestamp: number;
  direction: "request" | "response";
  bytesHex: string;
  protocol: "rtu";
  slaveAddress: number | null;
  functionCode: number | null;
  userAddress: number | null;
  sentAddress: number | null;
  quantity: number | null;
  attempt: number;
  status: "success" | "failure" | "timeout" | "cancelled" | "discarded";
  errorCode: string | null;
  exceptionCode: number | null;
  source: string;
  durationMs: number | null;
}

export class ApplicationMessageStore {
  private items: ApplicationMessage[] = [];
  private readonly listeners = new Set<(message: ApplicationMessage) => void>();
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  get entries(): readonly ApplicationMessage[] {
    return this.items;
  }

  append(message: ApplicationMessage): void {
    this.items = [...this.items, message];
    if (this.items.length > this.cap) {
      this.items = this.items.slice(this.items.length - this.cap);
    }
    for (const listener of this.listeners) listener(message);
  }

  subscribe(listener: (message: ApplicationMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.items = [];
  }
}

export class CommunicationLogStore {
  private items: CommunicationLogEntry[] = [];
  private nextSeq = 0;
  private readonly listeners = new Set<
    (entry: CommunicationLogEntry) => void
  >();
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  get entries(): readonly CommunicationLogEntry[] {
    return this.items;
  }

  appendFromEvent(event: CommunicationLogEvent): void {
    this.append({
      seq: this.nextSeq++,
      timestamp: event.timestamp,
      direction: event.direction,
      bytesHex: formatBytesHex(event.bytes),
      protocol: event.protocol,
      slaveAddress: event.slaveAddress,
      functionCode: event.functionCode,
      userAddress: event.userAddress,
      sentAddress: event.sentAddress,
      quantity: event.quantity,
      attempt: event.attempt,
      status: event.status,
      errorCode: event.errorCode,
      exceptionCode: event.exceptionCode,
      source: event.source,
      durationMs: event.durationMs,
    });
  }

  append(entry: CommunicationLogEntry): void {
    this.items = [...this.items, entry];
    if (this.items.length > this.cap) {
      this.items = this.items.slice(this.items.length - this.cap);
    }
    for (const listener of this.listeners) listener(entry);
  }

  subscribe(listener: (entry: CommunicationLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.items = [];
  }
}
