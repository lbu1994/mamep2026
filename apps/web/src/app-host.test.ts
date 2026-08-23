/**
 * BrowserAppHost 通信日志与生命周期（2026-08-23）：
 * - 一次读取恰好产生 1 条 request + 1 条 response（Comm Log 无重复的会话层保证，
 *   与 VscodeAppHost/ElectronAppHost 的 dispose 修复共同覆盖「一次读取收发各两次」根因）；
 * - dispose 清空本地订阅集合（StrictMode 双挂载回归：旧 host 不再收到事件）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile, RegisterAddress } from "@mamep2026/domain";
import type { CommunicationLogEvent } from "@mamep2026/communication";
import { RegisterTableService } from "@mamep2026/register-table";
import { InMemoryWorkspaceRepository } from "@mamep2026/test-kit";
import { BrowserAppHost } from "./AppHost";

function makeMockHost(): BrowserAppHost {
  return new BrowserAppHost({
    platform: null,
    repository: new InMemoryWorkspaceRepository(),
    mockTransport: true,
  });
}

function makeRow(address: number) {
  const row = RegisterTableService.createRow();
  const addr = RegisterAddress.create(address);
  if (addr.ok) row.addressValue = addr.value;
  row.cellText = "";
  return row;
}

describe("BrowserAppHost 通信日志（一次读取 = 一次收发）", () => {
  it("mock 传输下一次读取产生恰好 1 条 request + 1 条 response", async () => {
    const host = makeMockHost();
    const logs: CommunicationLogEvent[] = [];
    host.subscribeCommLog((e) => logs.push(e));
    const connected = await host.connect(createDefaultRtuProfile(), null);
    expect(connected.ok).toBe(true);
    const result = await host.readRow(makeRow(1));
    expect(result.ok).toBe(true);
    expect(logs.filter((e) => e.direction === "request")).toHaveLength(1);
    expect(logs.filter((e) => e.direction === "response")).toHaveLength(1);
  });
});

describe("BrowserAppHost 生命周期（dispose，2026-08-23）", () => {
  it("dispose 清空本地订阅：之后连接状态变化不再投递", async () => {
    const host = makeMockHost();
    const states: string[] = [];
    host.subscribeConnectionState((s) => states.push(s));
    await host.dispose();
    await host.connect(createDefaultRtuProfile(), null);
    expect(states).toEqual([]);
  });

  it("dispose 幂等：重复调用不抛错", async () => {
    const host = makeMockHost();
    await host.dispose();
    await host.dispose();
  });
});
