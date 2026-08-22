import { describe, expect, it } from "vitest";
import { NodeTcpTransport } from "./node-tcp-transport";
import { FakeSocket } from "./testing/fake-socket";

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("NodeTcpTransport", () => {
  it("has kind 'node-tcp'", () => {
    expect(new NodeTcpTransport(new FakeSocket({ host: "h", port: 502 })).kind).toBe(
      "node-tcp",
    );
  });

  it("opens, forwards data, and closes", async () => {
    const socket = new FakeSocket({ host: "127.0.0.1", port: 502 });
    const transport = new NodeTcpTransport(socket);
    const received: Uint8Array[] = [];
    let closeCount = 0;
    transport.onData((chunk) => received.push(chunk));
    transport.onClose(() => closeCount++);

    const openResult = await transport.open();
    expect(openResult.ok).toBe(true);
    expect(transport.isOpen()).toBe(true);
    expect(socket.opened).toBe(true);

    socket.simulateData(Uint8Array.from([0x01, 0x02]));
    expect(received).toHaveLength(1);
    expect(Array.from(received[0] ?? [])).toEqual([0x01, 0x02]);

    const closeResult = await transport.close();
    expect(closeResult.ok).toBe(true);
    expect(transport.isOpen()).toBe(false);
    expect(closeCount).toBe(1);
  });

  it("writes bytes through to the socket", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    await transport.open();
    const result = await transport.write(Uint8Array.from([0x01, 0x03]));
    expect(result.ok).toBe(true);
    expect(Array.from(socket.sentFrames[0] ?? [])).toEqual([0x01, 0x03]);
  });

  it("rejects write before open with TRANSPORT_NOT_OPEN", async () => {
    const transport = new NodeTcpTransport(new FakeSocket({ host: "h", port: 502 }));
    const result = await transport.write(Uint8Array.from([0x01]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSPORT_NOT_OPEN");
  });

  it("fails opening twice with TCP_OPEN_FAILED", async () => {
    const transport = new NodeTcpTransport(new FakeSocket({ host: "h", port: 502 }));
    expect((await transport.open()).ok).toBe(true);
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_OPEN_FAILED");
  });

  it("maps connection refusal on open to TCP_CONNECTION_FAILED", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    socket.openError = withCode("connect ECONNREFUSED", "ECONNREFUSED");
    const transport = new NodeTcpTransport(socket);
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_CONNECTION_FAILED");
      expect(result.error.category).toBe("connection");
      expect(result.error.retryable).toBe(true);
    }
    expect(transport.isOpen()).toBe(false);
  });

  it("maps unknown open error to TCP_OPEN_FAILED", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    socket.openError = new Error("boom");
    const transport = new NodeTcpTransport(socket);
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_OPEN_FAILED");
  });

  it("maps write error to TCP_CONNECTION_FAILED and preserves cause", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    await transport.open();
    const cause = withCode("write EPIPE", "EPIPE");
    socket.writeError = cause;
    const result = await transport.write(Uint8Array.from([0x01]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_CONNECTION_FAILED");
      expect(result.error.cause).toBe(cause);
    }
  });

  it("forwards underlying error events as mapped errors", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    await transport.open();
    const errors: string[] = [];
    transport.onError((error) => errors.push(error.code));
    socket.simulateError(withCode("read ECONNRESET", "ECONNRESET"));
    expect(errors).toEqual(["TCP_CONNECTION_FAILED"]);
  });

  it("drops data/error events while not open", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    const received: Uint8Array[] = [];
    const errors: string[] = [];
    transport.onData((chunk) => received.push(chunk));
    transport.onError((error) => errors.push(error.code));
    socket.simulateData(Uint8Array.from([0x01]));
    socket.simulateError(new Error("ignored"));
    expect(received).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("emits close exactly once on passive socket close", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    await transport.open();
    let closeCount = 0;
    transport.onClose(() => closeCount++);
    socket.simulateClose();
    socket.simulateClose(); // 第二次不应重复触发。
    expect(closeCount).toBe(1);
    expect(transport.isOpen()).toBe(false);
  });

  it("releases listeners on unsubscribe", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    await transport.open();
    const received: Uint8Array[] = [];
    const unsubscribe = transport.onData((chunk) => received.push(chunk));
    unsubscribe();
    socket.simulateData(Uint8Array.from([0x01]));
    expect(received).toHaveLength(0);
  });

  it("supports repeated connect after close without listener leak", async () => {
    const socket = new FakeSocket({ host: "h", port: 502 });
    const transport = new NodeTcpTransport(socket);
    let closeCount = 0;
    transport.onClose(() => closeCount++);
    for (let i = 0; i < 100; i++) {
      expect((await transport.open()).ok).toBe(true);
      expect((await transport.close()).ok).toBe(true);
    }
    expect(closeCount).toBe(100);
  });
});
