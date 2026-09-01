import { describe, expect, it } from "vitest";
import { ApplicationMessageStore, CommunicationLogStore } from "./stores";

describe("ApplicationMessageStore", () => {
  it("appends and notifies subscribers", () => {
    const store = new ApplicationMessageStore(5);
    const received: string[] = [];
    store.subscribe((msg) => received.push(msg.messageKey));
    store.append({
      timestamp: 1,
      level: "info",
      messageKey: "app.started",
      detail: null,
    });
    expect(received).toEqual(["app.started"]);
    expect(store.entries).toHaveLength(1);
  });

  it("trims oldest entries beyond the configured cap", () => {
    const store = new ApplicationMessageStore(3);
    for (let i = 0; i < 6; i++) {
      store.append({
        timestamp: i,
        level: "info",
        messageKey: `msg-${i}`,
        detail: null,
      });
    }
    expect(store.entries.map((m) => m.messageKey)).toEqual([
      "msg-3",
      "msg-4",
      "msg-5",
    ]);
  });

  it("clears all entries", () => {
    const store = new ApplicationMessageStore(10);
    store.append({
      timestamp: 1,
      level: "error",
      messageKey: "x",
      detail: null,
    });
    store.clear();
    expect(store.entries).toHaveLength(0);
  });
});

describe("CommunicationLogStore", () => {
  it("stores bytes as uppercase space-separated hex for display", () => {
    const store = new CommunicationLogStore(10);
    store.appendFromEvent({
      timestamp: 1,
      direction: "request",
      bytes: Uint8Array.from([0x01, 0x03, 0x00, 0x00]),
      protocol: "rtu",
      slaveAddress: 1,
      functionCode: 0x03,
      userAddress: 1,
      sentAddress: 1,
      quantity: 1,
      attempt: 1,
      status: "success",
      errorCode: null,
      exceptionCode: null,
      source: "manual-read",
      pluginId: null,
      durationMs: 5,
    });
    expect(store.entries[0]?.bytesHex).toBe("01 03 00 00");
  });

  it("caps the number of entries and trims oldest", () => {
    const store = new CommunicationLogStore(2);
    for (let i = 0; i < 5; i++) {
      store.appendFromEvent({
        timestamp: i,
        direction: "request",
        bytes: Uint8Array.from([i]),
        protocol: "rtu",
        slaveAddress: 1,
        functionCode: 0x03,
        userAddress: null,
        sentAddress: null,
        quantity: 1,
        attempt: 1,
        status: "success",
        errorCode: null,
        exceptionCode: null,
        source: "manual-read",
        pluginId: null,
        durationMs: null,
      });
    }
    expect(store.entries).toHaveLength(2);
    expect(store.entries[0]?.timestamp).toBe(3);
  });
});
