/**
 * connection-actions（Header Connect 直连）单测。
 * 覆盖 canDirectConnect 分支与 runConnect 的连接路由（与 ConnectionSettingsModal 同源）。
 */
import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
} from "@mamep2026/domain";
import type { SerialDeviceHandle } from "@mamep2026/platform-api";
import { canDirectConnect, runConnect } from "./connection-actions";
import { makeHost } from "./test/make-app-host";

const handle = { id: "COM4" } as SerialDeviceHandle;

describe("platform connection gates", () => {
  it.each(["browser", "electron", "vscode", "android"] as const)(
    "checks XON/XOFF before connecting on %s",
    async (platform) => {
      const { host } = makeHost({}, { platform });
      const profile = {
        ...createDefaultRtuProfile(),
        flowControl: "xon-xoff" as const,
      };
      const supported = platform === "vscode" || platform === "android";
      expect(canDirectConnect(host, profile, handle)).toBe(supported);
      const result = await runConnect(host, {
        protocol: "rtu",
        profile,
        sheetProtocol: "rtu",
        handle,
        isMock: false,
      });
      expect(result.ok).toBe(supported);
      expect(host.connect).toHaveBeenCalledTimes(supported ? 1 : 0);
      expect(profile.flowControl).toBe("xon-xoff");
    },
  );

  it("blocks unsupported TCP and RTU before calling the host", async () => {
    const { host, connectTcp } = makeHost({
      modbusRtu: false,
      modbusTcp: false,
    });
    for (const profile of [
      createDefaultRtuProfile(),
      createDefaultTcpProfile(),
    ]) {
      const result = await runConnect(host, {
        protocol: profile.protocol,
        profile,
        sheetProtocol: "rtu",
        handle,
        isMock: false,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "CONNECTION_PROTOCOL_UNSUPPORTED" },
      });
    }
    expect(host.connect).not.toHaveBeenCalled();
    expect(connectTcp).not.toHaveBeenCalled();
  });
});

describe("canDirectConnect（关键字段已就绪判定）", () => {
  it("RTU + 已选串口（非串口阻断）→ 可直连", () => {
    const { host } = makeHost();
    expect(canDirectConnect(host, createDefaultRtuProfile(), handle)).toBe(
      true,
    );
  });

  it("RTU + 未选串口 → 不可直连（回退弹窗）", () => {
    const { host } = makeHost();
    expect(canDirectConnect(host, createDefaultRtuProfile(), null)).toBe(false);
  });

  it("RTU + mock 模式 → 无端口也可直连", () => {
    const { host } = makeHost();
    const mockHost = { ...host, isMockMode: true };
    expect(canDirectConnect(mockHost, createDefaultRtuProfile(), null)).toBe(
      true,
    );
  });

  it("RTU + 串口能力被阻断（无 Web Serial + 非 enumerated）→ 不可直连", () => {
    const { host } = makeHost(
      { serialPorts: "browser-picker" },
      { supportsWebSerial: () => false },
    );
    expect(canDirectConnect(host, createDefaultRtuProfile(), handle)).toBe(
      false,
    );
  });

  it("TCP + 平台支持 + host 非空 → 可直连", () => {
    const { host } = makeHost();
    const profile = createDefaultTcpProfile();
    profile.host = "192.168.1.10";
    expect(canDirectConnect(host, profile, null)).toBe(true);
  });

  it("TCP + host 空（删除默认占位）→ 不可直连", () => {
    const { host } = makeHost();
    expect(canDirectConnect(host, createDefaultTcpProfile(), null)).toBe(false);
  });

  it("TCP + 平台不支持 TCP → 不可直连", () => {
    const { host } = makeHost({ modbusTcp: false });
    const profile = createDefaultTcpProfile();
    profile.host = "192.168.1.10";
    expect(canDirectConnect(host, profile, null)).toBe(false);
  });
});

describe("runConnect（与连接设置弹窗同源）", () => {
  it("passes an Electron TCP codec separately from the transport and clears it for core tables", async () => {
    const { host, connectTcp } = makeHost({}, { platform: "electron" });
    const profile = { ...createDefaultTcpProfile(), codecId: "previous" };
    const options = {
      protocol: "tcp" as const,
      profile,
      sheetProtocol: "vendor-tcp",
      handle: null,
      isMock: false,
    };
    await runConnect(host, options);
    expect(connectTcp).toHaveBeenLastCalledWith({
      ...profile,
      codecId: "vendor-tcp",
    });
    await runConnect(host, {
      ...options,
      sheetProtocol: "modbus-basic-tables:coil",
    });
    expect(connectTcp.mock.calls.at(-1)?.[0]).not.toHaveProperty("codecId");
    expect(profile.codecId).toBe("previous");
  });
  it("TCP → 调 host.connectTcp（携带 profile）", async () => {
    const { host, connectTcp } = makeHost();
    const profile = createDefaultTcpProfile();
    await runConnect(host, {
      protocol: "tcp",
      profile,
      sheetProtocol: "rtu",
      handle: null,
      isMock: false,
    });
    expect(connectTcp).toHaveBeenCalledWith(profile);
  });

  it("RTU 真实 → 调 host.connect（带 handle + codec 协议）", async () => {
    const { host } = makeHost();
    const profile = createDefaultRtuProfile();
    await runConnect(host, {
      protocol: "rtu",
      profile,
      sheetProtocol: "rtu",
      handle,
      isMock: false,
    });
    expect(host.connect).toHaveBeenCalledWith(profile, handle, {
      protocol: "rtu",
    });
  });

  it("RTU mock → 调 host.connect（null handle）", async () => {
    const { host } = makeHost();
    const mockHost = { ...host, isMockMode: true };
    const profile = createDefaultRtuProfile();
    await runConnect(mockHost, {
      protocol: "rtu",
      profile,
      sheetProtocol: "rtu",
      handle: null,
      isMock: false,
    });
    expect(mockHost.connect).toHaveBeenCalledWith(profile, null, {
      protocol: "rtu",
    });
  });
});
