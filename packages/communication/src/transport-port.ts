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
  /**
   * 传输实现标识。
   * - "web-serial"：浏览器/Electron MVP 的 Web Serial（packages/platform-web）
   * - "node-serial"：Node Serial Adapter（packages/platform-node，Electron 替换 Web Serial / VSCode 使用）
   * - "node-tcp"：Node TCP Adapter（packages/platform-node，Node 端 Modbus TCP）
   * - "capacitor-tcp"：Android TCP（packages/platform-android，Capacitor 原生 socket，ADR-050）
   * - "capacitor-usb"：Android USB-RS485（预留，ADR-050 Phase 2）
   * - "mock"：开发 mock 传输（packages/platform-web）
   * - "fake"：测试 Fake（packages/test-kit）
   */
  readonly kind:
    | "web-serial"
    | "node-serial"
    | "node-tcp"
    | "capacitor-tcp"
    | "capacitor-usb"
    | "mock"
    | "fake";
}
