import { describe, expect, it } from "vitest";
import {
  createUnavailableCommunicationApi,
  PLUGIN_RUNTIME_NOT_AVAILABLE,
} from "./plugin-communication-api";

describe("PluginCommunicationApi（ADR-039）", () => {
  it("无会话兜底 API：read/write 返回 PLUGIN_RUNTIME_NOT_AVAILABLE（category plugin）", async () => {
    const api = createUnavailableCommunicationApi();
    const read = await api.readRegisters({ address: 0, quantity: 1 });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.code).toBe(PLUGIN_RUNTIME_NOT_AVAILABLE);
      expect(read.error.category).toBe("plugin");
    }
    const write = await api.writeRegisters({ address: 0, values: [1] });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.code).toBe(PLUGIN_RUNTIME_NOT_AVAILABLE);
  });
});
