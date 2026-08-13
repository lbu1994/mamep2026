/**
 * 连接状态机（docs/AGENTS.md §11.4、docs/TECH_DESIGN.md §10）。
 * 状态必须通过受控状态机管理，禁止任意写入状态字符串。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";

export type ConnectionState =
  | "disconnected"
  | "selecting-device"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "reconnect-waiting"
  | "reconnecting"
  | "interrupted"
  | "failed";

const LEGAL_TRANSITIONS: Record<
  ConnectionState,
  ReadonlySet<ConnectionState>
> = {
  disconnected: new Set(["selecting-device", "connecting"]),
  "selecting-device": new Set(["connecting", "disconnected"]),
  connecting: new Set(["connected", "failed", "disconnected"]),
  connected: new Set(["disconnecting", "interrupted"]),
  disconnecting: new Set(["disconnected"]),
  "reconnect-waiting": new Set(["reconnecting"]),
  reconnecting: new Set(["connected", "failed"]),
  interrupted: new Set(["reconnect-waiting", "disconnected"]),
  failed: new Set(["connecting", "disconnected"]),
};

export class ConnectionStateMachine {
  private state: ConnectionState = "disconnected";
  private listeners = new Set<(state: ConnectionState) => void>();

  getState(): ConnectionState {
    return this.state;
  }

  /** 仅用于测试或从外部事实恢复状态；正常运行必须走 transition。 */
  forceState(state: ConnectionState): void {
    this.setState(state);
  }

  transition(to: ConnectionState): Result<void> {
    const legal = LEGAL_TRANSITIONS[this.state];
    if (legal === undefined || !legal.has(to)) {
      return fail(
        createMamepError({
          code: "ILLEGAL_STATE_TRANSITION",
          category: "connection",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.illegalStateTransition",
          technicalMessage: `illegal connection state transition ${this.state} -> ${to}`,
        }),
      );
    }
    this.setState(to);
    return ok(undefined);
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
