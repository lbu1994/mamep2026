# example-theme 插件：如何通过插件添加主题色

本插件是「通过插件注册可选主题色」的**最小示例**。它向 `theme` 贡献点注册一个可选主题色
「靛蓝」（Indigo），用户在 **Settings → 主题色** 下拉框中选用后，软件主色/链接色随之切换。

- 包名：`@mamep2026/example-theme`
- 插件 ID：`example-theme`
- 贡献点：`theme`（唯一）
- 性质：纯清单、**无 runtime**、`source:"installed"`
- 安装方式：**不随包一次性安装**，需在 Plugin Manager 手动安装（见下文）

---

## 〇、给谁看 / 前置说明

> **本文件面向「已经在这个 Mamep2026 仓库里开发」的人。** 运行/交付插件时，**真正被安装的只有 `manifest.json`**；`src/` 下的文件是给「开发、类型检查、单测」用的，主软件在运行时**不会**读取它们。

- 若你只是想**给使用本软件的人一个主题色插件**：直接把 `manifest.json` 交给对方，让对方在 Plugin Manager 里安装即可。
- 若你想**在这个仓库里维护/验证该插件**（参与 `pnpm test` / `pnpm typecheck` / `pnpm lint`）：才需要 `src/`、`package.json`、`tsconfig.json`。
- 若你想**从零理解插件体系**（不依赖本仓库细节、纯概念）：看 [docs/插件开发入门指南.md](../../docs/插件开发入门指南.md)。

## 文件用途一览

| 文件 | 运行时 | 用途 |
|---|---|---|
| `manifest.json` | ✅ 唯一需要 | 插件「名片」：安装时被读取、校验、注册。交付所用。 |
| `src/plugin.ts` | ❌ | 用 TS 写带类型的 manifest（`exampleThemeManifest`）+ `registerExampleThemePlugin`（供单测）；`tsc` 能查错。 |
| `src/index.ts` | ❌ | 包出口（`exports` 指向），`export * from "./plugin"`。 |
| `src/plugin.test.ts` | ❌ | 单元测试：模拟注册表验证 manifest 合法、可注册。 |
| `package.json` | ❌ | 声明为 pnpm workspace 包（`@mamep2026/example-theme`），提供 `typecheck/test/lint` 脚本。 |
| `tsconfig.json` | ❌ | 让本包可被独立 `tsc` 类型检查。 |
| `README.md` | ❌ | 使用/开发说明。 |

## 纯数据 vs 可执行插件

- **纯数据插件（本例子，主题色）**：整个插件 = 一份 `manifest.json`（或带类型的 TS 导出）。无 `entry`、无 runtime、不执行任何代码。
- **可执行插件**（如 `yaskawa-memobus-67h-010dh-010eh`、`custom-function-code`）：除 manifest 外还有可在隔离线程执行的 `entry`（Web Worker / `worker_threads`）；随包受信插件（同进程 runtime）还可贡献 `codec`/`dataType`/`addressTransform` 等同步纯函数，第三方隔离插件（仅 `remoteRuntime`）则不可贡献这些同步面（ADR-044）。本插件**不需要**任何这些。

## 最小可交付清单

只发 `manifest.json` 即可运行——它不依赖 `src/` 里的任何东西，`src/` 全部可有可无，仅作开发质检。「完整插件」在纯数据场景下 = 一份合法的 manifest。

---

## 一、适用场景 / 范围

### 适用场景

- 你希望为用户提供「配色方案」级别的**少量、受控**的主题主色选择，而不是任意取色器。
- 你的厂商私有规则（品牌主色、设备厂商主题色）不应硬编码进核心代码——适合放进插件。
- 你希望插件只**声明数据**（颜色），不执行任何代码（纯数据、无执行面，安全边界友好）。

### 范围边界（哪些事本插件**不做**）

- **不自动应用**：插件只把颜色注册为**可选预设**，用户不主动选就不会生效（ADR-047）。
- **不做任意取色**：只提供预设色，不提供取色器（已从核心移除，ADR-047）。
- **不提供运行时 / 不执行脚本**：本示例无 `runtime`、无 `entry`，仅声明式贡献。
- **不做对比度校验**：插件色按注册值直接应用，无运行时 AA 白字守卫（D6 移除）。
- **不做颜色残留缓存**：插件被禁用/卸载后，已持久化选中的该色回退默认蓝（ADR-047 已知限制）。
- **不修改核心 / 不使用 `any`**：只经 `theme` 贡献点提交声明式数据。

### 支持的多语言

主题色显示名由**插件自带** `title` 字段提供（方案 A，2026-09-03）：
`title["en-US"]` 必填；`title["zh-CN"]` 可选。缺失的语言由消费方**回退英文**
（`title["en-US"]`），再回退应用 i18n 的 `titleKey`。

---

## 二、编写步骤

### 步骤 1：新建插件包

在仓库 `plugins/` 下新建目录 `example-theme/`，包含：

```
plugins/example-theme/
├── package.json
├── tsconfig.json
├── manifest.json      # 可手动安装的清单工件
├── README.md          # 本文件
└── src/
    ├── plugin.ts      # 导出 manifest + 注册函数（供测试/文档示例）
    ├── index.ts
    └── plugin.test.ts
```

`package.json` 关键字段（`@mamep2026/example-theme`）：

- `"type": "module"`
- `"exports": { ".": "./src/index.ts" }`
- 依赖 `@mamep2026/plugin-api: workspace:*`；devDeps `@mamep2026/test-kit`、
  `@mamep2026/typescript-config`、`typescript: catalog:`、`vitest: catalog:`。

### 步骤 2：编写 manifest（提交 theme 贡献）

在 `src/plugin.ts` 定义 `exampleThemeManifest`：

```ts
import type { PluginManifest, PluginRegistry } from "@mamep2026/plugin-api";

export const EXAMPLE_THEME_PLUGIN_ID = "example-theme";

export const exampleThemeManifest: PluginManifest = {
  id: EXAMPLE_THEME_PLUGIN_ID,
  name: "Example Theme",
  version: "1.0.0",
  apiVersion: "1.0",
  description: "An example plugin that demonstrates contributing an optional theme color preset.",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["theme"],
  contributes: {
    theme: {
      colors: [
        {
          id: "indigo",
          titleKey: "plugins.exampleThemeColor", // 作为回退标识（应用 i18n）
          title: { "en-US": "Indigo", "zh-CN": "靛蓝" }, // 插件自带翻译（方案 A）
          colorPrimary: "#4f46e5", // 仅需单一明亮主色；暗色/链接色由 antd 算法派生
        },
      ],
    },
  },
};
```

> 提醒：`platform.web` 必须为 `true`（Plugin Manager 安装时会做平台预检）；`permissions`
> 需含 `"theme"`。

### 步骤 3：导出注册函数（供测试/示例）

```ts
export function registerExampleThemePlugin(registry: PluginRegistry) {
  return registry.register(exampleThemeManifest, { source: "installed" });
}
```

### 步骤 4：生成可手动安装的清单工件

复制上述 manifest 为纯 JSON，存为 `manifest.json`（即**插件包根目录**的 `manifest.json`，见上文「文件用途一览」）。

### 步骤 5：编写单元测试

`src/plugin.test.ts` 校验：注册成功（`installed`、无 runtime）、`theme` 贡献经
`THEME_CONTRIBUTION_SCHEMA` 解析、`title` 多语言值、`permissions` 为 `["theme"]`。

### 步骤 6：手动安装（本示例不随包，需手动装）

1. 启动 `pnpm dev`，打开网页端。
2. 打开 **Plugin Manager**。
3. 点击 **Install Plugin** → 选择本包 `manifest.json`。
4. 在安全确认弹窗中确认（来源/版本/权限/平台）。
5. 打开 **Settings → 主题色**，下拉框中出现「Indigo / 靛蓝」选项。
6. 选用后主色/链接色切换为靛蓝；刷新后仍持久化；禁用/卸载插件后回退默认蓝。

---

## 三、API 说明

### 贡献点 ID

`theme` — 插件经 `manifest.contributes.theme` 提交可选主题色。

### 贡献点 payload

```ts
theme: {
  colors: Array<{
    id: string;                       // 色板内唯一（同一插件内不重复）
    titleKey: string;                 // 显示名 i18n 键（应用回退用）
    title?: {
      "en-US": string;                // 英文显示名（必填）
      "zh-CN"?: string;               // 简体中文（选填；缺失回退英文）
    };
    colorPrimary: string;  // 单一明亮模式主色（种子）；链接色默认跟随主色，暗色/hover/active 由 antd 算法派生
  }>;
}
```

### 校验（Zod）

- `THEME_COLOR_PRESET_SCHEMA`：单条预设（`packages/plugin-api/src/builtin-contribution-points.ts`）。
- `THEME_CONTRIBUTION_SCHEMA`：`theme` 贡献整体（`{ colors?: THEME_COLOR_PRESET_SCHEMA[] }`）。

### 本体侧装配链（消费方）

```
base = themeConfig ?? buildTheme(dark)   // themeConfig：VSCode 完整主题（ADR-027）
用户所选预设（workspace.preferences.themePrimary，持久化）
  → mergeThemeConfig(base, { token: { colorPrimary, colorLink: colorPrimary } })
  → 暗色下 CSS 变量（--mamep-brand-primary / --mamep-focus-ring）取 deriveAppliedPrimary(seed, dark)
    （getDesignToken 只读计算派生后的真实主色，不喂回 ConfigProvider 避免二次派生）
无选择 / 预设失效（插件禁用·卸载）→ base（默认蓝）
```

- 预设 ID 格式：`` `${pluginId}:${colorId}` ``（本例 `example-theme:indigo`）。
- `workspace.preferences.themePrimary`：`null` = 内置默认蓝；插件色 = 完整预设 ID。

### 显示名解析顺序（方案 A）

`title[当前语言] → title["en-US"] → t(titleKey) → titleKey`

### 关键函数

| 函数 | 位置 | 作用 |
|---|---|---|
| `buildThemeColorOptions(contributions)` | `packages/ui/src/plugin/theme-contributions.ts` | 汇总各启用插件注册色为选项（含完整预设 ID） |
| `findThemeColorOption(contributions, id)` | 同上 | 按预设 ID 查找；找不到（禁用/卸载）返回 `null` |
| `themeConfigForColorOption(option)` | 同上 | 预设 → antd token 覆盖（`colorPrimary` + `colorLink: colorPrimary`） |
| `deriveAppliedPrimary(seed, dark)` | 同上 | 只读计算当前模式派生后的真实主色（供 CSS 变量） |
| `themeColorTitle(option, locale, t)` | 同上 | 解析显示名（插件 title → 英文 → titleKey） |

### 权限

- 插件需在 `permissions` 中声明 `"theme"`（`packages/plugin-api/src/permissions.ts` 权限枚举）。
