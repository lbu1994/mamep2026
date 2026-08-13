import { describe, expect, it } from "vitest";
import {
  ConnectionStateMachine,
  type ConnectionState,
} from "./connection-state-machine";

describe("ConnectionStateMachine", () => {
  it("starts disconnected", () => {
    const machine = new ConnectionStateMachine();
    expect(machine.getState()).toBe("disconnected");
  });

  const legal: Array<[ConnectionState, ConnectionState]> = [
    ["disconnected", "selecting-device"],
    ["disconnected", "connecting"],
    ["selecting-device", "connecting"],
    ["selecting-device", "disconnected"],
    ["connecting", "connected"],
    ["connecting", "failed"],
    ["connecting", "disconnected"],
    ["connected", "disconnecting"],
    ["connected", "interrupted"],
    ["disconnecting", "disconnected"],
    ["interrupted", "reconnect-waiting"],
    ["interrupted", "disconnected"],
    ["reconnect-waiting", "reconnecting"],
    ["reconnecting", "connected"],
    ["reconnecting", "failed"],
    ["failed", "connecting"],
    ["failed", "disconnected"],
  ];

  it.each(legal)("allows legal transition %s -> %s", (from, to) => {
    const machine = new ConnectionStateMachine();
    machine.forceState(from);
    const result = machine.transition(to);
    expect(result.ok).toBe(true);
    expect(machine.getState()).toBe(to);
  });

  it("rejects illegal transitions with a structured error", () => {
    const machine = new ConnectionStateMachine();
    // disconnected -> connected 非法（必须经过 connecting）
    const result = machine.transition("connected");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_STATE_TRANSITION");
    }
    expect(machine.getState()).toBe("disconnected");
  });

  it("rejects repeated disconnect from disconnected state", () => {
    const machine = new ConnectionStateMachine();
    const result = machine.transition("disconnecting");
    expect(result.ok).toBe(false);
  });

  it("notifies subscribers on state change", () => {
    const machine = new ConnectionStateMachine();
    const states: ConnectionState[] = [];
    const unsubscribe = machine.subscribe((state) => states.push(state));
    machine.transition("connecting");
    machine.transition("connected");
    unsubscribe();
    machine.transition("disconnecting");
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("rejects unknown states at runtime", () => {
    const machine = new ConnectionStateMachine();
    const result = machine.transition("bogus" as ConnectionState);
    expect(result.ok).toBe(false);
    expect(machine.getState()).toBe("disconnected");
  });
});
