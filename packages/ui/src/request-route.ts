import type { RegisterSheet, RequestRoute } from "@mamep2026/domain";
import type { HostIdentity, PluginHost } from "./host";
import {
  protocolForSheetType,
  type TableTypeContribution,
} from "./plugin/plugin-registries";

/** 从表自身配置解析设备请求路由；不得使用当前活动表或稍后可变的会话字段。 */
export function requestRouteForSheet(
  host: HostIdentity & PluginHost,
  sheet: Pick<RegisterSheet, "type" | "slaveAddress">,
): RequestRoute {
  const tableTypes =
    host.pluginRegistry?.getContributions<TableTypeContribution>("tableType") ??
    [];
  return {
    unitAddress: sheet.slaveAddress,
    protocol: protocolForSheetType(
      sheet.type,
      tableTypes,
      host.capabilities?.protocolExtensions ?? [],
    ),
  };
}

/** 为批量构建轮询目标提供表类型 → 协议解析器。 */
export function requestProtocolResolver(
  host: HostIdentity & PluginHost,
): (sheetType: string) => string {
  const tableTypes =
    host.pluginRegistry?.getContributions<TableTypeContribution>("tableType") ??
    [];
  return (sheetType) =>
    protocolForSheetType(
      sheetType,
      tableTypes,
      host.capabilities?.protocolExtensions ?? [],
    );
}
