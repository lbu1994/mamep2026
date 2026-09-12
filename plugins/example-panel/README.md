# example-panel 插件：如何通过插件贡献一个面板

本插件是「通过插件注册**声明式面板**」的**最小示例**。它向 `panels` 贡献点注册一个面板，
安装后应用**底部面板**会出现 **「Plugins」页签**，页签内显示该面板的标题与占位内容。

- 包名：`@mamep2026/example-panel`
- 插件 ID：`example-panel`
- 贡献点：`panels`（唯一）
- 性质：纯清单、**无 runtime**、`source:"installed"`
- 安装方式：**手动安装**（Settings → Plugins → Install Plugin，选择本包 `manifest.json`）

---

## 〇、给谁看 / 前置说明

> **本文件面向「已经在这个 Mamep2026 仓库里开发」的人。** 运行/交付插件时，**真正被安装的只有 `manifest.json`**；`src/` 下的文件是给「开发、类型检查、单测」用的，主软件在运行时**不会**读取它们。

- 若你只是想**给使用本软件的人一个面板插件**：直接把 `manifest.json` 交给对方安装即可。
- 若你想**在这个仓库里维护/验证该插件**（参与 `pnpm test` / `pnpm typecheck` / `pnpm lint`）：才需要 `src/`、`package.json`、`tsconfig.json`。
- 若你想**从零理解插件体系**（不依赖本仓库细节、纯概念）：看 [docs/插件开发入门指南.md](../../docs/插件开发入门指南.md)。

## 文件用途一览

| 文件                 | 运行时      | 用途                                                                                        |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `manifest.json`      | ✅ 唯一需要 | 插件「名片」：安装时被读取、校验、注册。交付所用。                                          |
| `src/plugin.ts`      | ❌          | 用 TS 写带类型的 manifest（`examplePanelManifest`）+ `registerExamplePanelPlugin`（供单测） |
| `src/index.ts`       | ❌          | 包出口（`exports` 指向），`export * from "./plugin"`                                        |
| `src/plugin.test.ts` | ❌          | 单元测试：模拟注册表验证 manifest 合法、可注册                                              |
| `package.json`       | ❌          | 声明为 pnpm workspace 包（`@mamep2026/example-panel`），提供 `typecheck/test/lint` 脚本     |
| `tsconfig.json`      | ❌          | 让本包可被独立 `tsc` 类型检查                                                               |
| `README.md`          | ❌          | 使用/开发说明                                                                               |

## 纯数据 vs 可执行插件

- **纯数据插件（本例子）**：整个插件 = 一份 `manifest.json`。无 `entry`、无 runtime、不执行任何代码。
- **可执行插件**（如 `yaskawa-memobus-67h-010dh-010eh`、`custom-function-code`、`address-adjust`）：
  除 manifest 外还有单文件 JS entry（`export const manifest` + `export function activate(ctx)`），
  用于贡献 `codec` / `dataType` / `addressTransform` 等**同步纯函数**；安装时须由用户显式授权
  **同进程执行**（ADR-054）。本插件**不需要**这些。

---

## 一、适用场景 / 范围

### 适用场景

- 你想给软件增加一块**只读信息面板**（例如设备铭牌、厂商提示、调试速查表）。
- 你的厂商私有内容不应硬编码进核心代码——适合放进插件。
- 你希望插件只**声明数据**、不执行任何代码（安全边界友好）。

### 范围边界（哪些事本插件**不做**）

- **不执行代码**：无 `entry`、无 runtime，纯声明式贡献。
- **不渲染自定义组件**：面板内容目前是**占位**（「插件面板内容将由插件运行时提供」）——
  插件提供交互式 React 组件的机制属 Phase F，尚未开放。
- **不改核心 / 不用 `any`**：只经 `panels` 贡献点提交声明式数据。
- **不随包分发**：插件一律由用户手动安装（ADR-054），本包只是仓库内的示例源码。

### 支持的多语言

面板标题显示名由**插件自带** `title` 字段提供（方案 A）：`title["en-US"]` 必填；
`title["zh-CN"]` 可选。缺失的语言由消费方**回退英文**，再回退应用 i18n 的 `titleKey`
（本例为 `plugins.examplePanelTitle`）。

---

## 二、编写步骤

### 步骤 1：新建插件包

在仓库 `plugins/` 下新建目录（本插件即 `plugins/example-panel/`）：

```
plugins/example-panel/
├── package.json
├── tsconfig.json
├── manifest.json      # 可手动安装的清单工件
├── README.md          # 本文件
└── src/
    ├── plugin.ts      # 导出 manifest + 注册函数（供测试/文档示例）
    ├── index.ts
    └── plugin.test.ts
```

`package.json` 关键字段（`@mamep2026/example-panel`）：

- `"type": "module"`
- `"exports": { ".": "./src/index.ts" }`
- 依赖 `@mamep2026/plugin-api: workspace:*`；devDeps `@mamep2026/test-kit`、
  `@mamep2026/typescript-config`、`typescript: catalog:`、`vitest: catalog:`。

### 步骤 2：编写 manifest（提交 panels 贡献）

```json
{
  "id": "example-panel",
  "name": "Example Panel",
  "version": "1.0.0",
  "apiVersion": "2.0",
  "description": "An example plugin that demonstrates contributing a declarative panel via the panels contribution point.",
  "author": "Mamep2026 Team",
  "platform": { "web": true, "node": false },
  "requiredCapabilities": [],
  "permissions": ["ui-contribution"],
  "contributes": {
    "panels": [
      {
        "id": "overview",
        "titleKey": "plugins.examplePanelTitle",
        "title": { "en-US": "Example Panel", "zh-CN": "示例面板" }
      }
    ]
  }
}
```

> `title` 为**可选**字段：不写则回退应用 i18n 的 `titleKey`（第三方插件通常不写不通用的
> 应用 i18n 键，故推荐自带 `title`）。

### 步骤 3：安装并验证

1. `pnpm dev` 启动网页端（http://localhost:5173）。
2. 打开 **Settings → Plugins** 页签。
3. 点 **Install Plugin** → 选择本包 `manifest.json`（或 `pnpm build:plugins` 产物
   `release/plugins/example-panel/manifest.json`）。
4. 在安全确认弹窗中确认（来源/版本/权限/平台）。
5. 关闭 Settings：**底部面板**出现 **「Plugins」页签**，内容为标题「Example Panel / 示例面板」+ 占位说明。
6. 在 Settings → Plugins 里禁用或卸载插件：底部面板的「Plugins」页签**随之消失**（贡献回收）。

---

## 三、API 说明

### 贡献点 ID

`panels` — 插件经 `manifest.contributes.panels` 提交一个或多个面板。

### 贡献点 payload

```ts
panels: Array<{
  id: string; // 面板唯一标识（同一插件内不重复；DOM key = `${pluginId}-${id}`）
  titleKey: string; // 标题 i18n 键（应用回退用）
  title?: {
    "en-US": string; // 英文标题（必填）
    "zh-CN"?: string; // 简体中文（选填；缺失回退英文）
  };
}>;
```

### 校验（Zod）

- `PANELS_CONTRIBUTION_SCHEMA`：`packages/plugin-api/src/builtin-contribution-points.ts`（数组形态）。
- `title` 与 `theme` 贡献点共用同一 `LOCALIZED_TITLE_SCHEMA`（`en-US` 必填、非空串）。

### 本体侧消费方（渲染）

| 位置                                                  | 作用                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/ui/src/components/BottomPanel.tsx`          | 有 `panels` 贡献时才渲染底部面板的「Plugins」页签（`panel.plugins`）            |
| `packages/ui/src/components/plugin-contributions.tsx` | `PluginPanels`：逐条渲染 `Divider`（标题）+ `Empty`（占位）                     |
| `packages/ui/src/plugin/plugin-title.ts`              | `pluginLocalizedTitle()`：标题解析（当前语言 → 英文 → `titleKey`）              |
| `packages/ui/src/plugin/use-contributions.ts`         | `usePluginContributions(host, "panels")`：响应式读取贡献（安装/启停自动重渲染） |

### 权限

- 插件需在 `permissions` 中声明 `"ui-contribution"`（`packages/plugin-api/src/permissions.ts` 权限枚举）。

---

## 四、测试

- 单测：`pnpm --filter @mamep2026/example-panel test`（校验注册成功、installed 来源、无 runtime、panels payload 合法）。
- e2e（浏览器，需先构建插件产物）：`pnpm build:plugins` 后
  `pnpm --filter @mamep2026/e2e-web test tests/plugin-panel.spec.ts`（安装 → 底栏 Plugins 页签 → 标题 → 卸载后页签消失）。
- 类型检查 / 代码检查：`pnpm --filter @mamep2026/example-panel typecheck`、`pnpm lint`。
