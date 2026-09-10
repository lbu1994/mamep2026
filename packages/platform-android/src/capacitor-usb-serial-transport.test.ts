import { describe, expect, it, vi } from "vitest";
import { CapacitorUsbSerialTransport } from "./capacitor-usb-serial-transport";
import { FakeTransportBridge } from "./testing/fake-transport-bridge";
import type { BridgeOpenSerialParams } from "./bridge-contract";

const PARAMS: BridgeOpenSerialParams = {
  deviceName: "/dev/bus/usb/001/002",
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "off",
};

function createTransport(bridge = new FakeTransportBridge()) {
  return {
    bridge,
    transport: new CapacitorUsbSerialTransport({ bridge, params: PARAMS }),
  };
}

describe("CapacitorUsbSerialTransport", () => {
  it("open 前先注册 data/closed/error 监听，再调用 openSerial（避免首帧丢失）", async () => {
    const { bridge, transport } = createTransport();
    const order: string[] = [];
    bridge.addListener = async () => {
      order.push("listen");
      return { remove: async () => undefined };
    };
    bridge.openSerial = async () => {
      order.push("open");
    };
    order.push("start");

    const result = await transport.open();

    expect(result.ok).toBe(true);
    expect(order).toEqual(["start", "listen", "listen", "listen", "open"]);
    expect(transport.isOpen()).toBe(true);
    expect(transport.kind).toBe("capacitor-usb");
  });

  it("把校验后的串口参数原样交给桥", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    expect(bridge.serialOpenCalls).toEqual([PARAMS]);
  });

  it("openSerial 失败 → 映射为串口打开错误，并移除已注册的监听器", async () => {
    const { bridge, transport } = createTransport();
    bridge.serialOpenError = { code: "USB_OPEN_FAILED", message: "port busy" };

    const result = await transport.open();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SERIAL_OPEN_FAILED");
      expect(result.error.userMessageKey).toBe("errors.serialOpenFailed");
    }
    expect(bridge.listenerCount).toBe(0);
    expect(transport.isOpen()).toBe(false);
  });

  it("权限被拒 → SERIAL_PERMISSION_DENIED / errors.serialPermissionDenied", async () => {
    const { bridge, transport } = createTransport();
    bridge.serialOpenError = {
      code: "USB_PERMISSION_DENIED",
      message: "user denied",
    };

    const result = await transport.open();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SERIAL_PERMISSION_DENIED");
      expect(result.error.category).toBe("permission");
      expect(result.error.userMessageKey).toBe("errors.serialPermissionDenied");
    }
  });

  it("重复 open → SERIAL_OPEN_FAILED（不重复订阅）", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    const before = bridge.listenerCount;

    const second = await transport.open();

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("SERIAL_OPEN_FAILED");
    expect(bridge.listenerCount).toBe(before);
  });

  it("未打开时写 → TRANSPORT_NOT_OPEN", async () => {
    const { bridge, transport } = createTransport();
    const result = await transport.write(new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSPORT_NOT_OPEN");
    expect(bridge.writeCalls).toEqual([]);
  });

  it("打开后写 → base64 载荷；写失败按串口上下文映射", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();

    expect((await transport.write(new Uint8Array([0x01, 0x03]))).ok).toBe(true);
    expect(bridge.writeCalls).toEqual(["AQM="]);

    bridge.writeError = { code: "WRITE_FAILED", message: "usb write failed" };
    const failed = await transport.write(new Uint8Array([0x01]));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.code).toBe("SERIAL_WRITE_FAILED");
      expect(failed.error.userMessageKey).toBe("errors.serialError");
    }
  });

  it("data 事件经 base64 解码投递；空载荷不投递", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    const received: number[][] = [];
    transport.onData((chunk) => received.push([...chunk]));

    bridge.emitData(new Uint8Array([0x01, 0x03, 0x02]));
    bridge.emitData(new Uint8Array([]));

    expect(received).toEqual([[0x01, 0x03, 0x02]]);
  });

  it("非法 data 回包 → 错误监听收到 BRIDGE_PAYLOAD_INVALID（不静默丢弃）", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    const errors: string[] = [];
    transport.onError((error) => errors.push(error.code));

    bridge.emitRawData({ data: 123 });

    expect(errors).toEqual(["BRIDGE_PAYLOAD_INVALID"]);
  });

  it("closed 事件（拔线）→ 关闭语义且幂等", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    const closed = vi.fn();
    transport.onClose(closed);

    bridge.emitClosed({ code: "USB_DETACHED", message: "device detached" });
    bridge.emitClosed({ code: "USB_DETACHED", message: "device detached" });

    expect(closed).toHaveBeenCalledTimes(1);
    expect(transport.isOpen()).toBe(false);
  });

  it("close 幂等：移除监听、关闭桥、只触发一次 close 事件", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    const closed = vi.fn();
    transport.onClose(closed);

    expect((await transport.close()).ok).toBe(true);
    expect((await transport.close()).ok).toBe(true);

    expect(bridge.closeCount).toBe(2);
    expect(bridge.listenerCount).toBe(0);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(transport.isOpen()).toBe(false);
  });

  it("error 事件按串口上下文映射（拔线 → 设备断开文案）", async () => {
    const { bridge, transport } = createTransport();
    await transport.open();
    const errors: string[] = [];
    transport.onError((error) => errors.push(error.userMessageKey));

    bridge.emitError("USB_DETACHED", "device removed");

    expect(errors).toEqual(["errors.serialDeviceDisconnected"]);
  });
});
