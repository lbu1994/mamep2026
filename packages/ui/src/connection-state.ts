import type { ConnectionState } from "@mamep2026/communication";

/**
 * 连接状态圆点颜色（形状 + 文字之外的颜色提示，取 antd 语义 token）。
 * 顶栏状态胶囊与 Comm Properties 状态读数共用，保持状态语义一致。
 */
export const STATE_DOT_COLOR: Record<ConnectionState, string> = {
  disconnected: "var(--ant-color-text-quaternary)",
  "selecting-device": "var(--ant-color-primary)",
  connecting: "var(--ant-color-primary)",
  connected: "var(--ant-color-success)",
  disconnecting: "var(--ant-color-primary)",
  "reconnect-waiting": "var(--ant-color-warning)",
  reconnecting: "var(--ant-color-primary)",
  interrupted: "var(--ant-color-warning)",
  failed: "var(--ant-color-error)",
};
