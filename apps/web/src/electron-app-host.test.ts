/**
 * ElectronAppHost 单测（ADR-017，2026-08-21；2026-08-21 扩展为下拉框枚举）：
 * 能力翻转（RTU 支持 / serialPorts enumerated）、enumerated 串口选择（requestPort 直接
 * resolve 的已授权快照路径 + 主进程事件转发路径）、connect/读写委托走通、
 * 工作区经注入仓储、剪贴板透传 preload 桥。
 * 测试注入 fake serial + InMemoryWorkspaceRepository，不依赖 jsdom 全局（streams 用
 * node:stream/web，RTU 应答复用 test-kit ScriptedModbusRtuDevice）。
 */
import { describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import {
  createDefaultRtuProfile,
  defaultConfig,
  RegisterAddress,
  type DataType,
} from "@mamep2026/domain";
import type {
  HostDebugState,
  MamepHostApi,
  MamepHostEvent,
} from "@mamep2026/platform-api";
import type { Serial, SerialPort } from "@mamep2026/platform-web";
import {
  InMemoryWorkspaceRepository,
  ScriptedModbusRtuDevice,
} from "@mamep2026/test-kit";
import { RegisterTableService } from "@mamep2026/register-table";
import { ElectronAppHost } from "./electron-app-host";

function createFakeBridge(): {
  bridge: MamepHostApi;
  emit: (event: MamepHostEvent) => void;
  copyCalls: string[];
  serialSelectCalls: string[];
} {
  const listeners = new Set<(event: MamepHostEvent) => void>();
  const copyCalls: string[] = [];
  const serialSelectCalls: string[] = [];
  const bridge: MamepHostApi = {
    platform: "electron",
    getCapabilities: vi.fn(async (): Promise<Result<PlatformCapabilities>> => ({
      ok: true,
      value: {
        modbusRtu: true,
        modbusTcp: false,
        serialPorts: "enumerated",
        filesystem: "limited",
        nodePlugins: false,
        webPlugins: true,
      },
    })),
    getAppVersion: vi.fn(async (): Promise<Result<string>> => ({
      ok: true,
      value: "0.0.0-test",
    })),
    copyTextToClipboard: vi.fn(async (text: string): Promise<Result<void>> => {
      copyCalls.push(text);
      return { ok: true, value: undefined };
    }),
    readTextFromClipboard: vi.fn(
      async (): Promise<Result<string | null>> => ({ ok: true, value: null }),
    ),
    selectSerialPort: vi.fn(
      async (portId: string): Promise<Result<null>> => {
        serialSelectCalls.push(portId);
        // 默认视为成功解析（测试按场景 resolve/reject 挂起的 requestPort）。
        return { ok: true, value: null };
      },
    ),
    onEvent: vi.fn((listener: (event: MamepHostEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getDebugState: vi.fn(
      async (): Promise<Result<HostDebugState | null>> => ({
        ok: true,
        value: null,
      }),
    ),
  };
  return {
    bridge,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    copyCalls,
    serialSelectCalls,
  };
}

/**
 * 构造 fake Web Serial：requestPort 返回带真实字节流的 fake port，
 * 写侧交给 ScriptedModbusRtuDevice 应答并推入读侧（WebSerialTransport 读循环消费）。
 */
function createFakeWebSerial(device: ScriptedModbusRtuDevice): {
  serial: Serial;
  port: SerialPort;
  setCancelNext(): void;
} {
  let cancelNext = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const response = device.handleFrame(chunk);
      if (response !== null) controller?.enqueue(response);
    },
  });
  const port: SerialPort = {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    readable,
    writable,
    getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
  const serial: Serial = {
    getPorts: vi.fn(async (): Promise<SerialPort[]> => []),
    requestPort: vi.fn(async (): Promise<SerialPort> => {
      if (cancelNext) throw new DOMException("canceled", "NotFoundError");
      return port;
    }),
  };
  return {
    serial,
    port,
    setCancelNext: () => {
      cancelNext = true;
    },
  };
}

/**
 * 可控 fake Web Serial：requestPort 返回挂起 Promise，由测试显式 resolve/reject
 * （模拟主进程 select-serial-port callback 后 requestPort 才 settle）。
 */
function createControllableFakeWebSerial(device: ScriptedModbusRtuDevice): {
  serial: Serial;
  port: SerialPort;
  resolveRequest(): void;
  rejectRequest(cause: unknown): void;
} {
  let resolvePort: ((p: SerialPort) => void) | null = null;
  let rejectPort: ((e: unknown) => void) | null = null;
  const readable = new ReadableStream<Uint8Array>({});
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const response = device.handleFrame(chunk);
      if (response !== null) {
        // 无 controller 可推入（读侧无消费者），忽略即可。
        void response;
      }
    },
  });
  const port: SerialPort = {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    readable,
    writable,
    getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
  const serial: Serial = {
    getPorts: vi.fn(async (): Promise<SerialPort[]> => []),
    requestPort: vi.fn(
      (): Promise<SerialPort> =>
        new Promise<SerialPort>((resolve, reject) => {
          resolvePort = resolve;
          rejectPort = reject;
        }),
    ),
  };
  return {
    serial,
    port,
    resolveRequest: () => {
      resolvePort?.(port);
      resolvePort = null;
      rejectPort = null;
    },
    rejectRequest: (cause) => {
      rejectPort?.(cause);
      resolvePort = null;
      rejectPort = null;
    },
  };
}

function makeRow(address: number, dataType: DataType = "unsigned") {
  const row = RegisterTableService.createRow();
  const addr = RegisterAddress.create(address);
  if (addr.ok) row.addressValue = addr.value;
  row.dataType = dataType;
  row.cellText = "";
  return row;
}

describe("ElectronAppHost（ADR-017 扩展：enumerated 下拉框选择）", () => {
  it("能力矩阵已翻转：RTU 支持、串口 enumerated、TCP 不支持、非 mock", () => {
    const { bridge } = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    expect(host.capabilities.modbusRtu).toBe(true);
    expect(host.capabilities.modbusTcp).toBe(false);
    expect(host.capabilities.serialPorts).toBe("enumerated");
    expect(host.isMockMode).toBe(false);
    expect(host.supportsWebSerial()).toBe(true);
    expect(host.appVersion).toBe(__APP_VERSION__);
  });

  it("enumerateSerialPorts 返回已授权快照选项，selectSerialPort(\"0\") 返回句柄并保留端口标签", async () => {
    const { bridge } = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    const enumerated = await host.enumerateSerialPorts();
    expect(enumerated.ok).toBe(true);
    if (enumerated.ok) {
      expect(enumerated.value).toEqual([
        { portId: "0", label: "USB 1234:5678" },
      ]);
    }
    const selected = await host.selectSerialPort("0");
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.value).not.toBeNull();
      expect(selected.value?.label).toContain("USB");
    }
    expect(host.getCommProperties().portLabel).toContain("USB");
  });

  it("selectSerialPort 无挂起会话/无效 portId 返回 ok(null)（取消）", async () => {
    const { bridge } = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    // 未先枚举：无挂起选择会话，取消返回 ok(null) 而非报错。
    const cancel = await host.selectSerialPort(null);
    expect(cancel).toEqual({ ok: true, value: null });
  });

  it("enumerate 经主进程事件转发：selectSerialPort(portId) 回传并 await requestPort 获得句柄", async () => {
    const fake = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial, resolveRequest } = createControllableFakeWebSerial(device);
    const host = new ElectronAppHost(fake.bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });

    const enumeratePromise = host.enumerateSerialPorts();
    await vi.waitFor(() => expect(serial.requestPort).toHaveBeenCalled());
    fake.emit({
      kind: "serial-ports-available",
      payload: { ports: [{ portId: "com4", label: "COM4" }] },
    });
    const enumerated = await enumeratePromise;
    expect(enumerated.ok).toBe(true);
    if (enumerated.ok) {
      expect(enumerated.value).toEqual([{ portId: "com4", label: "COM4" }]);
    }

    const selectPromise = host.selectSerialPort("com4");
    expect(fake.serialSelectCalls).toEqual(["com4"]);
    resolveRequest();
    const selected = await selectPromise;
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.value?.label).toContain("USB");
    }
    expect(host.getCommProperties().portLabel).toContain("USB");
  });

  it("selectSerialPort 取消（空串）经主进程回传后返回 ok(null)", async () => {
    const fake = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial, rejectRequest } = createControllableFakeWebSerial(device);
    const host = new ElectronAppHost(fake.bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });

    const enumeratePromise = host.enumerateSerialPorts();
    await vi.waitFor(() => expect(serial.requestPort).toHaveBeenCalled());
    fake.emit({
      kind: "serial-ports-available",
      payload: { ports: [{ portId: "com4", label: "COM4" }] },
    });
    await enumeratePromise;

    const selectPromise = host.selectSerialPort(null);
    expect(fake.serialSelectCalls).toEqual([""]);
    rejectRequest(new DOMException("canceled", "NotFoundError"));
    const selected = await selectPromise;
    expect(selected).toEqual({ ok: true, value: null });
  });

  it("连接后单行读取（FC03）与写入（FC10）经统一调度器走通", async () => {
    const { bridge } = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });

    const enumerated = await host.enumerateSerialPorts();
    expect(enumerated.ok).toBe(true);
    const selected = await host.selectSerialPort("0");
    expect(selected.ok).toBe(true);
    const handle = selected.ok ? selected.value : null;
    const profile = createDefaultRtuProfile();
    const connected = await host.connect(profile, handle);
    expect(connected.ok).toBe(true);
    expect(host.getConnectionState()).toBe("connected");

    // FC03 读取：设备预置 0x0001 = 0xABCD。
    device.setRegister(0x0001, 0xabcd);
    const read = await host.readRow(makeRow(0x0001));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toBe(0xabcd);

    // FC10 写入：写十进制 1234 并回读确认（写后回读由设备寄存器验证）。
    const writeRow = makeRow(0x0002);
    writeRow.cellText = "1234";
    const written = await host.writeRow(writeRow);
    expect(written.ok).toBe(true);
    expect(device.getRegister(0x0002)).toBe(1234);
  });

  it("工作区经注入仓储委托（load/reset/scheduleSave）", async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = createFakeBridge();
      const device = new ScriptedModbusRtuDevice();
      const { serial } = createFakeWebSerial(device);
      const repository = new InMemoryWorkspaceRepository();
      const host = new ElectronAppHost(bridge, { serial, repository });

      const loaded = await host.loadWorkspace();
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.sheets[0]?.rows.length).toBe(
          defaultConfig.registerTable.defaultRowCount,
        );
        host.scheduleSave(loaded.value);
      }
      // 推进 AutoSave 防抖（500ms）后仓储应发生保存。
      await vi.advanceTimersByTimeAsync(600);
      expect(repository.saveCount).toBeGreaterThan(0);

      const reset = await host.resetWorkspace();
      expect(reset.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("剪贴板透传给 preload 桥", async () => {
    const fake = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(fake.bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    await host.copyTextToClipboard("clip-1");
    expect(fake.copyCalls).toEqual(["clip-1"]);
    const read = await host.readTextFromClipboard();
    expect(read).toEqual({ ok: true, value: null });
  });

  it("getCommProperties 反映真实会话状态与已选端口", async () => {
    const { bridge } = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    const profile = createDefaultRtuProfile();
    const enumerated = await host.enumerateSerialPorts();
    expect(enumerated.ok).toBe(true);
    const selected = await host.selectSerialPort("0");
    await host.connect(profile, selected.ok ? selected.value : null);
    const props = host.getCommProperties();
    expect(props.connectionState).toBe("connected");
    expect(props.baudRate).toBe(profile.baudRate);
    expect(props.portLabel).toContain("USB");
  });
});

