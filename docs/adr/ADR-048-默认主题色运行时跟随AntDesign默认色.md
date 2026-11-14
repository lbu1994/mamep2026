# ADR-048：默认主题色改为运行时跟随 Ant Design 默认色（去除硬编码）

- 状态：**已确认（2026-09-02）**
- 日期：2026-09-02
- 决策来源：用户任务（参考 Ant Design 色彩体系；默认主题色浅/深硬编码改为使用 Ant Design 提供的对应颜色；
  验收目标 = 将来 Ant Design 仅改颜色值不改 API 时，更新库即可自动跟随，本软件零代码修改）
- 关联：ADR-047（D1「字面取 antd 默认」——本次修订其取值方式，其余决策不变）/ ADR-042（`--mamep-*` 注入机制，
  保持不变）/ ADR-027（VSCode 主题适配，主色存活语义不变）/ ADR-043（插件主题色纯数据，不变）

## 背景

- ADR-047 确定「内置默认蓝 = Ant Design 默认色」，实现为：`packages/ui-theme/src/base.ts`
  `buildTheme(dark)` 硬编码 `colorPrimary/colorLink`（浅 `#1677ff` / 暗 `#1668dc`）与
  `colorLinkHover/colorLinkActive`（浅 `#4096ff`/`#0958d9`，暗 `#8cb8ff`/`#4a8ff7`）；
  `apps/web/src/index.css` 存在第二份兜底字面量（`--mamep-brand-primary`、`--mamep-status-info`、
  `--mamep-focus-ring`，浅 `#1677ff` / 暗 `#1668dc`/`#6ba1ff`）；`scripts/check-contrast.mjs` 同样硬编码。
- 问题：颜色值以字面量形式复制到多处，Ant Design 升级更改默认色后，软件**不会**自动跟随，
  需要人工比对并修改多处代码——与「默认色 = 跟随 antd 的受控预设」语义不符。

## 决策（2026-09-02 用户确认）

### 1. 默认主题色运行时取自 antd 公开 API（D1）

- `buildTheme(dark)` 的品牌色组（`colorPrimary` / `colorLink` / `colorLinkHover` / `colorLinkActive`）
  改为运行时经 **`theme.getDesignToken({ algorithm })`**（antd 公开 API）取值：
  - 浅色：`getDesignToken({ algorithm: theme.defaultAlgorithm })`；
  - 暗色：`getDesignToken({ algorithm: theme.darkAlgorithm })`。
- 不再在 `base.ts` 硬编码任何默认品牌色字面量；antd 升级改默认色时，同一调用自动返回新值，
  无需修改本软件代码。
- `buildTheme` 保持纯函数形态，品牌色组作为可选注入参数（默认 = antd 计算值）：
  便于测试注入/模拟「antd 变了」的场景（见测试节）。

### 2. CSS 兜底改为跟随 antd cssVar（D2）

- `apps/web/src/index.css` 删除 `:root` / `[data-mamep-theme="dark"]` 中
  `--mamep-brand-primary` / `--mamep-status-info` / `--mamep-focus-ring` 的硬编码字面量；
- 改为在 `.ant-app` 作用域映射 antd CSS 变量：
  `--mamep-brand-primary: var(--ant-color-primary)`、`--mamep-focus-ring: var(--ant-color-primary)`、
  `--mamep-status-info: var(--ant-color-info)`；
- 依据：antd cssVar（`cssVar: { key: "ant" }`）的 `--ant-*` 变量只在 antd 组件作用域
  （含 `ant` 类元素及后代）可解析，`:root` 上不可引用（既有 index.css 注释已说明该约束）；
  因此令牌声明于 `.ant-app`，组件消费点（主表/侧栏/追踪窗/工具栏）均在其子树内；
- `MamepApp.tsx` 既有注入 effect（把主题主色内联覆盖到 `--mamep-brand-primary` /
  `--mamep-focus-ring`）**保留**：2026-09-03 起取 `deriveAppliedPrimary(seed, dark)`（getDesignToken 只读
  计算当前模式**派生后**的真实主色，不喂回 ConfigProvider 避免二次派生），覆盖 `.ant-app` 子树之外
  的元素（继承自 `<html>` 内联变量），并与 antd 实际渲染保持一致。

### 3. 行为修正：link hover/active 顺带对齐 antd 派生值（D3）

- 实测 antd 6.6.0 默认：浅色 `colorLinkHover = #69b1ff`、`colorLinkActive = #0958d9`；
  暗色 `colorLinkHover = #15417e`、`colorLinkActive = #1554ad`。
- 原硬编码中浅色 `colorLinkHover: #4096ff` 实际是 antd 的 `colorPrimaryHover`（值误用），
  暗色 `#8cb8ff` / `#4a8ff7` 为自定义值（非 antd 派生）。本次一并改为 antd 实际派生值。

### 4. focus-ring 暗色兜底（D4）

- 原暗色 `--mamep-focus-ring: #6ba1ff` 为自定义值；运行时注入早已使用主色，本次 CSS 兜底
  统一为 `var(--ant-color-primary)`（暗色即 antd 暗色主色 `#1668dc`），不再保留特殊字面量。

### 5. 范围边界（D5）

- **不变**：插件贡献的主题色（`plugins/*`、`THEME_COLOR_PRESET_SCHEMA`、`theme-contributions.ts`）
  仍是插件声明数据；Address Adjust、能力矩阵、HostMessage v1、协议层/调度器、三端宿主层零改动；
  VSCode `mapVscodeTheme`（ADR-027）品牌/状态色保留语义不变；`workspace.preferences.themePrimary`
  持久化格式（预设 ID / null）不变。
- **范围外**：`--mamep-bg-selected`（浅 `#e6f4ff` / 暗 `#152d50`）等选中态背景为独立设计值，
  不随 antd 默认色自动跟随（属于品牌衍生设计，非「默认主题色」本体）；如后续需要可再 ADR。
- `scripts/check-contrast.mjs` 的品牌色/链接色/选中态色改由 antd 运行时令牌计算（消除字面量），
  其余自定义灰阶/背景字面量保持不变（非默认主题色）。

## 影响面

- 代码：`packages/ui-theme/src/base.ts`（运行时取色 + 注入参数）、`apps/web/src/index.css`
  （`.ant-app` 令牌映射）、`scripts/check-contrast.mjs`（antd 运行时令牌）；
- 行为变化（仅暗色与浅色 link hover/active）：见 D3；其余视觉零变化（当前 antd 默认值与
  原浅色主色一致）；
- 文档：ADR-047 增修订记录、[样式与主题](../architecture/presentation/ui-theme/主题设计.md)、根 AGENTS.md 进度与文档地图、
  README 当前状态；
- 测试：`packages/ui-theme` 新增 base 单测（与 antd 令牌一致 + 模拟 antd 变化跟随）、
  e2e `theme-color-presets.spec.ts` / `plugin-contributions.spec.ts` 断言改为与页面
  `--ant-*` 运行时值对比（消除颜色字面量）、新增暗色同步断言。

## 测试

- 单测：`buildTheme(false/true)` 品牌色组 === 对应 `getDesignToken` 结果；
  「模拟 antd 默认色变化」（mock `getDesignToken` / 注入参数）→ `buildTheme` 输出跟随，无需改代码；
- e2e-web（mockTransport）：默认蓝时 `--mamep-brand-primary`（根/组件）=== 页面 `--ant-color-primary`
  计算值；切换暗色后同步；插件色路径不回归；无 console 错误。

## 已知限制 / 后续

- antd cssVar 变量作用域限制（`:root` 不可引用）导致 `.ant-app` 外的元素（弹窗 portal）依赖
  MamepApp 注入 effect（值同源自 antd 令牌），双轨同源、无字面量；
- 「更新 antd 后自动跟随」依赖 antd 保持 `theme.getDesignToken` / `cssVar` 公开契约不变
  （任务假设条件：仅颜色值变化）；若 antd 未来破坏该 API，需另行 ADR 迁移。
