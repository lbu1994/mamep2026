import type { ConnectionState } from "@mamep2026/communication";

/**
 * 通信操作只允许在稳定在线态发起。连接中、断开中、失败和中断等状态均视为离线，
 * UI 门控与快捷键/宿主调用守卫必须共用这一判定。
 */
export function isCommunicationAvailable(state: ConnectionState): boolean {
  return state === "connected";
}
