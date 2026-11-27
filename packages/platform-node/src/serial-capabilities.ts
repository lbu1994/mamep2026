/**
 * Node Serial Adapter 能力描述（docs/TECH_DESIGN.md §34.3.18）。
 * 只用于 UI 展示与配置校验，不得绕过真实打开结果：即使声明支持某参数，
 * 具体设备或驱动仍可能拒绝，连接流程必须处理实际失败。
 */
import { serialParameterSupport } from "@mamep2026/platform-api";
import type { FlowControl, Parity } from "@mamep2026/domain";

export interface NodeSerialCapabilities {
  readonly enumeration: boolean;
  readonly dataBits: readonly number[];
  readonly stopBits: readonly number[];
  readonly parity: readonly Parity[];
  readonly flowControl: readonly FlowControl[];
  readonly unplugDetection: boolean;
  readonly usbMetadata: boolean;
  readonly customBaudRates: boolean;
  readonly platform: string;
  readonly host: "node";
  readonly library: string;
  readonly libraryVersion: string;
}

export interface DescribeNodeSerialCapabilitiesOptions {
  readonly platform?: string | undefined;
  readonly library?: string | undefined;
  readonly libraryVersion?: string | undefined;
}

/**
 * 描述 Node Serial Adapter 能力。platform/library/libraryVersion 由调用方注入
 * （生产接线时传入 process.platform 与库版本）；默认值用于纯测试。
 */
export function describeNodeSerialCapabilities(
  options: DescribeNodeSerialCapabilitiesOptions = {},
): NodeSerialCapabilities {
  return {
    enumeration: true,
    dataBits: serialParameterSupport.vscode.dataBits,
    stopBits: serialParameterSupport.vscode.stopBits,
    parity: serialParameterSupport.vscode.parity,
    flowControl: serialParameterSupport.vscode.flowControl,
    unplugDetection: true,
    usbMetadata: true,
    customBaudRates: true,
    platform: options.platform ?? "unknown",
    host: "node",
    library: options.library ?? "serialport",
    libraryVersion: options.libraryVersion ?? "unknown",
  };
}
