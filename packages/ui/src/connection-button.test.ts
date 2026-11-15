/**
 * connection-button（Header 连接 UI 整合）单测。
 * 覆盖：
 * - 9 个连接状态的 label / aria / icon / type / danger / 状态点颜色 / 呼吸映射
 * - 窄窗口隐藏文字（不隐藏状态点）
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
  it("disconnected → Connect 按钮（default + 主题主色描边，api 图标，灰点，不呼吸，显示文字）", () => {
    const spec = connectionButtonSpec("disconnected", false);
    expect(spec.labelKey).toBe("topbar.connect");
    expect(spec.ariaLabelKey).toBe("topbar.connect");
    expect(spec.icon).toBe("connect");
    expect(spec.type).toBe("default");
    expect(spec.color).toBe("primary");
    expect(spec.variant).toBe("outlined");
    expect(spec.danger).toBe(false);
    expect(spec.dotColor).toContain("quaternary");
    expect(spec.pulsing).toBe(false);
    expect(spec.hideLabel).toBe(false);
  });

  it("connected → Online / Disconnect 组合（disconnect 图标，绿点，danger 描边，显示文字）", () => {
    const spec = connectionButtonSpec("connected", false);
    expect(spec.labelKey).toBe("topbar.connected");
    expect(spec.ariaLabelKey).toBe("topbar.disconnect");
    expect(spec.icon).toBe("disconnect");
    expect(spec.type).toBe("default");
    expect(spec.color).toBeUndefined();
    expect(spec.variant).toBeUndefined();
    expect(spec.danger).toBe(true);
    expect(spec.dotColor).toContain("success");
    expect(spec.pulsing).toBe(false);
    expect(spec.hideLabel).toBe(false);
  });

  it("过渡态（connecting/disconnecting/reconnecting/selecting-device）显示状态文字且呼吸", () => {
    for (const state of [
      "selecting-device",
      "connecting",
      "disconnecting",
      "reconnecting",
    ] as ConnectionState[]) {
      const spec = connectionButtonSpec(state, false);
      expect(spec.labelKey).toBe(`state.${state}`);
      expect(spec.pulsing).toBe(true);
      expect(spec.icon).toBe(
        state === "disconnecting" ? "disconnect" : "connect",
      );
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

  it("failed / interrupted → 重连入口（aria/title 为 reconnect）", () => {
    for (const state of ["failed", "interrupted"] as ConnectionState[]) {
      const spec = connectionButtonSpec(state, false);
      expect(spec.ariaLabelKey).toBe("topbar.reconnect");
      expect(spec.titleKey).toBe("topbar.reconnect");
      expect(spec.labelKey).toBe(`state.${state}`);
      expect(spec.icon).toBe("connect");
      expect(spec.type).toBe("default");
      expect(spec.danger).toBe(false);
    }
  });

  it("所有状态均有稳定状态的 dotColor（非空）", () => {
    for (const state of ALL_STATES) {
      const spec = connectionButtonSpec(state, false);
      expect(spec.dotColor).not.toBe("");
    }
  });

  it("窄窗口隐藏文字（hideLabel=true），但状态点颜色仍保留", () => {
    for (const state of ALL_STATES) {
      const spec = connectionButtonSpec(state, true);
      expect(spec.hideLabel).toBe(true);
      expect(spec.dotColor).not.toBe("");
    }
  });
});
