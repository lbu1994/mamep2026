/**
 * Web Serial 最小授权单测（ADR-017；2026-08-21 扩展：延迟选择模式）。
 * 权限判定（仅本 origin）、端口列表转发（onPortsAvailable）、挂起选择解析
 * （resolvePendingSelection）、自动选择策略、origin 推导。
 * fake session 捕获 handler 并可直接触发 select-serial-port；不 mock electron 运行时。
 */
import { describe, expect, it, vi } from "vitest";
import {
  deriveAllowedOrigins,
  installSerialPermissionHandlers,
  normalizeOrigin,
  selectFirstPort,
  toPortOptions,
  type SerialPermissionSession,
} from "./serial-permissions";

type PermissionCheckHandler = NonNullable<
  Parameters<SerialPermissionSession["setPermissionCheckHandler"]>[0]
>;
type DevicePermissionHandler = NonNullable<
  Parameters<SerialPermissionSession["setDevicePermissionHandler"]>[0]
>;
type SelectSerialPortListener = Parameters<SerialPermissionSession["on"]>[1];

function createFakeSession() {
  let permissionCheck: PermissionCheckHandler | null = null;
  let devicePermission: DevicePermissionHandler | null = null;
  let selectListener: SelectSerialPortListener | null = null;
  const session: SerialPermissionSession = {
    on: vi.fn((event, listener) => {
      if (event === "select-serial-port") selectListener = listener;
    }),
    setPermissionCheckHandler: vi.fn((handler) => {
      permissionCheck = handler;
    }),
    setDevicePermissionHandler: vi.fn((handler) => {
      devicePermission = handler;
    }),
  };
  return {
    session,
    /** 触发 permissionCheck handler 并返回判定结果。 */
    check(
      permission: string,
      securityOrigin: string | undefined,
      requestingOrigin = "",
    ): boolean {
      const details =
        securityOrigin === undefined
          ? { isMainFrame: true }
          : { securityOrigin, isMainFrame: true };
      return (
        permissionCheck?.(null, permission, requestingOrigin, details) ?? false
      );
    },
    /** 触发 devicePermission handler 并返回判定结果。 */
    device(deviceType: string, origin: string): boolean {
      return devicePermission?.({ deviceType, origin, device: {} }) ?? false;
    },
    /**
     * 触发 select-serial-port 事件，返回是否 preventDefault、是否立即 callback 选端口、
     * 事件携带的 sender（供 resolvePendingSelection 归属校验）与 callback 记录。
     */
    select(
      portList: { portId: string; portName?: string; displayName?: string }[],
    ): {
      prevented: boolean;
      autoSelected: boolean;
      sender: unknown;
      callbacks: string[];
    } {
      let prevented = false;
      const callbacks: string[] = [];
      const sender = { tag: "webContents" };
      selectListener?.(
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        portList,
        sender,
        (portId) => {
          callbacks.push(portId);
        },
      );
      return {
        prevented,
        autoSelected: callbacks.length > 0,
        sender,
        callbacks,
      };
    },
  };
}

describe("deriveAllowedOrigins", () => {
  it("开发模式返回 dev server origin", () => {
    expect(deriveAllowedOrigins(false, "http://localhost:5173")).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("生产（打包）返回 file:// 两个变体", () => {
    expect(deriveAllowedOrigins(true, "http://localhost:5173")).toEqual([
      "file://",
      "file:///",
    ]);
  });

  it("未打包但无 dev server URL 时回退 file://", () => {
    expect(deriveAllowedOrigins(false, undefined)).toEqual([
      "file://",
      "file:///",
    ]);
  });
});

describe("normalizeOrigin", () => {
  it("http(s) 用 URL origin 归一化（dev 下 securityOrigin 为 http://localhost:5173/）", () => {
    expect(normalizeOrigin("http://localhost:5173/")).toBe(
      "http://localhost:5173",
    );
    expect(normalizeOrigin("http://localhost:5173////")).toBe(
      "http://localhost:5173",
    );
    expect(normalizeOrigin("https://example.com/path/")).toBe(
      "https://example.com",
    );
  });

  it("file:// 保持原样（allowlist 已含两个变体；URL API 对 file origin 归一为 null）", () => {
    expect(normalizeOrigin("file:///")).toBe("file:///");
    expect(normalizeOrigin("file://")).toBe("file://");
    expect(normalizeOrigin("https://evil.example")).toBe(
      "https://evil.example",
    );
    expect(normalizeOrigin(undefined)).toBeUndefined();
  });
});

describe("selectFirstPort", () => {
  it("有端口时选第一个", () => {
    expect(selectFirstPort([{ portId: "p1" }, { portId: "p2" }])).toBe("p1");
  });

  it("空列表返回空串（取消请求）", () => {
    expect(selectFirstPort([])).toBe("");
  });
});

describe("toPortOptions", () => {
  it("label 优先 portName，其次 displayName，最后 portId", () => {
    expect(
      toPortOptions([
        { portId: "p1", portName: "COM4", displayName: "USB Serial" },
        { portId: "p2", displayName: "USB Serial 2" },
        { portId: "p3" },
      ]),
    ).toEqual([
      { portId: "p1", label: "COM4" },
      { portId: "p2", label: "USB Serial 2" },
      { portId: "p3", label: "p3" },
    ]);
  });
});

describe("installSerialPermissionHandlers", () => {
  it("permissionCheck：仅 serial + 允许 origin 放行（带尾斜杠亦放行）", () => {
    const fake = createFakeSession();
    installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://", "file:///", "http://localhost:5173"],
    });
    expect(fake.check("serial", "file:///")).toBe(true);
    expect(fake.check("serial", "http://localhost:5173/")).toBe(true);
    expect(fake.check("serial", "https://evil.example")).toBe(false);
    expect(fake.check("serial", undefined)).toBe(false);
    expect(fake.check("clipboard-read", "file:///")).toBe(false);
  });

  it("devicePermission：仅 serial + 允许 origin 放行（带尾斜杠亦放行）", () => {
    const fake = createFakeSession();
    installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://", "http://localhost:5173"],
    });
    expect(fake.device("serial", "file://")).toBe(true);
    expect(fake.device("serial", "http://localhost:5173/")).toBe(true);
    expect(fake.device("serial", "https://evil.example")).toBe(false);
    expect(fake.device("hid", "file://")).toBe(false);
  });

  it("select-serial-port（延迟选择）：preventDefault、不自动回调、转发端口列表", () => {
    const fake = createFakeSession();
    const onPortsAvailable = vi.fn();
    installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
      onPortsAvailable,
    });
    const result = fake.select([
      { portId: "p1", portName: "COM4" },
      { portId: "p2" },
    ]);
    expect(result.prevented).toBe(true);
    expect(result.autoSelected).toBe(false);
    expect(onPortsAvailable).toHaveBeenCalledWith([
      { portId: "p1", label: "COM4" },
      { portId: "p2", label: "p2" },
    ]);
  });

  it("resolvePendingSelection：同 sender 回传 portId 触发 callback", () => {
    const fake = createFakeSession();
    const handlers = installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
    });
    const { sender, callbacks } = fake.select([{ portId: "p1" }]);
    expect(callbacks).toEqual([]);
    expect(handlers.resolvePendingSelection("p1", sender)).toBe(true);
    expect(callbacks).toEqual(["p1"]);
  });

  it("resolvePendingSelection：空串 = 用户取消", () => {
    const fake = createFakeSession();
    const handlers = installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
    });
    const { sender, callbacks } = fake.select([{ portId: "p1" }]);
    expect(handlers.resolvePendingSelection("", sender)).toBe(true);
    expect(callbacks).toEqual([""]);
  });

  it("resolvePendingSelection：异 sender 拒绝（不触发 callback）", () => {
    const fake = createFakeSession();
    const handlers = installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
    });
    fake.select([{ portId: "p1" }]);
    expect(handlers.resolvePendingSelection("p1", { tag: "other" })).toBe(
      false,
    );
  });

  it("resolvePendingSelection：无挂起请求返回 false", () => {
    const fake = createFakeSession();
    const handlers = installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
    });
    expect(handlers.resolvePendingSelection("p1", { tag: "wc" })).toBe(false);
  });

  it("可注入自定义端口选择策略（自动选择，不转发）", () => {
    const fake = createFakeSession();
    const onPortsAvailable = vi.fn();
    installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
      selectPort: (list) => list[list.length - 1]?.portId ?? "",
      onPortsAvailable,
    });
    const result = fake.select([{ portId: "p1" }, { portId: "p2" }]);
    expect(result.autoSelected).toBe(true);
    expect(result.callbacks).toEqual(["p2"]);
    expect(onPortsAvailable).not.toHaveBeenCalled();
  });

  it("自动选择策略：无可用端口 callback('')（取消）", () => {
    const fake = createFakeSession();
    installSerialPermissionHandlers(fake.session, {
      allowedOrigins: ["file://"],
      selectPort: selectFirstPort,
    });
    expect(fake.select([]).callbacks).toEqual([""]);
  });
});
