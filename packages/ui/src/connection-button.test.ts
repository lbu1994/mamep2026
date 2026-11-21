/**
 * connection-button（Header 连接 UI 整合）单测。
 * 覆盖：
 * - 9 个连接状态的“状态 + 动作”语义、图标、type、danger、状态点颜色、呼吸映射
 * - 过渡态/等待态没有可执行动作
 * - 窄窗口隐藏文字，但保留动作/忙态图标与状态点
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
  it("disconnected → Offline + Connect（主题主色描边、链接图标、灰点）", () => {
    const spec = connectionButtonSpec("disconnected", false);
    expect(spec.stateLabelKey).toBe("state.disconnected");
    expect(spec.action).toEqual({
      kind: "connect",
      labelKey: "topbar.connect",
    });
    expect(spec.icon).toBe("connect");
    expect(spec.type).toBe("default");
    expect(spec.color).toBe("primary");
    expect(spec.variant).toBe("outlined");
    expect(spec.danger).toBe(false);
    expect(spec.dotColor).toContain("quaternary");
    expect(spec.pulsing).toBe(false);
    expect(spec.hideLabel).toBe(false);
  });

  it("connected → Online + Disconnect（断开图标、绿点、danger 描边）", () => {
    const spec = connectionButtonSpec("connected", false);
    expect(spec.stateLabelKey).toBe("state.connected");
    expect(spec.action).toEqual({
      kind: "disconnect",
      labelKey: "topbar.disconnect",
    });
    expect(spec.icon).toBe("disconnect");
    expect(spec.type).toBe("default");
    expect(spec.color).toBeUndefined();
    expect(spec.variant).toBeUndefined();
    expect(spec.danger).toBe(true);
    expect(spec.dotColor).toContain("success");
    expect(spec.pulsing).toBe(false);
    expect(spec.hideLabel).toBe(false);
  });

  it("过渡态只显示状态，不提供可执行动作并显示忙态图标", () => {
    for (const state of [
      "selecting-device",
      "connecting",
      "disconnecting",
      "reconnecting",
    ] as ConnectionState[]) {
      const spec = connectionButtonSpec(state, false);
      expect(spec.stateLabelKey).toBe(`state.${state}`);
      expect(spec.action).toBeNull();
      expect(spec.icon).toBe("busy");
      expect(spec.pulsing).toBe(true);
      expect(spec.type).toBe("default");
      expect(spec.danger).toBe(false);
    }
  });

  it("reconnect-waiting 只显示状态，不提供重复点击动作", () => {
    const spec = connectionButtonSpec("reconnect-waiting", false);
    expect(spec.stateLabelKey).toBe("state.reconnect-waiting");
    expect(spec.action).toBeNull();
    expect(spec.icon).toBe("busy");
    expect(spec.pulsing).toBe(false);
  });

  it("failed / interrupted → 状态文字 + Reconnect 动作", () => {
    for (const state of ["failed", "interrupted"] as ConnectionState[]) {
      const spec = connectionButtonSpec(state, false);
      expect(spec.stateLabelKey).toBe(`state.${state}`);
      expect(spec.action).toEqual({
        kind: "reconnect",
        labelKey: "topbar.reconnect",
      });
      expect(spec.icon).toBe("reconnect");
      expect(spec.type).toBe("default");
      expect(spec.danger).toBe(false);
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
      expect(connectionButtonSpec(state, false).pulsing).toBe(false);
    }
  });

  it("所有状态均有稳定状态的 dotColor（非空）", () => {
    for (const state of ALL_STATES) {
      expect(connectionButtonSpec(state, false).dotColor).not.toBe("");
    }
  });

  it("窄窗口隐藏文字，但保留动作/忙态图标与状态点", () => {
    for (const state of ALL_STATES) {
      const spec = connectionButtonSpec(state, true);
      expect(spec.hideLabel).toBe(true);
      expect(spec.icon).not.toBe("");
      expect(spec.dotColor).not.toBe("");
    }
  });
});
