/**
 * Transport Port（docs/TECH_DESIGN.md §9.1）。
 * Transport 只处理打开/关闭/字节读写与事件，不理解寄存器表、数据类型或轮询业务。
 */
import type { MamepError, Result } from "@mamep2026/domain";

export interface TransportEvents {
  onData(listener: (chunk: Uint8Array) => void): () => void;
  onError(listener: (error: MamepError) => void): () => void;
  onClose(listener: () => void): () => void;
}

export interface TransportPort extends TransportEvents {
  open(): Promise<Result<void>>;
  close(): Promise<Result<void>>;
  write(bytes: Uint8Array): Promise<Result<void>>;
  isOpen(): boolean;
  readonly kind: "web-serial" | "mock" | "fake";
}
