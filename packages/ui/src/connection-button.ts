import type { ConnectionState } from "@mamep2026/communication";
import { STATE_DOT_COLOR } from "./connection-state";

/**
 * Header 连接多功能按钮（连接 UI 整合）：
 * 把“连接状态”和“Connect/Disconnect 动作”放在同一个操作入口中：
 * 宽布局显示 `Offline · Connect` / `Online · Disconnect`，窄布局收起文字后
 * 仍通过状态点、动作图标和完整可访问名称保留三类语义中的前两类。
 *
 * 纯函数：输入连接状态 → 输出按钮渲染所需规格（状态文案 / 动作文案与图标 /
 * type / danger / 状态点颜色 / 呼吸 / 窄窗口是否隐藏文字）。
 * 状态点颜色沿用 STATE_DOT_COLOR（antd 语义 token），保证与 Comm Properties 状态读数一致。
 */

export type ConnectionButtonIcon =
  | "connect"
  | "disconnect"
  | "reconnect"
  | "busy";

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

/** antd Button `color` 取值子集（本项目只用到 primary / default 描边）。 */
export type ConnectionButtonColor = "default" | "primary";

export interface ConnectionButtonSpec {
  /** 当前连接状态 i18n key。 */
  stateLabelKey: string;
  /** 可执行动作；过渡态/等待态没有可执行动作。 */
  action: ConnectionButtonAction | null;
  /** 窄布局唯一保留的图标（动作图标或忙态图标）。 */
  icon: ConnectionButtonIcon;
  /** antd Button type。 */
  type: "primary" | "default";
  /** antd Button `color`（与 variant 配套：Connect 用 primary 主题色描边）。 */
  color?: ConnectionButtonColor;
  /** antd Button `variant`（outlined 描边；与 color 配套才生效）。 */
  variant?: "outlined";
  /** 断开样式（danger）。 */
  danger: boolean;
  /** 状态点颜色（CSS 颜色值，取自 STATE_DOT_COLOR）。 */
  dotColor: string;
  /** 过渡态状态点是否呼吸（尊重 prefers-reduced-motion）。 */
  pulsing: boolean;
  /** 窄窗口是否隐藏文字（仅保留状态点 + 图标；不隐藏连接状态）。 */
  hideLabel: boolean;
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

function iconFor(action: ConnectionButtonAction | null): ConnectionButtonIcon {
  return action?.kind ?? "busy";
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
  narrow: boolean,
): ConnectionButtonSpec {
  const disconnected = state === "disconnected";
  const action = actionFor(state);
  // 统一 Default 样式；未连接（Connect）额外用主题主色描边（default + color=primary + variant=outlined），
  // 与 Disconnect（danger 描边）同为「有外框颜色」的控件，颜色取自主题配套色。
  const type: "primary" | "default" = "default";
  const danger = state === "connected";
  const spec: ConnectionButtonSpec = {
    stateLabelKey: stateLabelFor(state),
    action,
    icon: iconFor(action),
    type,
    danger,
    dotColor: STATE_DOT_COLOR[state],
    pulsing: PULSING_STATES.has(state),
    hideLabel: narrow,
  };
  // 仅在未连接时注入 color/variant（exactOptionalPropertyTypes 不允许显式 undefined）。
  if (disconnected) {
    spec.color = "primary";
    spec.variant = "outlined";
  }
  return spec;
}
