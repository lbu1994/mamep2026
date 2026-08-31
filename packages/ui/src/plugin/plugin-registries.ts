/**
 * command / dataType 贡献点消费方（docs/插件功能设计.md §3.2，ADR-039）。
 * Phase A：聚合贡献为只读注册表（查询用）；handler / 解析接入随 Phase E/F 扩展。
 */
import type { Contribution } from "@mamep2026/plugin-api";

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

/** 命令分发注册表（ADR-039）：把插件 command 贡献聚合为 id → 元数据映射。 */
export function buildCommandRegistry(
  contributions: readonly Contribution<CommandContribution>[],
): Map<string, CommandContribution> {
  const registry = new Map<string, CommandContribution>();
  for (const contribution of contributions) {
    registry.set(contribution.payload.id, contribution.payload);
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
