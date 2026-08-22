/**
 * 平台统一接口（docs/TECH_DESIGN.md §6.12、§7）。
 * UI 只通过该接口访问平台能力；平台不支持的能力由能力矩阵明确声明。
 */
import type {
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import type { PlatformCapabilities } from "@mamep2026/domain";
import type { Clock } from "@mamep2026/communication";
import type { TransportPort } from "@mamep2026/communication";

/** 串口设备句柄：不透明对象，禁止在领域层解析其标识。 */
export interface SerialDeviceHandle {
  readonly id: string;
  readonly label: string;
}

export interface PlatformHost {
  readonly capabilities: PlatformCapabilities;
  readonly clock: Clock;
  /** 浏览器授权选择设备；用户取消返回 ok(null)。 */
  requestSerialPort(): Promise<Result<SerialDeviceHandle | null>>;
  /** 用连接配置打开串口传输。串口核心参数已包含在 profile 中。 */
  openSerialTransport(
    handle: SerialDeviceHandle,
    profile: RtuConnectionProfile,
  ): Promise<Result<TransportPort>>;
  /**
   * 用连接配置打开 TCP 传输（Node 端能力，packages/platform-node）。
   * 不支持 TCP 的平台（如浏览器）返回 capability 错误。
   */
  openTcpTransport(
    profile: TcpConnectionProfile,
  ): Promise<Result<TransportPort>>;
}
