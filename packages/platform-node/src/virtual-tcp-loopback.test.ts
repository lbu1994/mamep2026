/**
 * Node TCP 本地回环集成测试（Layer 2，docs/TECH_DESIGN.md §34.3.20 第二层）。
 * 用 Node `net` 起临时回环服务器验证真实字节收发、分片、断连、重连、连接拒绝。
 * 本地 127.0.0.1 回环无需外部设备/环境，默认执行（与虚拟串口测试的 com0com 门控不同）。
 */
import { describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { NodeTcpTransport } from "./node-tcp-transport";
import { RealNetFactory } from "./real-socket";

interface Loopback {
  readonly port: number;
  close(): Promise<void>;
}

async function startLoopback(
  onConnection: (socket: Socket) => void,
): Promise<Loopback> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function concat(chunks: Uint8Array[]): number[] {
  const out: number[] = [];
  for (const chunk of chunks) {
    for (const byte of chunk) out.push(byte);
  }
  return out;
}

describe("NodeTcpTransport over local loopback", () => {
  it("sends bytes and receives echoed data", async () => {
    const loopback = await startLoopback((socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    });
    try {
      const factory = new RealNetFactory();
      const transport = new NodeTcpTransport(
        factory.connect({ host: "127.0.0.1", port: loopback.port }),
      );
      const received: Uint8Array[] = [];
      transport.onData((chunk) => received.push(chunk));
      expect((await transport.open()).ok).toBe(true);
      expect(
        (
          await transport.write(
            Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]),
          )
        ).ok,
      ).toBe(true);
      await waitFor(() => concat(received).length >= 6);
      expect(concat(received)).toEqual([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
      expect((await transport.close()).ok).toBe(true);
    } finally {
      await loopback.close();
    }
  });

  it("passes 0x00/0xFF raw bytes through transparently", async () => {
    const loopback = await startLoopback((socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    });
    try {
      const factory = new RealNetFactory();
      const transport = new NodeTcpTransport(
        factory.connect({ host: "127.0.0.1", port: loopback.port }),
      );
      const received: Uint8Array[] = [];
      transport.onData((chunk) => received.push(chunk));
      await transport.open();
      const payload = Uint8Array.from([0x00, 0xff, 0x01, 0x00, 0xff]);
      await transport.write(payload);
      await waitFor(() => concat(received).length >= payload.length);
      expect(concat(received)).toEqual([0x00, 0xff, 0x01, 0x00, 0xff]);
      await transport.close();
    } finally {
      await loopback.close();
    }
  });

  it("reassembles fragmented responses across data events", async () => {
    const loopback = await startLoopback((socket) => {
      socket.on("data", () => {
        // 分片发送：两段 + 一段延迟。
        socket.write(Uint8Array.from([0x01, 0x03, 0x02]));
        socket.write(Uint8Array.from([0x12, 0x34]));
        setTimeout(() => socket.write(Uint8Array.from([0x56, 0x78])), 20);
      });
    });
    try {
      const factory = new RealNetFactory();
      const transport = new NodeTcpTransport(
        factory.connect({ host: "127.0.0.1", port: loopback.port }),
      );
      const received: Uint8Array[] = [];
      transport.onData((chunk) => received.push(chunk));
      await transport.open();
      await transport.write(
        Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x02]),
      );
      await waitFor(() => concat(received).length >= 7);
      expect(concat(received)).toEqual([
        0x01, 0x03, 0x02, 0x12, 0x34, 0x56, 0x78,
      ]);
      await transport.close();
    } finally {
      await loopback.close();
    }
  });

  it("emits close and clears open state when the server disconnects", async () => {
    const loopback = await startLoopback((socket) => {
      socket.on("data", () => socket.destroy());
    });
    try {
      const factory = new RealNetFactory();
      const transport = new NodeTcpTransport(
        factory.connect({ host: "127.0.0.1", port: loopback.port }),
      );
      let closed = false;
      transport.onClose(() => {
        closed = true;
      });
      await transport.open();
      await transport.write(Uint8Array.from([0x01]));
      await waitFor(() => closed);
      expect(transport.isOpen()).toBe(false);
      // 关闭幂等：重复 close 不再触发 close 事件。
      const result = await transport.close();
      expect(result.ok).toBe(true);
    } finally {
      await loopback.close();
    }
  });

  it("supports reconnect on the same transport after close", async () => {
    const loopback = await startLoopback((socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    });
    try {
      const factory = new RealNetFactory();
      const transport = new NodeTcpTransport(
        factory.connect({ host: "127.0.0.1", port: loopback.port }),
      );
      for (let i = 0; i < 5; i++) {
        const received: Uint8Array[] = [];
        const unsubscribe = transport.onData((chunk) => received.push(chunk));
        expect((await transport.open()).ok).toBe(true);
        await transport.write(Uint8Array.from([i]));
        await waitFor(() => concat(received).length >= 1);
        expect(concat(received)).toEqual([i]);
        expect((await transport.close()).ok).toBe(true);
        unsubscribe();
      }
    } finally {
      await loopback.close();
    }
  });

  it("maps connection refusal to TCP_CONNECTION_FAILED", async () => {
    // 先占一个端口并关闭，确保端口无监听者（避免竞态）。
    const loopback = await startLoopback(() => {});
    const deadPort = loopback.port;
    await loopback.close();
    const factory = new RealNetFactory();
    const transport = new NodeTcpTransport(
      factory.connect({ host: "127.0.0.1", port: deadPort }),
    );
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_CONNECTION_FAILED");
      expect(result.error.category).toBe("connection");
    }
    expect(transport.isOpen()).toBe(false);
  });
});
