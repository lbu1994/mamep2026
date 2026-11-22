import type { ConnectionState } from "@mamep2026/communication";
import { STATE_DOT_COLOR } from "./connection-state";

/**
 * Header 连接多功能按钮（连接 UI 整合）：
 * 把“连接状态”和“Connect/Disconnect 动作”放在同一个操作入口中：
 * 视觉上只显示连接状态（`Offline` / `Online` / `Connecting…` 等）；
 * 按钮的 aria-label/title 与 data-conn-action 保留当前可执行动作，避免交互语义丢失。
 *
 * 纯函数：输入连接状态 → 输出按钮渲染所需规格（状态文案 / 动作语义 /
 * 状态点颜色 / 呼吸）。
 * 状态点颜色沿用 STATE_DOT_COLOR（antd 语义 token），保证与 Comm Properties 状态读数一致。
 */

export type ConnectionButtonActionKind =
  | "connect"
  | "disconnect"
  | "reconnect";

export interface ConnectionButtonAction {
  /** 动作类型，同时作为 data 属性与图标选择依据。 */
  kind: ConnectionButtonActionKind;
  /** 可见动作文案 i18n key。 */
  labelKey: string;
}

export interface ConnectionButtonSpec {
  /** 当前连接状态 i18n key。 */
  stateLabelKey: string;
  /** 可执行动作；过渡态/等待态没有可执行动作。 */
  action: ConnectionButtonAction | null;
  /** 状态点颜色（CSS 颜色值，取自 STATE_DOT_COLOR）。 */
  dotColor: string;
  /** 过渡态状态点是否呼吸（尊重 prefers-reduced-motion）。 */
  pulsing: boolean;
}

function stateLabelFor(state: ConnectionState): string {
  return `state.${state}`;
}

function actionFor(state: ConnectionState): ConnectionButtonAction | null {
  switch (state) {
    case "disconnected":
      return { kind: "connect", labelKey: "topbar.connect" };
    case "connected":
      return { kind: "disconnect", labelKey: "topbar.disconnect" };
    case "failed":
    case "interrupted":
      return { kind: "reconnect", labelKey: "topbar.reconnect" };
    default:
      return null;
  }
}

/** 状态点是否呼吸（连接/断开/重连的过渡态）。 */
const PULSING_STATES: ReadonlySet<ConnectionState> = new Set([
  "selecting-device",
  "connecting",
  "disconnecting",
  "reconnecting",
]);

export function connectionButtonSpec(
  state: ConnectionState,
): ConnectionButtonSpec {
  const action = actionFor(state);
  return {
    stateLabelKey: stateLabelFor(state),
    action,
    dotColor: STATE_DOT_COLOR[state],
    pulsing: PULSING_STATES.has(state),
  };
}
