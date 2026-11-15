/**
 * 内置贡献点 v1（docs/architecture/ports/plugin-api/插件契约.md §3）。
 * 贡献点 schema 是公开契约，定义于 plugin-api（不依赖 UI）；消费方由 UI 层实现。
 * 全部 10 个 ID 注册 schema；其中 panels / theme / toolbarAction / settings /
 * command / dataType 实现真实消费方，tableType / protocolExtension / addressTransform /
 * documentation 的消费方由对应 UI / 宿主模块提供。
 * 说明：payload 为声明式数据（可 JSON 序列化，与 manifest 一致）；交互代码（组件/handler）
 * 在随插件 runtime 提供。
 */
import { z } from "zod";
import type { ContributionPointId } from "./contributions";

/** 插件自带翻译的显示名（方案 A）：`en-US` 必填 / `zh-CN` 可选。
 * 缺失语言由消费方回退英文，再回退应用 i18n 的 `titleKey`（消费方解析见 ui 的 plugin-title）。 */
const LOCALIZED_TITLE_SCHEMA = z.object({
  "en-US": z.string().min(1),
  "zh-CN": z.string().min(1).optional(),
});

/** panels：面板贡献（消费方 = 底部面板渲染，payload 为声明式描述）。
 * 可选 `title` 为插件自带翻译；缺失则回退 `titleKey`。
 * 当前消费方渲染标题 + 占位内容，交互组件由插件 runtime 提供。 */
export const PANELS_CONTRIBUTION_SCHEMA = z.array(
  z.object({
    id: z.string().min(1),
    titleKey: z.string().min(1),
    title: LOCALIZED_TITLE_SCHEMA.optional(),
  }),
);

/** toolbarAction 单动作 schema（数组元素增 confirmKey）。 */
const TOOLBAR_ACTION_ITEM_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
  icon: z.string().optional(),
  scope: z.literal("table-toolbar").default("table-toolbar"),
  targetTableType: z.string().optional(),
  requiresConfirm: z.boolean().default(false),
  /** 安全确认文案 i18n key（插件外部化）：requiresConfirm 时 UI 经此键弹确认框；缺省用插件名。 */
  confirmKey: z.string().optional(),
});

/** toolbarAction：表格工具栏按钮（数组，一插件可贡献多个动作）。 */
export const TOOLBAR_ACTION_CONTRIBUTION_SCHEMA = z.array(
  TOOLBAR_ACTION_ITEM_SCHEMA,
);

/** tableType：寄存器表类型（payload 为声明式描述）。 */
export const TABLE_TYPE_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  protocolId: z.string().min(1),
  titleKey: z.string().min(1),
  columns: z.array(z.string()).optional(),
  rowActions: z.array(z.string()).optional(),
});

/** protocolExtension：协议扩展（payload 为声明式描述）。 */
export const PROTOCOL_EXTENSION_CONTRIBUTION_SCHEMA = z.object({
  protocolId: z.string().min(1),
  titleKey: z.string().min(1),
});

/** addressTransform：表级地址变换（payload 为声明式描述，apply/validate 由 activate 注册进 AddressTransformRegistry）。 */
export const ADDRESS_TRANSFORM_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  protocol: z.string().min(1),
  titleKey: z.string().optional(),
  /** 默认启用状态（表级配置缺省时采用；核心内置默认 OFF）。 */
  defaultConfig: z.object({ enabled: z.boolean() }).optional(),
});

/** theme 色板预设：单条可选主题色（支持一个或多个；
 *  方案 A：插件可经 title 字段自带翻译，缺失语言由消费方回退英文；
 * 只要求提供**单一明亮模式主色**，暗色/hover/active 由 antd 色彩算法自动派生）。 */
export const THEME_COLOR_PRESET_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
  /** 插件自带标题翻译（en-US 必填 / zh-CN 可选）；缺失语言时消费方回退英文。 */
  title: LOCALIZED_TITLE_SCHEMA.optional(),
  /** 单一明亮模式主色（种子）。链接色默认跟随主色；暗色主色/hover/active 由 antd 算法自动派生。 */
  colorPrimary: z.string().min(1),
});

/** theme：主题色贡献（注册一个或多个可选主题色，Settings 选择器消费；不再自动应用）。 */
export const THEME_CONTRIBUTION_SCHEMA = z.object({
  colors: z.array(THEME_COLOR_PRESET_SCHEMA).optional(),
});

/** settings：Settings 弹窗分区（消费方渲染分区标题，交互组件由插件 runtime 提供）。 */
export const SETTINGS_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

/** dataType：数据类型注册（消费方查询类型注册表，解析由插件 resolver 提供）。 */
export const DATA_TYPE_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

/** command 单命令 schema（数组元素）。 */
const COMMAND_ITEM_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
});

/** command：命令分发（数组，一插件可贡献多个命令）。 */
export const COMMAND_CONTRIBUTION_SCHEMA = z.array(COMMAND_ITEM_SCHEMA);

/** documentation：文档/帮助面板。payload 为纯字符串（可 JSON 序列化）。 */
export const DOCUMENTATION_CONTRIBUTION_SCHEMA = z.object({
  id: z.string().min(1),
  titleKey: z.string().min(1),
  /** Markdown 子集内容（标题/段落/列表/代码块；UI 轻量渲染，不引重库）。 */
  markdown: z.string(),
});

export interface BuiltinContributionPoint {
  id: ContributionPointId;
  schema: z.ZodType<unknown>;
}

export const BUILTIN_CONTRIBUTION_POINTS: readonly BuiltinContributionPoint[] =
  [
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
