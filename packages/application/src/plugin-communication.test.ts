/**
 * createPluginCommunicationApi 单测。
 * 覆盖：read/write 经 CommunicationSession 执行且日志携带 source=plugin + pluginId、
 * 无会话时返回 PLUGIN_RUNTIME_NOT_AVAILABLE 能力错误。
 */
import { describe, expect, it } from "vitest";
import { CommunicationSession } from "@mamep2026/communication";
import type { CommunicationLogEvent } from "@mamep2026/communication";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import {
  FakeTransport,
  ScriptedModbusRtuDevice,
  VirtualClock,
} from "@mamep2026/test-kit";
import { createPluginCommunicationApi } from "./plugin-communication";

describe("createPluginCommunicationApi（ADR-039）", () => {
  it("read/write 经 CommunicationSession 执行，日志携带 source=plugin + pluginId", async () => {
    const clock = new VirtualClock();
    const device = new ScriptedModbusRtuDevice();
    const transport = new FakeTransport();
    transport.device = device;
    const logs: CommunicationLogEvent[] = [];
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
      slaveAddress: 1,
      onLog: (event) => logs.push(event),
    });
    expect((await session.connect()).ok).toBe(true);

    const api = createPluginCommunicationApi({
      getSession: () => session,
      pluginId: "test-plugin",
    });
    const read = await api.readRegisters({ address: 0x1000, quantity: 1 });
    expect(read.ok).toBe(true);
    const write = await api.writeRegisters({
      address: 0x1000,
      values: [0x1234],
    });
    expect(write.ok).toBe(true);

    // 冲刷异步链路后断言日志。
    for (let i = 0; i < 16; i++) await Promise.resolve();
    const pluginLogs = logs.filter((entry) => entry.source === "plugin");
    expect(pluginLogs.length).toBeGreaterThan(0);
    expect(pluginLogs.every((entry) => entry.pluginId === "test-plugin")).toBe(
      true,
    );
  });

  it("无会话 → PLUGIN_RUNTIME_NOT_AVAILABLE 能力错误（category plugin）", async () => {
    const api = createPluginCommunicationApi({
      getSession: () => null,
      pluginId: "orphan",
    });
    const read = await api.readRegisters({ address: 0, quantity: 1 });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.code).toBe("PLUGIN_RUNTIME_NOT_AVAILABLE");
      expect(read.error.category).toBe("plugin");
    }
  });
});
