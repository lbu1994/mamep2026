import { describe, expect, it, vi } from "vitest";
import type { MamepError } from "@mamep2026/domain";
import { CapacitorTcpTransport } from "./capacitor-tcp-transport";
import { encodeBytesToBase64 } from "./bridge-contract";
import { FakeTransportBridge } from "./testing/fake-transport-bridge";

const REQUEST = new Uint8Array([1, 3, 0, 0, 0, 1, 132, 10]);
const RESPONSE = new Uint8Array([1, 3, 2, 0, 42]);

function createTransport(bridge: FakeTransportBridge): CapacitorTcpTransport {
  return new CapacitorTcpTransport({
    bridge,
    host: "192.168.1.10",
    port: 502,
    connectTimeoutMs: 5000,
  });
}

describe("CapacitorTcpTransport：打开", () => {
  it("先注册 data/closed/error 监听，再 openTcp（避免首帧丢失），参数透传 profile", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);

    const openResult = await transport.open();

    expect(openResult.ok).toBe(true);
    expect(transport.isOpen()).toBe(true);
    expect(bridge.listenerCount).toBe(3);
    expect(bridge.openCalls).toEqual([
      { host: "192.168.1.10", port: 502, connectTimeoutMs: 5000 },
    ]);
  });

  it("重复 open 失败且不重复注册监听", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();

    const second = await transport.open();

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("TCP_OPEN_FAILED");
    expect(bridge.listenerCount).toBe(3);
  });

  it("openTcp 抛出原生错误 → 映射为结构化错误并清理监听", async () => {
    const bridge = new FakeTransportBridge();
    bridge.openError = {
      code: "TCP_CONNECT_FAILED",
      message: "connection refused",
    };
    const transport = createTransport(bridge);

    const result = await transport.open();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_CONNECTION_FAILED");
      expect(result.error.category).toBe("connection");
      expect(result.error.technicalMessage).toContain("connection refused");
    }
    expect(transport.isOpen()).toBe(false);
    expect(bridge.listenerCount).toBe(0);
  });

  it("监听注册失败 → 打开失败（不留下半注册状态）", async () => {
    const bridge = new FakeTransportBridge();
    bridge.addListenerError = {
      code: "PLUGIN_UNAVAILABLE",
      message: "no plugin",
    };
    const transport = createTransport(bridge);

    const result = await transport.open();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_UNSUPPORTED");
    expect(bridge.openCalls).toEqual([]);
  });
});

describe("CapacitorTcpTransport：写", () => {
  it("把字节 base64 编码后交给桥", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();

    const result = await transport.write(REQUEST);

    expect(result.ok).toBe(true);
    expect(bridge.writeCalls).toEqual([encodeBytesToBase64(REQUEST)]);
  });

  it("未打开时写入 → TRANSPORT_NOT_OPEN（不调用桥）", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);

    const result = await transport.write(REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSPORT_NOT_OPEN");
    expect(bridge.writeCalls).toEqual([]);
  });

  it("关闭后写入 → TRANSPORT_NOT_OPEN", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    await transport.close();

    const result = await transport.write(REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSPORT_NOT_OPEN");
  });

  it("桥写失败 → 映射为连接错误", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    bridge.writeError = { code: "WRITE_FAILED", message: "broken pipe" };

    const result = await transport.write(REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_CONNECTION_FAILED");
  });
});

describe("CapacitorTcpTransport：事件", () => {
  it("data 事件解码为字节并投递给监听者", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const received: number[][] = [];
    transport.onData((chunk) => received.push([...chunk]));

    bridge.emitData(RESPONSE);

    expect(received).toEqual([[...RESPONSE]]);
  });

  it("data 回包形状非法 → 走 error 通道（BRIDGE_PAYLOAD_INVALID），不投递脏字节", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const received: number[][] = [];
    const errors: MamepError[] = [];
    transport.onData((chunk) => received.push([...chunk]));
    transport.onError((error) => errors.push(error));

    bridge.emitRawData({ data: "not base64!!" });

    expect(received).toEqual([]);
    expect(errors.map((error) => error.code)).toEqual([
      "BRIDGE_PAYLOAD_INVALID",
    ]);
  });

  it("data 回包非法 base64 → error 通道", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const errors: MamepError[] = [];
    transport.onError((error) => errors.push(error));

    bridge.emitRawData({ data: "AQM" });

    expect(errors.map((error) => error.code)).toEqual([
      "BRIDGE_PAYLOAD_INVALID",
    ]);
  });

  it("空数据不投递（避免空帧进入帧解析器）", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const onData = vi.fn();
    transport.onData(onData);

    bridge.emitData(new Uint8Array([]));

    expect(onData).not.toHaveBeenCalled();
  });

  it("原生 error 事件 → 映射后投递给 error 监听者", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const errors: MamepError[] = [];
    transport.onError((error) => errors.push(error));

    bridge.emitError("REMOTE_CLOSED", "peer closed connection");

    expect(errors.map((error) => error.code)).toEqual([
      "TCP_CONNECTION_FAILED",
    ]);
  });

  it("closed 事件 → onClose 只发一次且 isOpen 变 false", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const onClose = vi.fn();
    transport.onClose(onClose);

    bridge.emitClosed();
    bridge.emitClosed();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(transport.isOpen()).toBe(false);
  });

  it("closed 后再次 data 不再投递（会话已中断）", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const onData = vi.fn();
    transport.onData(onData);

    bridge.emitClosed();
    bridge.emitData(RESPONSE);

    expect(onData).not.toHaveBeenCalled();
  });
});

describe("CapacitorTcpTransport：关闭", () => {
  it("close 调用桥、移除监听、只发一次 onClose，且重复 close 幂等", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    const onClose = vi.fn();
    transport.onClose(onClose);

    const first = await transport.close();
    const second = await transport.close();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(bridge.closeCount).toBe(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bridge.removedListeners).toBe(3);
    expect(bridge.listenerCount).toBe(0);
  });

  it("桥关闭失败 → 返回映射错误但仍发出 onClose（不卡死会话）", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    bridge.closeError = { code: "NOT_OPEN", message: "already closed" };
    const onClose = vi.fn();
    transport.onClose(onClose);

    const result = await transport.close();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSPORT_NOT_OPEN");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭后重新打开不累积监听（自动重连场景）", async () => {
    const bridge = new FakeTransportBridge();
    const transport = createTransport(bridge);
    await transport.open();
    await transport.close();

    const reopened = await transport.open();

    expect(reopened.ok).toBe(true);
    expect(bridge.listenerCount).toBe(3);
    expect(bridge.openCalls).toHaveLength(2);
  });
});
