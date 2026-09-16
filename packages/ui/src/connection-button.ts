import type { ConnectionState } from "@mamep2026/communication";
import { STATE_DOT_COLOR } from "./connection-state";

/**
 * Header 连接多功能按钮（2026-09-06 连接 UI 整合）：
 * 把「连接状态显示」与「Connect/Disconnect 按钮」合并为一个一体化控件——
 * 状态点并入按钮 + 按钮文字随连接状态切换。
 *
 * 纯函数：输入连接状态 → 输出按钮渲染所需规格（label / icon / type / danger /
 * 状态点颜色 / 呼吸 / aria-label / title / 窄窗口是否隐藏文字）。
 * 状态点颜色沿用 STATE_DOT_COLOR（antd 语义 token），保证与 Comm Properties 状态读数一致。
 */

export type ConnectionButtonIcon = "connect" | "disconnect";

/** antd Button `color` 取值子集（本项目只用到 primary / default 描边）。 */
export type ConnectionButtonColor = "default" | "primary";

export interface ConnectionButtonSpec {
  /** 可见文字 i18n key。 */
  labelKey: string;
  /** aria-label i18n key（点击语义）。 */
  ariaLabelKey: string;
  /** title（悬停提示）i18n key。 */
  titleKey: string;
  /** 按钮内操作图标。 */
  icon: ConnectionButtonIcon | null;
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

/** label 映射：disconnected/connected 用操作文案，其余用状态文字（state.*）。 */
function labelFor(state: ConnectionState): string {
  switch (state) {
    case "disconnected":
      return "topbar.connect";
    case "connected":
      return "topbar.connected";
    default:
      return `state.${state}`;
  }
}

/** aria-label：连接/断开/重连/忙态状态文字。 */
function ariaLabelFor(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "topbar.disconnect";
    case "failed":
    case "interrupted":
      return "topbar.reconnect";
    case "disconnected":
      return "topbar.connect";
    default:
      return `state.${state}`;
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
  narrow: boolean,
): ConnectionButtonSpec {
  const disconnected = state === "disconnected";
  const connected = state === "connected";
  const icon: ConnectionButtonIcon =
    connected || state === "disconnecting" ? "disconnect" : "connect";
  // 统一 Default 样式；未连接（Connect）额外用主题主色描边（default + color=primary + variant=outlined），
  // 与 Disconnect（danger 描边）同为「有外框颜色」的控件，颜色取自主题配套色。
  const type: "primary" | "default" = "default";
  const danger = connected;
  const spec: ConnectionButtonSpec = {
    labelKey: labelFor(state),
    ariaLabelKey: ariaLabelFor(state),
    titleKey: ariaLabelFor(state),
    icon,
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
