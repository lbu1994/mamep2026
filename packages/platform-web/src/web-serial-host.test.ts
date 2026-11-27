import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { Serial, SerialOptions, SerialPort } from "./web-serial";
import { BrowserPlatformHost, type WebSerialHandle } from "./web-serial-host";

function createFakePort(
  onOpen?: (options: SerialOptions) => void,
): SerialPort & { openCalls: SerialOptions[] } {
  const openCalls: SerialOptions[] = [];
  const port: SerialPort = {
    open: async (options) => {
      openCalls.push(options);
      onOpen?.(options);
    },
    close: async () => undefined,
    readable: null,
    writable: null,
    getInfo: () => ({}),
  };
  return { ...port, openCalls };
}

describe("BrowserPlatformHost", () => {
  it("rejects XON/XOFF before opening the port and preserves the profile", async () => {
    const port = createFakePort();
    const host = new BrowserPlatformHost();
    const profile = {
      ...createDefaultRtuProfile(),
      flowControl: "xon-xoff" as const,
    };
    const result = await host.openSerialTransport(
      { id: "USB", label: "USB", port } as WebSerialHandle,
      profile,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const opened = await result.value.open();
    expect(opened).toMatchObject({
      ok: false,
      error: { code: "SERIAL_PARAMETER_UNSUPPORTED" },
    });
    expect(port.openCalls).toEqual([]);
    expect(result.value.isOpen()).toBe(false);
    expect(profile.flowControl).toBe("xon-xoff");
  });

  it("passes RTS/CTS to Web Serial as hardware flow control", async () => {
    const port = createFakePort();
    const host = new BrowserPlatformHost();
    const result = await host.openSerialTransport(
      { id: "USB", label: "USB", port } as WebSerialHandle,
      { ...createDefaultRtuProfile(), flowControl: "rts-cts" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await result.value.open()).ok).toBe(true);
    expect(port.openCalls[0]?.flowControl).toBe("hardware");
  });

  it("keeps the SerialPort object inside the selected-device handle", async () => {
    const fakePort = createFakePort();
    const serial: Serial = {
      getPorts: async () => [],
      requestPort: async () => fakePort,
    };
    const host = new BrowserPlatformHost({ serial });

    const result = await host.requestSerialPort();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const handle = result.value as WebSerialHandle | null;
    expect(handle).not.toBeNull();
    expect(handle?.port).toBe(fakePort);
  });

  it("returns null when the user cancels the port picker", async () => {
    const serial: Serial = {
      getPorts: async () => [],
      requestPort: async () => {
        throw new DOMException("cancel", "NotFoundError");
      },
    };
    const host = new BrowserPlatformHost({ serial });

    const result = await host.requestSerialPort();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("opens the transport with the profile's serial parameters", async () => {
    const fakePort = createFakePort();
    const handle: WebSerialHandle = {
      id: "USB 1:1",
      label: "USB 1:1",
      port: fakePort,
    };
    const host = new BrowserPlatformHost();
    const profile = createDefaultRtuProfile();

    const result = await host.openSerialTransport(handle, profile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const openResult = await result.value.open();
    expect(openResult.ok).toBe(true);
    expect(fakePort.openCalls).toHaveLength(1);
    expect(fakePort.openCalls[0]?.baudRate).toBe(profile.baudRate);
    expect(fakePort.openCalls[0]?.dataBits).toBe(profile.dataBits);
    expect(fakePort.openCalls[0]?.stopBits).toBe(profile.stopBits);
    expect(fakePort.openCalls[0]?.parity).toBe(profile.parity);
    // flowControl "off" 映射为 Web Serial 的 "none"。
    expect(fakePort.openCalls[0]?.flowControl).toBe("none");
  });
});
