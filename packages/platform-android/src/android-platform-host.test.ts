import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile, createTcpConnectionProfile } from "@mamep2026/domain";
import { AndroidPlatformHost } from "./android-platform-host";
import {
  androidCapabilities,
  resolveAndroidCapabilities,
} from "./android-capabilities";
import { FakeTransportBridge } from "./testing/fake-transport-bridge";
import { isAndroidPlatform } from "./detect-android";

function createHost(bridge = new FakeTransportBridge()): {
  host: AndroidPlatformHost;
  bridge: FakeTransportBridge;
} {
  return { host: new AndroidPlatformHost({ bridge }), bridge };
}

describe("androidCapabilities（如实声明，docs/AGENTS.md §8.4）", () => {
  it("Phase 2/5：TCP 与 USB 串口均支持，插件安装入口可用，文件通道仍如实声明未实现", () => {
    expect(androidCapabilities.modbusTcp).toBe(true);
    // Phase 2（2026-09-10）已实现 USB-RS485 → 如实翻转为支持。
    expect(androidCapabilities.modbusRtu).toBe(true);
    expect(androidCapabilities.serialPorts).toBe("enumerated");
    // WebView 原生支持 IndexedDB（与浏览器端同路径）。
    expect(androidCapabilities.filesystem).toBe("limited");
    // 插件执行能力由运行时探测覆盖，基础常量是 fail-closed 基线（ADR-056）。
    expect(androidCapabilities.executablePlugins).toBe(false);
    expect(androidCapabilities.hostPlugins).toBe(false);
    // Phase 5（ADR-056）：WebView 文件选择器可用。
    expect(androidCapabilities.pluginInstall).toBe("upload");
    expect(androidCapabilities.logExport).toBe("unsupported");
    expect(androidCapabilities.workspaceImport).toBe("unsupported");
    expect(androidCapabilities.workspaceExport).toBe("unsupported");
  });

  it("基础能力仅含核心协议扩展/表类型（插件贡献由 Host 经 deriveCapabilities 叠加，ADR-054）", () => {
    expect(androidCapabilities.protocolExtensions).toContain(
      "modbus-basic-tables:coil",
    );
    // 插件提供的协议扩展（如安川）不再写死进基础能力值。
    expect(androidCapabilities.protocolExtensions).not.toContain(
      "yaskawa-memobus-67h-010dh-010eh",
    );
    expect(androidCapabilities.tableTypes).toContain("holding-register");
    expect(androidCapabilities.tableTypes).not.toContain(
      "yaskawa-memobus-67h-010dh-010eh:holding-register",
    );
  });

  it("能力对象只读（防止运行时被改写）", () => {
    expect(Object.isFrozen(androidCapabilities)).toBe(true);
  });
});

describe("resolveAndroidCapabilities（运行时探测覆盖，ADR-056）", () => {
  it("探测可用 → executablePlugins 翻转为 true，其余能力不变", () => {
    const resolved = resolveAndroidCapabilities({ blobWorkerSupported: true });
    expect(resolved.executablePlugins).toBe(true);
    // 只覆盖该字段：其余能力与基础常量逐项一致。
    expect({ ...resolved, executablePlugins: false }).toEqual({
      ...androidCapabilities,
    });
    expect(resolved.pluginInstall).toBe("upload");
    expect(resolved.modbusTcp).toBe(true);
    expect(resolved.modbusRtu).toBe(true);
    expect(resolved.hostPlugins).toBe(false);
  });

  it("探测不可用 → 如实保持 false（不乐观翻转）", () => {
    const resolved = resolveAndroidCapabilities({ blobWorkerSupported: false });
    expect(resolved.executablePlugins).toBe(false);
  });

  it("返回新对象，基础常量不被改写", () => {
    const resolved = resolveAndroidCapabilities({ blobWorkerSupported: true });
    expect(resolved).not.toBe(androidCapabilities);
    expect(androidCapabilities.executablePlugins).toBe(false);
  });
});

describe("AndroidPlatformHost", () => {
  it("能力矩阵与时钟注入（默认 androidCapabilities / androidClock）", () => {
    const { host } = createHost();
    expect(host.capabilities).toBe(androidCapabilities);
    expect(typeof host.clock.now()).toBe("number");
  });

  it("串口枚举：映射 deviceName → portId，label 缺省回退 deviceName", async () => {
    const { host, bridge } = createHost();
    bridge.serialPortsResult = {
      ports: [
        { deviceName: "/dev/bus/usb/001/002", label: "CH340 (1-2)" },
        { deviceName: "/dev/bus/usb/001/003", label: "" },
      ],
    };

    const listed = await host.listSerialPorts();

    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value).toEqual([
        { portId: "/dev/bus/usb/001/002", label: "CH340 (1-2)" },
        { portId: "/dev/bus/usb/001/003", label: "/dev/bus/usb/001/003" },
      ]);
    }
  });

  it("串口枚举回包非法 → BRIDGE_PAYLOAD_INVALID（不静默降级）", async () => {
    const { host, bridge } = createHost();
    bridge.serialPortsResult = { ports: "nope" };

    const listed = await host.listSerialPorts();

    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error.code).toBe("BRIDGE_PAYLOAD_INVALID");
  });

  it("串口枚举失败 → 按串口上下文映射（如权限被拒）", async () => {
    const { host, bridge } = createHost();
    bridge.listSerialPortsError = {
      code: "USB_PERMISSION_DENIED",
      message: "denied",
    };

    const listed = await host.listSerialPorts();

    expect(listed.ok).toBe(false);
    if (!listed.ok) {
      expect(listed.error.userMessageKey).toBe("errors.serialPermissionDenied");
    }
  });

  it("selectSerialPort：按 portId 取 handle；空值/未命中返回 ok(null)；缓存未命中会自动重枚举", async () => {
    const { host, bridge } = createHost();
    bridge.serialPortsResult = {
      ports: [{ deviceName: "usb-1", label: "CH340 (1-1)" }],
    };

    const selected = await host.selectSerialPort("usb-1");
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value).toEqual({ id: "usb-1", label: "CH340 (1-1)" });

    const cancelled = await host.selectSerialPort(null);
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.value).toBeNull();

    const before = bridge.listSerialPortsCount;
    const missing = await host.selectSerialPort("usb-9");
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBeNull();
    expect(bridge.listSerialPortsCount).toBe(before + 1);
  });

  it("requestSerialPort（PlatformHost 契约）：无设备 → ok(null)，有设备 → 首个", async () => {
    const { host, bridge } = createHost();
    bridge.serialPortsResult = { ports: [] };
    const empty = await host.requestSerialPort();
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toBeNull();

    bridge.serialPortsResult = {
      ports: [
        { deviceName: "usb-1", label: "CH340 (1-1)" },
        { deviceName: "usb-2", label: "CP2102 (1-2)" },
      ],
    };
    const first = await host.requestSerialPort();
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value).toEqual({ id: "usb-1", label: "CH340 (1-1)" });
  });

  it("openSerialTransport：参数不受支持 → SERIAL_PARAMETER_UNSUPPORTED（不发请求）", async () => {
    const { host, bridge } = createHost();

    const opened = await host.openSerialTransport(
      { id: "usb-1", label: "CH340 (1-1)" },
      { ...createDefaultRtuProfile(), baudRate: 921600 },
    );

    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.code).toBe("SERIAL_PARAMETER_UNSUPPORTED");
      expect(opened.error.userMessageKey).toBe("errors.serialParameterUnsupported");
    }
    expect(bridge.serialOpenCalls).toEqual([]);
  });

  it("openSerialTransport：返回 Capacitor USB 串口传输（尚未 open，参数已映射）", async () => {
    const { host, bridge } = createHost();
    const profile = createDefaultRtuProfile("USB-RS485");

    const opened = await host.openSerialTransport(
      { id: "usb-1", label: "CH340 (1-1)" },
      { ...profile, baudRate: 19200, parity: "even" },
    );

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.kind).toBe("capacitor-usb");
    expect(opened.value.isOpen()).toBe(false);

    await opened.value.open();
    expect(bridge.serialOpenCalls).toEqual([
      {
        deviceName: "usb-1",
        baudRate: 19200,
        dataBits: 8,
        stopBits: 1,
        parity: "even",
        flowControl: "off",
      },
    ]);
  });

  it("openTcpTransport 返回 Capacitor TCP 传输（尚未 open）", async () => {
    const { host, bridge } = createHost();
    const profile = createTcpConnectionProfile({
      host: "192.168.1.10",
      port: 502,
      unitId: 1,
    });
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    const transport = await host.openTcpTransport(profile.value);

    expect(transport.ok).toBe(true);
    if (transport.ok) {
      expect(transport.value.kind).toBe("capacitor-tcp");
      expect(transport.value.isOpen()).toBe(false);
    }
    expect(bridge.openCalls).toEqual([]);
  });

  it("非法 profile 在网络访问前被拒（复用 domain 校验）", async () => {
    const { host, bridge } = createHost();
    const valid = createTcpConnectionProfile({
      host: "192.168.1.10",
      port: 502,
      unitId: 1,
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    // host 会重新校验（domain 为单一事实源），越过 UI 的非法值同样被拦下。
    const transport = await host.openTcpTransport({ ...valid.value, port: 0 });

    expect(transport.ok).toBe(false);
    if (!transport.ok) expect(transport.error.category).toBe("validation");
    expect(bridge.openCalls).toEqual([]);
  });
});

describe("isAndroidPlatform", () => {
  it("Capacitor.getPlatform() === 'android' 时为 true", () => {
    expect(isAndroidPlatform({ Capacitor: { getPlatform: () => "android" } })).toBe(true);
  });

  it("浏览器 / Electron / VSCode（无 Capacitor 或平台非 android）为 false", () => {
    expect(isAndroidPlatform({})).toBe(false);
    expect(isAndroidPlatform({ Capacitor: undefined })).toBe(false);
    expect(isAndroidPlatform({ Capacitor: { getPlatform: () => "web" } })).toBe(false);
    expect(isAndroidPlatform({ Capacitor: { getPlatform: () => "ios" } })).toBe(false);
  });

  it("getPlatform 抛错时安全返回 false（不把探测变成崩溃点）", () => {
    expect(
      isAndroidPlatform({
        Capacitor: {
          getPlatform: () => {
            throw new Error("bridge not ready");
          },
        },
      }),
    ).toBe(false);
  });
});
