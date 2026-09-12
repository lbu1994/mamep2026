# technopro-blue-theme 插件：善诚蓝主题色

本插件把**善诚品牌蓝（`#007F9F`）**注册为一个可选主题色预设，用户在 **Settings → 主题色** 下拉框中选择后，软件主色/链接色随之切换。

- 包名：`@mamep2026/technopro-blue-theme`
- 插件 ID：`technopro-blue-theme`
- 贡献点：`theme`（唯一）
- 性质：纯清单、**无 runtime**、`source:"installed"`
- 安装方式：**不随包一次性安装**，需在 Plugin Manager 手动安装 `manifest.json`（见下文）

---

## 〇、给谁看 / 前置说明

> **本文件面向「已经在这个 Mamep2026 仓库里开发」的人。** 运行/交付插件时，**真正被安装的只有 `manifest.json`**；`src/` 下的文件是给「开发、类型检查、单测」用的，主软件在运行时**不会**读取它们。

- 若你只是想**给使用本软件的人一个主题色插件**：直接把 `manifest.json` 交给对方，让对方在 **Settings → Plugins** 里安装即可。
- 若你想**在这个仓库里维护/验证该插件**（参与 `pnpm test` / `pnpm typecheck` / `pnpm lint`）：才需要 `src/`、`package.json`、`tsconfig.json`。
- 若你想**从零理解插件体系**：看 [docs/插件开发入门指南.md](../../docs/插件开发入门指南.md)。

## 文件用途一览

| 文件 | 运行时 | 用途 |
|---|---|---|
| `manifest.json` | ✅ 唯一需要 | 插件「名片」：安装时被读取、校验、注册。交付所用。 |
| `src/plugin.ts` | ❌ | 用 TS 写带类型的 manifest（`technoproBlueThemeManifest`）+ `registerTechnoproBlueThemePlugin`（供单测）；`tsc` 能查错。 |
| `src/index.ts` | ❌ | 包出口（`exports` 指向），`export * from "./plugin"`。 |
| `src/plugin.test.ts` | ❌ | 单元测试：模拟注册表验证 manifest 合法、可注册。 |
| `package.json` | ❌ | 声明为 pnpm workspace 包（`@mamep2026/technopro-blue-theme`），提供 `typecheck/test/lint` 脚本。 |
| `tsconfig.json` | ❌ | 让本包可被独立 `tsc` 类型检查。 |
| `README.md` | ❌ | 使用/开发说明。 |

## 纯数据插件（本插件即此类）

整个插件 = 一份 `manifest.json`（带类型的 TS 导出）。无 `entry`、无 runtime、不执行任何代码，仅经 `theme` 贡献点声明式提交颜色数据。

## 最小可交付清单

只发 `manifest.json` 即可运行——它不依赖 `src/` 里的任何东西。用户安装后，**Settings → 主题色** 下拉会出现「善诚蓝」选项（浅/深两态分别由 antd 色彩算法自动派生）。

---

## 一、适用场景 / 范围

### 适用场景

- 你想为用户提供「厂商品牌主色」级别的**少量、受控**主题主色选择。
- 厂商私有规则（品牌色）不应硬编码进核心代码——适合放进插件。

### 范围边界（本插件**不做**）

- **不自动应用**：只把颜色注册为**可选预设**，用户不主动选就不会生效（ADR-047）。
- **不做任意取色**：只提供预设色，不提供取色器（ADR-047）。
- **不提供运行时 / 不执行脚本**：无 `runtime`、无 `entry`，仅声明式贡献。
- **不做对比度校验**：插件色按注册值直接应用（D6 移除后无 AA 守卫）。
- **不做颜色残留缓存**：插件被禁用/卸载后，已持久化选中的该色回退默认蓝（ADR-047 已知限制）。
- **不修改核心 / 不使用 `any`**：只经 `theme` 贡献点提交声明式数据。

### 支持的多语言

主题色显示名由**插件自带** `title` 字段提供（方案 A，2026-09-03）：
`title["en-US"]` 必填；`title["zh-CN"]` 可选。缺失的语言由消费方**回退英文**
（`title["en-US"]`），再回退应用 i18n 的 `titleKey`。

---

## 二、使用/安装

1. 打开应用 → **Plugin Manager**（工具栏按钮）；
2. 点 **Install Plugin**，选择本包根目录的 `manifest.json`；
3. §6.10.4 安全确认弹窗 → 确认安装；
4. 关闭 Plugin Manager，打开 **Settings → 主题色**，选择「善诚蓝」，主色即切换为 `#007F9F`。

## 三、颜色说明

- `colorPrimary: "#007F9F"`（善诚品牌蓝，单一明亮模式种子）。
- 链接色默认跟随主色；暗色模式主色 / hover / active 由 antd 色彩算法自动派生（无需提供 `colorLink`，ADR-048）。
