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
  OpenTextFileResponse,
  PluginStoreDataResponse,
  PluginContributionQueryResponse,
  SaveTextFileResponse,
  SessionBatchReadResponse,
  SessionStateResponse,
  WorkspaceLoadResponse,
  WriteOutcomePayload,
} from "@mamep2026/platform-api";
import {
  createDefaultTcpProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
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
        modbusTcp: true,
        serialPorts: "enumerated",
        filesystem: "limited",
        nodePlugins: false,
        webPlugins: true,
        logExport: "save-dialog",
        workspaceImport: "file",
        workspaceExport: "save-dialog",
        pluginInstall: "file",
        executablePlugins: false,
        hostPlugins: false,
        protocolExtensions: [],
        tableTypes: ["holding-register"],
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
    // ---- 主进程 TCP 会话 RPC（2026-08-23 两端 TCP 接线）----
    sessionTcpConnect: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionDisconnect: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionGetState: vi.fn(
      async (): Promise<Result<SessionStateResponse>> => ({
        ok: true,
        value: { connectionState: "connected" },
      }),
    ),
    sessionSetUnitId: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionReadRow: vi.fn(async (): Promise<Result<number>> => ({
      ok: true,
      value: 0xabcd,
    })),
    sessionWriteRow: vi.fn(
      async (): Promise<Result<WriteOutcomePayload>> => ({
        ok: true,
        value: { kind: "write-succeeded-no-verify" },
      }),
    ),
    sessionBatchRead: vi.fn(
      async (batchId: string): Promise<Result<SessionBatchReadResponse>> => ({
        ok: true,
        value: {
          summary: {
            batchId,
            totalRows: 1,
            eligibleRows: 1,
            successCount: 1,
            failureCount: 0,
            skippedCount: 0,
            cancelledCount: 0,
            startedAt: 0,
            completedAt: 1,
            durationMs: 1,
          },
        },
      }),
    ),
    sessionBatchCancel: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionUpdatePollingTargets: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionPollingStart: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionPollingStop: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionTraceStart: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionTraceStop: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    saveTextFile: vi.fn(async (): Promise<Result<SaveTextFileResponse>> => ({
      ok: true,
      value: { saved: true, filePath: "C:\\logs\\comm-log.csv" },
    })),
    openTextFile: vi.fn(async (): Promise<Result<OpenTextFileResponse>> => ({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    })),
    // ---- 工作区文件仓储桥（2026-08-30，ADR-036：主进程文件持久化）----
    workspaceLoad: vi.fn(
      async (): Promise<Result<WorkspaceLoadResponse>> => ({
        ok: true,
        value: { content: '{"schemaVersion":4}' },
      }),
    ),
    workspaceSave: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    workspaceClear: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    // ---- 插件存储桥（2026-08-30，ADR-038：主进程 plugins.json 持久化）----
    pluginStoreLoad: vi.fn(
      async (): Promise<Result<PluginStoreDataResponse>> => ({
        ok: true,
        value: { schemaVersion: 2, plugins: [] },
      }),
    ),
    pluginStoreSave: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    // ---- 插件运行时桥（2026-08-31，ADR-039：Phase A 契约，测试不实际调用）----
    pluginRuntimeLoad: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    pluginRuntimeUnload: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    pluginRpc: vi.fn(async (): Promise<Result<unknown>> => ({
      ok: true,
      value: null,
    })),
    pluginContributionQuery: vi.fn(
      async (): Promise<Result<PluginContributionQueryResponse>> => ({
        ok: true,
        value: { points: [] },
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
  it("能力矩阵已翻转：RTU/TCP 支持、串口 enumerated、非 mock", () => {
    const { bridge } = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    expect(host.capabilities.modbusRtu).toBe(true);
    expect(host.capabilities.modbusTcp).toBe(true);
    expect(host.capabilities.serialPorts).toBe("enumerated");
    // 文件持久化已落地（2026-08-30，ADR-036）：主进程文件仓储。
    expect(host.capabilities.filesystem).toBe("full");
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

  it("saveTextFile（CSV 导出）透传给 preload 桥", async () => {
    const fake = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(fake.bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    const result = await host.saveTextFile({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
    expect(result).toEqual({
      ok: true,
      value: { saved: true, filePath: "C:\\logs\\comm-log.csv" },
    });
    expect(fake.bridge.saveTextFile).toHaveBeenCalledWith({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
  });

  it("openTextFile（工作区导入）透传给 preload 桥", async () => {
    const fake = createFakeBridge();
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    const host = new ElectronAppHost(fake.bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
    const result = await host.openTextFile({
      suggestedName: "mamep-workspace.json",
    });
    expect(result).toEqual({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    });
    expect(fake.bridge.openTextFile).toHaveBeenCalledWith({
      suggestedName: "mamep-workspace.json",
    });
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

describe("ElectronAppHost TCP 远程会话代理（2026-08-23 两端 TCP 接线）", () => {
  function makeTcpHost(bridge: MamepHostApi): ElectronAppHost {
    const device = new ScriptedModbusRtuDevice();
    const { serial } = createFakeWebSerial(device);
    return new ElectronAppHost(bridge, {
      serial,
      repository: new InMemoryWorkspaceRepository(),
    });
  }

  it("connectTcp 经 session-tcp-connect 委托主进程并进入 connected（TCP 路由生效）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeTcpHost(bridge);
    const profile: TcpConnectionProfile = createDefaultTcpProfile("PLC-502");
    profile.host = "192.168.1.10";
    profile.port = 502;
    const result = await host.connectTcp(profile);
    expect(result.ok).toBe(true);
    expect(bridge.sessionTcpConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          protocol: "tcp",
          host: "192.168.1.10",
          port: 502,
        }),
      }),
    );
    expect(host.getConnectionState()).toBe("connected");
    expect(host.getCommProperties().portLabel).toBe("192.168.1.10:502");
  });

  it("TCP 路由：readRow/writeRow/轮询/Trace 经主进程会话 RPC，不落 inner", async () => {
    const { bridge } = createFakeBridge();
    const host = makeTcpHost(bridge);
    await host.connectTcp(createDefaultTcpProfile());

    const read = await host.readRow(makeRow(0x0001));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toBe(0xabcd);
    expect(bridge.sessionReadRow).toHaveBeenCalled();

    const write = await host.writeRow(makeRow(0x0002));
    expect(write.ok).toBe(true);
    expect(bridge.sessionWriteRow).toHaveBeenCalled();

    host.updatePollingTargets([{ key: "row-a", address: 1 }]);    host.startPolling();
    host.traceStart("row-a", 1, 100);
    host.traceStop("row-a");
    expect(bridge.sessionUpdatePollingTargets).toHaveBeenCalled();
    expect(bridge.sessionPollingStart).toHaveBeenCalled();
    expect(bridge.sessionTraceStart).toHaveBeenCalledWith("row-a", 1, 100, 1);
  });

  it("TCP writeRow 携带 writeVerify 经 sessionWriteRow 转发（2026-08-26）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeTcpHost(bridge);
    await host.connectTcp(createDefaultTcpProfile());

    const row = makeRow(0x0002);
    row.cellText = "1234";
    const write = await host.writeRow(row, {
      writeVerify: { mode: "immediate", delayMs: null },
    });
    expect(write.ok).toBe(true);
    expect(bridge.sessionWriteRow).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: row.rowId,
        addressValue: { value: 0x0002 },
      }),
      { mode: "immediate", delayMs: null },
    );
  });

  it("TCP 活动时 setSlaveAddress 经 session-set-unit-id 转发主进程（2026-08-25）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeTcpHost(bridge);
    await host.connectTcp(createDefaultTcpProfile());

    host.setSlaveAddress(9);
    // TCP 路径：Unit ID 动态修改经远程 RPC 到主进程（不再守卫为 no-op）。
    expect(bridge.sessionSetUnitId).toHaveBeenCalledWith(9);
  });

  it("TCP readAllRows：携带渲染端 batchId，cancel 经 session-batch-cancel 转发（ADR-025）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeTcpHost(bridge);
    await host.connectTcp(createDefaultTcpProfile());

    const handle = host.readAllRows([{ key: "row-a", address: 1 }]);
    const summary = await handle.promise;
    expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.value.successCount).toBe(1);

    // 渲染端生成唯一 batchId 并随 session-batch-read 请求传入。
    const call = (bridge.sessionBatchRead as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toMatch(/^batch-/);
    expect(call?.[1]).toEqual([{ key: "row-a", address: 1 }]);

    // cancel 经 session-batch-cancel RPC 转发同一 batchId（幂等、异常安全）。
    const batchId = call?.[0];
    handle.cancel();
    expect(bridge.sessionBatchCancel).toHaveBeenCalledWith(batchId);
  });

  it("主进程 session 事件（comm-log/connection-state）转发本地订阅者", () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeTcpHost(bridge);
    const states: string[] = [];
    host.subscribeConnectionState((s) => states.push(s));
    emit({ kind: "connection-state", payload: { state: "interrupted" } });
    expect(states).toEqual(["interrupted"]);
    const logs: number[][] = [];
    host.subscribeCommLog((e) => logs.push(Array.from(e.bytes)));
    emit({
      kind: "comm-log",
      payload: {
        event: {
          timestamp: 1,
          direction: "request",
          bytesHex: "000100000006",
          protocol: "tcp",
          slaveAddress: 0,
          functionCode: 3,
          userAddress: 0,
          sentAddress: 0,
          quantity: 1,
          attempt: 1,
          status: "success",
          errorCode: null,
          exceptionCode: null,
          source: "manual-read",
          durationMs: null,
        },
      },
    });
    expect(logs).toEqual([[0, 1, 0, 0, 0, 6]]);
  });

  it("dispose 退订主进程桥事件：StrictMode 双挂载下旧 host 不再重复投递（2026-08-23）", async () => {
    const { bridge, emit } = createFakeBridge();
    const logs: number[][] = [];
    const host1 = makeTcpHost(bridge);
    host1.subscribeCommLog((e) => logs.push(Array.from(e.bytes)));
    await host1.dispose();
    const host2 = makeTcpHost(bridge);
    host2.subscribeCommLog((e) => logs.push(Array.from(e.bytes)));
    emit({
      kind: "comm-log",
      payload: {
        event: {
          timestamp: 1,
          direction: "request",
          bytesHex: "000100000006",
          protocol: "tcp",
          slaveAddress: 0,
          functionCode: 3,
          userAddress: 0,
          sentAddress: 0,
          quantity: 1,
          attempt: 1,
          status: "success",
          errorCode: null,
          exceptionCode: null,
          source: "manual-read",
          durationMs: null,
        },
      },
    });
    // 修复前：host1 + host2 各投递一次 → 2 条；修复后：仅 host2 → 1 条。
    expect(logs).toEqual([[0, 1, 0, 0, 0, 6]]);
  });

  it("session-tcp-connect 失败时连接不虚报成功", async () => {
    const { bridge } = createFakeBridge();
    (bridge.sessionTcpConnect as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: {
        code: "TCP_CONNECTION_FAILED",
        category: "connection",
        severity: "error",
        retryable: true,
        userMessageKey: "errors.tcpConnectionFailed",
        technicalMessage: "refused",
      },
    });
    const host = makeTcpHost(bridge);
    const result = await host.connectTcp(createDefaultTcpProfile());
    expect(result.ok).toBe(false);
    expect(host.getConnectionState()).toBe("disconnected");
  });
});

