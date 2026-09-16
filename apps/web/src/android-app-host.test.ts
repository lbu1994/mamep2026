/**
 * AndroidAppHost 单测（apps/web 组合根，ADR-050）。
 * 覆盖：平台标识/能力矩阵/兼容性提示抑制、串口能力错误、TCP 连接（含 Android 默认超时覆盖）、
 * FC03 读闭环（穿过 TcpSessionHost + TcpFrameParser）、Unit ID 动态修改、事件转发与释放。
 * 传输桥注入 `platform-android/testing` 的 FakeTransportBridge（无需 Android 环境）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createTcpConnectionProfile,
  createDefaultRtuProfile,
  createEmptyRow,
  RegisterAddress,
  type RegisterRow,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import { InMemoryWorkspaceRepository } from "@mamep2026/test-kit";
import {
  decodeBase64ToBytes,
  ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS,
  ANDROID_TCP_DEFAULT_RETRY_COUNT,
  type AndroidAppLifecycleBridge,
} from "@mamep2026/platform-android";
import { FakeTransportBridge } from "@mamep2026/platform-android/testing";
import { AndroidAppHost } from "./android-app-host";

async function flushMicrotasks(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

/**
 * 假应用生命周期桥（ADR-050 Phase 3）：记录订阅/退订与最小化调用，
 * `backHandlers` / `stateHandlers` 由用例直接触发，避免依赖真实 `@capacitor/app`。
 */
class FakeAppLifecycleBridge implements AndroidAppLifecycleBridge {
  readonly backHandlers: Array<() => boolean> = [];
  readonly stateHandlers: Array<(isActive: boolean) => void> = [];
  minimizeCount = 0;
  backRemoveCount = 0;
  stateRemoveCount = 0;
  /** true 时 `onBackButton` 直接 reject（模拟插件未注册）。 */
  rejectBackButton = false;

  async onBackButton(handler: () => boolean): Promise<() => void> {
    if (this.rejectBackButton) throw new Error("plugin not implemented");
    this.backHandlers.push(handler);
    return () => {
      this.backRemoveCount += 1;
    };
  }

  async onAppStateChange(
    handler: (isActive: boolean) => void,
  ): Promise<() => void> {
    this.stateHandlers.push(handler);
    return () => {
      this.stateRemoveCount += 1;
    };
  }

  async minimizeApp(): Promise<void> {
    this.minimizeCount += 1;
  }
}

function createHost(
  bridge = new FakeTransportBridge(),
  appLifecycle: AndroidAppLifecycleBridge | null = null,
): {
  host: AndroidAppHost;
  bridge: FakeTransportBridge;
} {
  return {
    bridge,
    host: new AndroidAppHost({
      bridge,
      repository: new InMemoryWorkspaceRepository(),
      appLifecycle,
    }),
  };
}

function makeRow(address: number): RegisterRow {
  const row = createEmptyRow();
  const parsed = RegisterAddress.create(address);
  row.addressValue = parsed.ok ? parsed.value : null;
  return row;
}

/** 显式 host 的 TCP profile（注意 `createDefaultTcpProfile` 的 host 默认为空，用于「直连」判断）。 */
function tcpProfile(
  overrides: Partial<TcpConnectionProfile> = {},
): TcpConnectionProfile {
  const created = createTcpConnectionProfile({
    host: "192.168.1.10",
    port: 502,
    unitId: 1,
  });
  if (!created.ok) throw new Error("test fixture invalid");
  return { ...created.value, ...overrides };
}

/** 组 Modbus TCP 响应帧（MBAP + PDU，无 CRC）。 */
function readResponse(tid: number, unitId: number, value: number): Uint8Array {
  const pdu = Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]);
  const length = 1 + pdu.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = (tid >> 8) & 0xff;
  frame[1] = tid & 0xff;
  frame[4] = (length >> 8) & 0xff;
  frame[5] = length & 0xff;
  frame[6] = unitId;
  frame.set(pdu, 7);
  return frame;
}

function lastRequest(bridge: FakeTransportBridge): Uint8Array {
  const encoded = bridge.writeCalls[bridge.writeCalls.length - 1];
  if (encoded === undefined) throw new Error("no request written to bridge");
  const decoded = decodeBase64ToBytes(encoded);
  if (!decoded.ok) throw new Error("request is not valid base64");
  return decoded.value;
}

describe("AndroidAppHost：平台声明", () => {
  it("platform=android、能力矩阵如实（TCP + USB 串口均支持）、不用浏览器兼容性提示", () => {
    const { host } = createHost();

    expect(host.platform).toBe("android");
    expect(host.capabilities.modbusTcp).toBe(true);
    expect(host.capabilities.modbusRtu).toBe(true);
    expect(host.capabilities.serialPorts).toBe("enumerated");
    // 不能弹「浏览器不支持 Web Serial」横幅（Android 不用 Web Serial）。
    expect(host.browserCompatibility).toBeNull();
    expect(host.supportsWebSerial()).toBe(false);
    expect(host.isMockMode).toBe(false);
  });

  it("串口枚举：无设备 → 空列表；选择未命中 → ok(null)", async () => {
    const { host } = createHost();

    const enumerated = await host.enumerateSerialPorts();
    expect(enumerated.ok).toBe(true);
    if (enumerated.ok) expect(enumerated.value).toEqual([]);

    const selected = await host.selectSerialPort("usb-404");
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value).toBeNull();
  });

  it("串口枚举 → 选择 → 打开：串口参数映射到桥，portLabel 进入通信属性", async () => {
    const { host, bridge } = createHost();
    bridge.serialPortsResult = {
      ports: [{ deviceName: "usb-1", label: "CH340 (1-1)" }],
    };

    const enumerated = await host.enumerateSerialPorts();
    expect(enumerated.ok).toBe(true);
    if (enumerated.ok) {
      expect(enumerated.value).toEqual([
        { portId: "usb-1", label: "CH340 (1-1)" },
      ]);
    }

    const selected = await host.selectSerialPort("usb-1");
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value).toEqual({ id: "usb-1", label: "CH340 (1-1)" });

    const profile = {
      ...createDefaultRtuProfile("USB-RS485"),
      baudRate: 19200,
    };
    const connected = await host.connect(profile, selected.value);

    expect(connected.ok).toBe(true);
    expect(bridge.serialOpenCalls).toEqual([
      {
        deviceName: "usb-1",
        baudRate: 19200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
      },
    ]);
    expect(host.getConnectionState()).toBe("connected");
    expect(host.getCommProperties().portLabel).toBe("CH340 (1-1)");
    expect(host.getCommProperties().protocol).toBe("rtu");

    await host.disconnect();
  });

  it("文件导入导出返回能力错误（Phase 4 接 Capacitor Filesystem）", async () => {
    const { host } = createHost();

    const saved = await host.saveTextFile({
      suggestedName: "log.csv",
      content: "a",
    });
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error.category).toBe("capability");

    const opened = await host.openTextFile();
    expect(opened.ok).toBe(false);
    if (!opened.ok)
      expect(opened.error.code).toBe("WORKSPACE_IMPORT_UNSUPPORTED");
  });
});

describe("AndroidAppHost：TCP 连接", () => {
  it("connectTcp 经桥打开原生 socket，状态转为 connected，通信属性为 TCP", async () => {
    const { host, bridge } = createHost();

    const result = await host.connectTcp(tcpProfile());

    expect(result.ok).toBe(true);
    expect(bridge.openCalls).toHaveLength(1);
    const openCall = bridge.openCalls[0];
    expect(openCall?.host).toBe("192.168.1.10");
    expect(openCall?.port).toBe(502);
    expect(host.getConnectionState()).toBe("connected");

    const properties = host.getCommProperties();
    expect(properties.protocol).toBe("tcp");
    expect(properties.portLabel).toBe("192.168.1.10:502");
    expect(properties.connectionState).toBe("connected");
  });

  it("Android 默认超时/重试覆盖生效（库默认 50ms/1 → 300ms/2）", async () => {
    const { host, bridge } = createHost();

    await host.connectTcp(tcpProfile());

    expect(bridge.openCalls[0]?.connectTimeoutMs).toBe(5000);
    const properties = host.getCommProperties();
    expect(properties.timeoutMs).toBe(ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS);
    expect(properties.retryCount).toBe(ANDROID_TCP_DEFAULT_RETRY_COUNT);
  });

  it("用户显式改过的超时值保留（只覆盖未自定义项）", async () => {
    const { host } = createHost();

    await host.connectTcp(tcpProfile({ requestTimeoutMs: 1200 }));

    expect(host.getCommProperties().timeoutMs).toBe(1200);
  });

  it("桥打开失败 → 返回结构化错误且状态仍为 disconnected", async () => {
    const { host, bridge } = createHost();
    bridge.openError = {
      code: "TCP_CONNECT_FAILED",
      message: "connection refused",
    };

    const result = await host.connectTcp(tcpProfile());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_CONNECTION_FAILED");
      expect(result.error.category).toBe("connection");
    }
    expect(host.getConnectionState()).toBe("disconnected");
  });
});

describe("AndroidAppHost：FC03 读闭环（穿过调度器与 TCP 帧解析）", () => {
  it("readRow 把 MBAP 请求交给桥，并把桥收到的响应解析为寄存器值", async () => {
    const { host, bridge } = createHost();
    await host.connectTcp(tcpProfile());

    const pending = host.readRow(makeRow(1));
    await flushMicrotasks();

    const request = lastRequest(bridge);
    const tid = ((request[0] ?? 0) << 8) | (request[1] ?? 0);
    const unitId = request[6] ?? 0;
    expect(unitId).toBe(1);
    expect(request[7]).toBe(0x03);

    bridge.emitData(readResponse(tid, unitId, 0xabcd));
    const result = await pending;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0xabcd);
  });

  it("setSlaveAddress 在 TCP 下等价于改 Unit ID（后续请求帧的 unit 字节变化）", async () => {
    const { host, bridge } = createHost();
    await host.connectTcp(tcpProfile());
    host.setSlaveAddress(7);

    const pending = host.readRow(makeRow(1));
    await flushMicrotasks();

    const request = lastRequest(bridge);
    const unitId = request[6] ?? 0;
    expect(unitId).toBe(7);

    const tid = ((request[0] ?? 0) << 8) | (request[1] ?? 0);
    bridge.emitData(readResponse(tid, unitId, 0x0001));
    expect((await pending).ok).toBe(true);
  });

  it("断开后读失败且桥被关闭", async () => {
    const { host, bridge } = createHost();
    await host.connectTcp(tcpProfile());

    const disconnected = await host.disconnect();
    expect(disconnected.ok).toBe(true);
    expect(bridge.closeCount).toBe(1);
    expect(host.getConnectionState()).toBe("disconnected");

    const result = await host.readRow(makeRow(1));
    expect(result.ok).toBe(false);
  });

  it("通信日志事件经 host 转发（协议为 tcp）", async () => {
    const { host, bridge } = createHost();
    const logs: string[] = [];
    host.subscribeCommLog((event) => logs.push(event.protocol));
    await host.connectTcp(tcpProfile());

    const pending = host.readRow(makeRow(1));
    await flushMicrotasks();
    const request = lastRequest(bridge);
    const tid = ((request[0] ?? 0) << 8) | (request[1] ?? 0);
    bridge.emitData(readResponse(tid, request[6] ?? 0, 0x1234));
    await pending;

    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.every((protocol) => protocol === "tcp")).toBe(true);
  });
});

describe("AndroidAppHost：释放", () => {
  it("dispose 断开会话、清空订阅且不留桥监听", async () => {
    const { host, bridge } = createHost();
    const listener = vi.fn();
    host.subscribeConnectionState(listener);
    await host.connectTcp(tcpProfile());

    await host.dispose();

    expect(bridge.closeCount).toBe(1);
    expect(bridge.listenerCount).toBe(0);
    expect(host.getConnectionState()).toBe("disconnected");
    listener.mockClear();
    // dispose 后不再有事件投递（订阅集合已清空）。
    bridge.emitClosed();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("AndroidAppHost：硬件返回键（ADR-050 Phase 3）", () => {
  it("已消费时不最小化应用，取消订阅后立即退订", async () => {
    const lifecycle = new FakeAppLifecycleBridge();
    const { host } = createHost(new FakeTransportBridge(), lifecycle);

    const unsubscribe = host.onHardwareBack(() => true);
    await flushMicrotasks();
    expect(lifecycle.backHandlers).toHaveLength(1);

    expect(lifecycle.backHandlers[0]!()).toBe(true);
    await flushMicrotasks();
    expect(lifecycle.minimizeCount).toBe(0);

    unsubscribe?.();
    expect(lifecycle.backRemoveCount).toBe(1);
  });

  it("未消费时最小化应用，且仍向 Capacitor 回答「已处理」（不退出进程）", async () => {
    const lifecycle = new FakeAppLifecycleBridge();
    const { host } = createHost(new FakeTransportBridge(), lifecycle);

    host.onHardwareBack(() => false);
    await flushMicrotasks();

    expect(lifecycle.backHandlers[0]!()).toBe(true);
    await flushMicrotasks();
    expect(lifecycle.minimizeCount).toBe(1);
  });

  it("未注入生命周期桥（浏览器/桌面）返回 null", () => {
    const { host } = createHost();
    expect(host.onHardwareBack(() => true)).toBeNull();
  });

  it("订阅尚在途中就取消：解析后立即退订，不泄漏监听", async () => {
    const lifecycle = new FakeAppLifecycleBridge();
    const { host } = createHost(new FakeTransportBridge(), lifecycle);

    const unsubscribe = host.onHardwareBack(() => true);
    unsubscribe?.();
    await flushMicrotasks();

    expect(lifecycle.backRemoveCount).toBe(1);
  });

  it("桥不可用（插件未注册）时静默降级，取消订阅不抛错", async () => {
    const lifecycle = new FakeAppLifecycleBridge();
    lifecycle.rejectBackButton = true;
    const { host } = createHost(new FakeTransportBridge(), lifecycle);

    const unsubscribe = host.onHardwareBack(() => true);
    await flushMicrotasks();

    expect(lifecycle.backHandlers).toHaveLength(0);
    expect(() => unsubscribe?.()).not.toThrow();
  });
});
