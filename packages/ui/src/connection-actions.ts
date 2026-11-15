/**
 * 连接动作共享逻辑（Header Connect 直连）：
 * Header「Connect」直连与 ConnectionSettingsModal 的 CONNECT 复用同一套
 * 连接执行（runConnect）与「可直连」判定（canDirectConnect），避免两处重复。
 *
 * - 直连判定依据存储 profile 的协议（决策 3）；RTU 依据会话内已选串口（决策 1），TCP 依据 host 非空（决策 2）。
 * - 串口端口句柄仅会话内存，不持久化（§19.3）。
 */
import type {
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import type { SerialDeviceHandle } from "@mamep2026/platform-api";
import type { AppHost } from "./host";

/** 串口能力被阻断（无 Web Serial + 非 enumerated + 非 mock）：不能直连，应回退弹窗。 */
export function isSerialBlocked(host: AppHost): boolean {
  const supportsSerial = host.supportsWebSerial();
  const serialPorts = host.capabilities.serialPorts;
  return !host.isMockMode && !supportsSerial && serialPorts !== "enumerated";
}

/**
 * 判定 Header「Connect」是否可直连（关键字段已就绪）：
 * - TCP：平台支持 TCP（能力矩阵）且 profile.host 非空（删除默认占位后，空串 = 未填入）。
 * - RTU：mock 模式可无端口直连；否则需会话内已选串口且串口能力未被阻断。
 */
export function canDirectConnect(
  host: AppHost,
  profile: RtuConnectionProfile | TcpConnectionProfile,
  selectedSerialHandle: SerialDeviceHandle | null,
): boolean {
  if (profile.protocol === "tcp") {
    if (!host.capabilities.modbusTcp) return false;
    return profile.host.trim().length > 0;
  }
  if (host.isMockMode) return true;
  if (isSerialBlocked(host)) return false;
  return selectedSerialHandle !== null;
}

/**
 * 统一执行连接（Header 直连与弹窗 onSubmit 共用；封装 mock null-handle 语义）。
 * @param opts.protocol 传输协议（RTU/TCP）
 * @param opts.profile 对应协议的连接 profile（可为表单派生或持久化）
 * @param opts.sheetProtocol 活动表 codec 协议（非核心表如安川/基础表）
 * @param opts.handle 会话内已选串口句柄（RTU 用；mock 或 TCP 忽略）
 */
export async function runConnect(
  host: AppHost,
  opts: {
    protocol: "rtu" | "tcp";
    profile: RtuConnectionProfile | TcpConnectionProfile;
    sheetProtocol: string;
    handle: SerialDeviceHandle | null;
    isMock: boolean;
  },
): Promise<Result<void>> {
  if (opts.protocol === "tcp") {
    return host.connectTcp(opts.profile as TcpConnectionProfile);
  }
  return host.connect(
    opts.profile as RtuConnectionProfile,
    opts.isMock ? null : opts.handle,
    { protocol: opts.sheetProtocol },
  );
}
