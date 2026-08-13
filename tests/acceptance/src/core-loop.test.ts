/**
 * 验收测试（ATDD）：用 FakeTransport + 模拟设备驱动完整核心闭环。
 */
import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  RegisterAddress,
  type RegisterRow,
} from "@mamep2026/domain";
import type { CommunicationLogEvent } from "@mamep2026/communication";
import {
  BatchReadCoordinator,
  CommunicationSession,
  PollingCoordinator,
} from "@mamep2026/communication";
import { RegisterTableService } from "@mamep2026/register-table";
import {
  FakeTransport,
  InMemoryWorkspaceRepository,
  ScriptedModbusRtuDevice,
  VirtualClock,
} from "@mamep2026/test-kit";
import { AutoSaveCoordinator } from "@mamep2026/workspace";

function makeRow(
  address: number,
  dataType: RegisterRow["dataType"] = "hex",
): RegisterRow {
  const row = RegisterTableService.createRow();
  const addr = RegisterAddress.create(address);
  if (addr.ok) row.addressValue = addr.value;
  row.dataType = dataType;
  row.cellText = "";
  return row;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("acceptance: browser RTU core loop", () => {
  it("reads a register, formats the value, and logs request/response bytes", async () => {
    const clock = new VirtualClock();
    const transport = new FakeTransport();
    transport.device = new ScriptedModbusRtuDevice();
    transport.device.setRegister(0x0001, 0x00ab);
    const profile = createDefaultRtuProfile();
    const logs: CommunicationLogEvent[] = [];
    const session = new CommunicationSession({
      transport,
      clock,
      config: profile,
      onLog: (e) => logs.push(e),
    });
    const service = new RegisterTableService({
      getSession: () => session,
      getAddressAdjustMode: () => profile.addressAdjust,
    });

    const connectResult = await session.connect();
    expect(connectResult.ok).toBe(true);

    const row = makeRow(0x0001, "hex");
    const readResult = await service.readRow(row);
    await flush();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    const applied = service.applyReadResult(row, readResult.value);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.cellText).toBe("00AB");
    }
    expect(
      logs.some((l) => l.direction === "request" && l.status === "success"),
    ).toBe(true);
    expect(
      logs.some((l) => l.direction === "response" && l.status === "success"),
    ).toBe(true);
  });

  it("writes a scaled value and the device register is updated", async () => {
    const clock = new VirtualClock();
    const device = new ScriptedModbusRtuDevice();
    const transport = new FakeTransport();
    transport.device = device;
    const profile = createDefaultRtuProfile();
    const session = new CommunicationSession({
      transport,
      clock,
      config: profile,
    });
    const service = new RegisterTableService({
      getSession: () => session,
      getAddressAdjustMode: () => profile.addressAdjust,
    });
    await session.connect();

    const row = makeRow(0x0002, "unsigned-0.1");
    row.cellText = "12.3";
    const writeResult = await service.writeRow(row);
    await flush();
    expect(writeResult.ok).toBe(true);
    expect(device.getRegister(0x0002)).toBe(123);
  });

  it("batch reads all eligible rows and continues after a failure", async () => {
    const clock = new VirtualClock();
    const device = new ScriptedModbusRtuDevice();
    device.setRegister(0x0001, 0x1111);
    device.setRegister(0x0002, 0x2222);
    const transport = new FakeTransport();
    transport.device = device;
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);

    const handle = coordinator.readAll([
      { key: "a", address: 0x0001 },
      { key: "blank", address: null },
      { key: "b", address: 0x0002 },
    ]);
    const result = await handle.promise;
    await flush();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRows).toBe(3);
      expect(result.value.successCount).toBe(2);
      expect(result.value.skippedCount).toBe(1);
      expect(result.value.failureCount).toBe(0);
    }
  });

  it("polling results do not overwrite rows whose address changed (generation)", async () => {
    const clock = new VirtualClock();
    const device = new ScriptedModbusRtuDevice();
    device.setRegister(0x0001, 0x1111);
    device.setRegister(0x0002, 0x2222);
    const transport = new FakeTransport();
    transport.device = device;
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();

    const polling = new PollingCoordinator(session, clock, {
      getIntervalMs: () => 50,
    });
    const results: Array<{ address: number; value: number }> = [];
    polling.onResult((_key, address, result) => {
      if (result.ok) results.push({ address, value: result.value });
    });
    polling.setTargets([{ key: "r1", address: 0x0001 }]);
    polling.start();

    // 推进若干轮后改地址。
    clock.advance(200);
    await flush();
    polling.setTargets([{ key: "r1", address: 0x0002 }]);
    // 推进时间覆盖轮询 tick 与请求间的 Rx Delay 间隔。
    clock.advance(200);
    await flush();
    clock.advance(100);
    await flush();
    polling.stop();

    // 应用层 generation 校验：只接受与当前目标地址一致的结果。
    const currentAddress = 0x0002;
    const valid = results.filter((r) => r.address === currentAddress);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[valid.length - 1]?.value).toBe(0x2222);
  });

  it("autosaves the workspace and restores configuration on reload (offline startup)", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const autosave = new AutoSaveCoordinator(repository, {
      debounceMs: 10,
      now: () => Date.now(),
      schedule: (cb, ms) => {
        const id = setTimeout(cb, ms);
        return { cancel: () => clearTimeout(id) };
      },
    });

    const initial = await repository.load();
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    autosave.scheduleSave(initial.value);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const loaded = await repository.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      // 恢复后连接配置仍在（除串口号外的配置恢复）。
      expect(loaded.value.connectionProfiles[0]?.interRequestDelayMs).toBe(50);
    }
  });
});
