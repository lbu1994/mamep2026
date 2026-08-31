/**
 * 内置贡献点 v1（docs/插件功能设计.md §3.2，ADR-039）。
 * 贡献点 schema 是公开契约，定义于 plugin-api（不依赖 UI）；消费方由 UI 层实现。
 * Phase A：全部 10 个 ID 注册 schema；其中 panels / theme / toolbarAction / settings /
 * command / dataType 实现真实消费方，tableType / protocolExtension / addressTransform /
 * documentation 暂为空消费方（B~E 阶段接线）。
 * 说明：payload 为声明式数据（可 JSON 序列化，与 manifest 一致）；交互代码（组件/handler）
 * 在 Phase F 随插件 runtime 提供。
 */
import { z } from "zod";
import type { ContributionPointId } from "./contributions";

/** panels：面板贡献（Phase A 消费方 = 底部面板渲染，payload 为声明式描述）。 */
export const PANELS_CONTRIBUTION_SCHEMA = z.array(
  z.object({
    id: z.string().min(1),
    titleKey: z.string().min(1),
  }),
);

/** toolbarAction：表格工具栏按钮（Phase A 无 handler → 按钮 disabled + tooltip 提示）。 */
export const TOOLBAR_ACTION_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
  icon: z.string().optional(),
  scope: z.literal("table-toolbar").default("table-toolbar"),
  targetTableType: z.string().optional(),
  requiresConfirm: z.boolean().default(false),
});

/** tableType：新寄存器表类型（Phase C 接线；payload 为声明式描述）。 */
export const TABLE_TYPE_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  protocolId: z.string().min(1),
  titleKey: z.string().min(1),
  columns: z.array(z.string()).optional(),
  rowActions: z.array(z.string()).optional(),
});

/** protocolExtension：协议扩展（Phase B 接线；payload 为声明式描述）。 */
export const PROTOCOL_EXTENSION_CONTRIBUTION_SCHEMA = z.object({
  protocolId: z.string().min(1),
  titleKey: z.string().min(1),
});

/** addressTransform：表级地址变换（Phase D 接线；payload 为声明式描述）。 */
export const ADDRESS_TRANSFORM_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  protocol: z.string().min(1),
  titleKey: z.string().optional(),
});

/** theme：主题色贡献（Phase A 消费方 = 主题装配链，纯数据可全功能）。 */
export const THEME_CONTRIBUTION_SCHEMA = z.object({
  colorPrimary: z
    .object({ light: z.string(), dark: z.string() })
    .optional(),
  colorLink: z.object({ light: z.string(), dark: z.string() }).optional(),
});

/** settings：Settings 弹窗分区（Phase A 消费方 = 分区标题渲染，组件 Phase F）。 */
export const SETTINGS_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

/** dataType：数据类型注册（Phase A 消费方 = 类型注册表仅查询，解析接入 Phase E）。 */
export const DATA_TYPE_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

/** command：命令分发（Phase A 消费方 = 分发注册表，handler Phase F）。 */
export const COMMAND_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

/** documentation：文档/帮助面板（Phase E 接线）。 */
export const DOCUMENTATION_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

export interface BuiltinContributionPoint {
  id: ContributionPointId;
  schema: z.ZodType<unknown>;
}

export const BUILTIN_CONTRIBUTION_POINTS: readonly BuiltinContributionPoint[] = [
  { id: "panels", schema: PANELS_CONTRIBUTION_SCHEMA },
  { id: "toolbarAction", schema: TOOLBAR_ACTION_CONTRIBUTION_SCHEMA },
  { id: "tableType", schema: TABLE_TYPE_CONTRIBUTION_SCHEMA },
  { id: "protocolExtension", schema: PROTOCOL_EXTENSION_CONTRIBUTION_SCHEMA },
  { id: "addressTransform", schema: ADDRESS_TRANSFORM_CONTRIBUTION_SCHEMA },
  { id: "theme", schema: THEME_CONTRIBUTION_SCHEMA },
  { id: "settings", schema: SETTINGS_CONTRIBUTION_SCHEMA },
  { id: "dataType", schema: DATA_TYPE_CONTRIBUTION_SCHEMA },
  { id: "command", schema: COMMAND_CONTRIBUTION_SCHEMA },
  { id: "documentation", schema: DOCUMENTATION_CONTRIBUTION_SCHEMA },
];

export const BUILTIN_CONTRIBUTION_POINT_IDS: readonly ContributionPointId[] =
  BUILTIN_CONTRIBUTION_POINTS.map((p) => p.id);
