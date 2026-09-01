/**
 * command / dataType 贡献点消费方（docs/插件功能设计.md §3.2，ADR-039）。
 * Phase A：聚合贡献为只读注册表（查询用）；handler / 解析接入随 Phase E/F 扩展。
 */
import type { Contribution } from "@mamep2026/plugin-api";
import {
  basicTablesProtocolId,
  isBasicSheetType,
} from "@mamep2026/domain";

/** command 贡献 payload（Phase A 声明式；handler 随 Phase F 插件 runtime 提供）。 */
export interface CommandContribution {
  id: string;
  titleKey: string;
}

/** dataType 贡献 payload（Phase A 声明式；parse/format 接入属 Phase E）。 */
export interface DataTypeContribution {
  id: string;
  titleKey: string;
}

/** settings 贡献 payload（Phase A 声明式标题；组件随 Phase F 插件 runtime 提供）。 */
export interface SettingsContribution {
  id: string;
  titleKey: string;
}

/** toolbarAction 贡献 payload（Phase A 声明式；handler 随 Phase F 插件 runtime 提供）。 */
export interface ToolbarActionContribution {
  id: string;
  titleKey: string;
  icon?: string;
  scope?: "table-toolbar";
  targetTableType?: string;
  requiresConfirm?: boolean;
}

/** tableType 贡献 payload（ADR-041 Phase C：声明式；createDefaultRow 等交互随插件 runtime）。 */
export interface TableTypeContribution {
  id: string;
  protocolId: string;
  titleKey: string;
  columns?: string[];
  rowActions?: string[];
}

/** protocolExtension 贡献 payload（ADR-041 Phase C：声明式；codec 经插件 activate 注册进会话）。 */
export interface ProtocolExtensionContribution {
  protocolId: string;
  titleKey: string;
}

/** addressTransform 贡献 payload（ADR-042 插件 Phase D：声明式；apply/validate 经 activate 注册）。 */
export interface AddressTransformContribution {
  id: string;
  protocol: string;
  titleKey?: string;
  defaultConfig?: { enabled: boolean };
}

/**
 * 表类型 → 会话协议（ADR-041 决策 A / ADR-043 E-2）：
 * - 核心 "holding-register" → "rtu"；
 * - 核心基础表 "coil"/"discrete-input"/"input-register" → 基础表 codec 协议 ID
 *   （"modbus-basic-tables:<tableType>"，RTU 承载，ADR-043）；
 * - 插件表类型 "<pluginId>:<tableTypeId>" → 查 tableType 贡献的 protocolId；
 * - 目标协议不在平台能力矩阵 protocolExtensions 内 → 回退 "rtu"（能力门控）。
 */
export function protocolForSheetType(
  sheetType: string,
  tableTypes: readonly Contribution<TableTypeContribution>[],
  supportedProtocols: readonly string[],
): string {
  if (sheetType === "holding-register") return "rtu";
  if (isBasicSheetType(sheetType)) {
    const protocol = basicTablesProtocolId(sheetType);
    return supportedProtocols.includes(protocol) ? protocol : "rtu";
  }
  for (const contribution of tableTypes) {
    if (
      contribution.payload.id.length > 0 &&
      sheetType === `${contribution.pluginId}:${contribution.payload.id}`
    ) {
      const protocol = contribution.payload.protocolId;
      return supportedProtocols.includes(protocol) ? protocol : "rtu";
    }
  }
  return "rtu";
}

/** 命令分发注册表（ADR-039/041）：把插件 command 贡献（数组）聚合为 id → 元数据映射。 */
export function buildCommandRegistry(
  contributions: readonly Contribution<CommandContribution[]>[],
): Map<string, CommandContribution> {
  const registry = new Map<string, CommandContribution>();
  for (const contribution of contributions) {
    for (const payload of contribution.payload) {
      registry.set(payload.id, payload);
    }
  }
  return registry;
}

/** 数据类型注册表（ADR-039）：把插件 dataType 贡献聚合为 id → 元数据映射。 */
export function buildDataTypeRegistry(
  contributions: readonly Contribution<DataTypeContribution>[],
): Map<string, DataTypeContribution> {
  const registry = new Map<string, DataTypeContribution>();
  for (const contribution of contributions) {
    registry.set(contribution.payload.id, contribution.payload);
  }
  return registry;
}
