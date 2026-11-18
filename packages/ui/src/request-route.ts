import type { RegisterSheet, RequestRoute } from "@mamep2026/domain";
import type { CommunicationHost, HostIdentity, PluginHost } from "./host";
import {
  protocolForSheetType,
  type TableTypeContribution,
} from "./plugin/plugin-registries";

type RequestRouteHost = HostIdentity &
  PluginHost &
  Pick<CommunicationHost, "getCommProperties">;

/**
 * 表类型对应的请求协议。
 *
 * 核心保持寄存器同时支持内置 RTU/TCP，必须使用当前连接的传输协议；
 * 其他表类型由各自 codec 决定协议，不支持时沿用能力门控回退。
 */
function requestProtocolForSheetType(
  host: RequestRouteHost,
  sheetType: string,
): string {
  const tableTypes =
    host.pluginRegistry?.getContributions<TableTypeContribution>("tableType") ??
    [];
  if (sheetType === "holding-register") {
    return host.getCommProperties().protocol;
  }
  return protocolForSheetType(
    sheetType,
    tableTypes,
    host.capabilities?.protocolExtensions ?? [],
  );
}

/** 从表自身配置解析设备请求路由；地址使用表配置，协议使用当前连接快照。 */
export function requestRouteForSheet(
  host: RequestRouteHost,
  sheet: Pick<RegisterSheet, "type" | "slaveAddress">,
): RequestRoute {
  return {
    unitAddress: sheet.slaveAddress,
    protocol: requestProtocolForSheetType(host, sheet.type),
  };
}

/** 为批量构建轮询目标提供表类型 → 协议解析器。 */
export function requestProtocolResolver(
  host: RequestRouteHost,
): (sheetType: string) => string {
  return (sheetType) => requestProtocolForSheetType(host, sheetType);
}
