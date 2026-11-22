/**
 * connection-button（Header 连接 UI 整合）单测。
 * 覆盖：
 * - 9 个连接状态的可见状态文案、可访问动作、状态点颜色、呼吸映射
 * - 过渡态/等待态没有可执行动作
 * - 所有状态在所有布局均保留状态文字与状态点
 */
import { describe, expect, it } from "vitest";
import type { ConnectionState } from "@mamep2026/communication";
import { connectionButtonSpec } from "./connection-button";

const ALL_STATES: ConnectionState[] = [
  "disconnected",
  "selecting-device",
  "connecting",
  "connected",
  "disconnecting",
  "reconnect-waiting",
  "reconnecting",
  "interrupted",
  "failed",
];

describe("connectionButtonSpec", () => {
  it("disconnected → Offline（可访问动作 Connect、灰点）", () => {
    const spec = connectionButtonSpec("disconnected");
    expect(spec.stateLabelKey).toBe("state.disconnected");
    expect(spec.action).toEqual({
      kind: "connect",
      labelKey: "topbar.connect",
    });
    expect(spec.dotColor).toContain("quaternary");
    expect(spec.pulsing).toBe(false);
  });

  it("connected → Online（可访问动作 Disconnect、绿点）", () => {
    const spec = connectionButtonSpec("connected");
    expect(spec.stateLabelKey).toBe("state.connected");
    expect(spec.action).toEqual({
      kind: "disconnect",
      labelKey: "topbar.disconnect",
    });
    expect(spec.dotColor).toContain("success");
    expect(spec.pulsing).toBe(false);
  });

  it("过渡态只显示状态，不提供可执行动作", () => {
    for (const state of [
      "selecting-device",
      "connecting",
      "disconnecting",
      "reconnecting",
    ] as ConnectionState[]) {
      const spec = connectionButtonSpec(state);
      expect(spec.stateLabelKey).toBe(`state.${state}`);
      expect(spec.action).toBeNull();
      expect(spec.pulsing).toBe(true);
    }
  });

  it("reconnect-waiting 只显示状态，不提供重复点击动作", () => {
    const spec = connectionButtonSpec("reconnect-waiting");
    expect(spec.stateLabelKey).toBe("state.reconnect-waiting");
    expect(spec.action).toBeNull();
    expect(spec.pulsing).toBe(false);
  });

  it("failed / interrupted → 状态文字 + Reconnect 动作", () => {
    for (const state of ["failed", "interrupted"] as ConnectionState[]) {
      const spec = connectionButtonSpec(state);
      expect(spec.stateLabelKey).toBe(`state.${state}`);
      expect(spec.action).toEqual({
        kind: "reconnect",
        labelKey: "topbar.reconnect",
      });
    }
  });

  it("非过渡态不呼吸（disconnected/connected/reconnect-waiting/interrupted/failed）", () => {
    for (const state of [
      "disconnected",
      "connected",
      "reconnect-waiting",
      "interrupted",
      "failed",
    ] as ConnectionState[]) {
      expect(connectionButtonSpec(state).pulsing).toBe(false);
    }
  });

  it("所有状态均有稳定状态的 dotColor（非空）", () => {
    for (const state of ALL_STATES) {
      expect(connectionButtonSpec(state).dotColor).not.toBe("");
    }
  });

  it("所有状态均有可见状态文案与状态点", () => {
    for (const state of ALL_STATES) {
      const spec = connectionButtonSpec(state);
      expect(spec.stateLabelKey).toBe(`state.${state}`);
      expect(spec.dotColor).not.toBe("");
    }
  });
});
