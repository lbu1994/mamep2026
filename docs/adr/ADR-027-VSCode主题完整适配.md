# ADR-027：VSCode 主题完整适配（light/dark 两态 → 完整主题令牌映射，ui-theme）

- 状态：已确认
- 日期：2026-08-25
- 决策来源：用户任务（README ToDoList「VSCode 主题完整适配（light/dark 两态 → 完整主题令牌
  映射，ui-theme）— ADR-019 后续复审条件」的收尾）

## 背景

- VSCode 端骨架（ADR-019，2026-08-23）仅做 `light/dark` 两态映射：扩展宿主
  `toColorThemeKind` 把 `ColorThemeKind` 映射为 `light/dark`（HighContrast → dark），经
  `get-color-theme` / `color-theme-changed`（HostMessage v1）同步共享 store，UI 用
  `buildTheme(dark)` 两态渲染。「完整的 VSCode Theme Color → antd token 映射适配层
  （ui-theme 包）」列入 ADR-019 后续复审条件。
- TECH_DESIGN §4.7「样式和主题」规划了平台主题适配层：`ConfigProvider` token 体系 +
  `defaultAlgorithm`/`darkAlgorithm` + 语义令牌；「VSCode 端通过主题适配层将 VSCode Theme
  Color 映射到 antd token，保持三端主题一致」。
- 三端 UI 共享 `packages/ui`（MamepApp），主题唯一装配点为
  `<ConfigProvider theme={buildTheme(theme === "dark")}>`。

## 关键约束（已核实）

- **取色来源**：VSCode Webview 会把当前主题解析后的真实颜色以 `--vscode-*` CSS 自定义属性
  注入文档；扩展宿主（Extension Host）无公开 API 直接读取当前 Workbench 主题色值 → CSS
  变量是获取真实主题色的唯一轻量路径。
- **dev 模式 iframe**：共享 UI 在 dev 下运行于 `<iframe>`（Vite dev server），CSS 变量
  **不跨 iframe 文档**，`getComputedStyle` 读不到 `--vscode-*`。
- **依赖方向**：`ui-theme → antd`（唯一运行时依赖）；`packages/ui → ui-theme`（base 反向
  re-export，`packages/ui/src/theme.ts` 为兼容 shim）；`apps/* → ui-theme`。无环。base 主题
  （buildTheme）自 `packages/ui/src/theme.ts` 迁入 `packages/ui-theme/src/base.ts`。

## 已确认决策（用户 2026-08-25，4 项）

1. **取色策略：中性色跟随 + 品牌蓝/状态语义色保留**。背景/表面/边框/输入态/选择态/文字灰阶
   跟随 VSCode 主题；品牌蓝（colorPrimary/link）、状态语义色（success/warning/error）、
   字号、间距、圆角来自 base 保留 → 三端识别一致、对比度可控。
2. **dev 模式：生产 + dev 都完整适配**。dev 走「主 frame → iframe」主题颜色中继（dev-only，
   非 HostMessage 通道）：主 frame（`apps/vscode-extension/src/webview/html.ts` 中继脚本）
   在加载时 / 转发 `color-theme-changed` 时 / 响应 iframe `theme-colors-request` 时下发
   `{source:"mamep-theme-relay", type:"theme-colors", colors}`；iframe 侧
   `apps/web/src/vscode-dev-bridge.ts` 的 `installVscodeDevThemeRelay` 把变量物化到
   `documentElement.style`，之后应用与生产走同一读取路径。
3. **High Contrast：沿用现有两态 + token 自然跟随**。HC→dark、HC Light→light 保持现状；
   因 `--vscode-*` 变量在 HC 下本身就是高对比色值，token 层面自然跟随，无额外分支。
4. **协议层：不新增 HostMessage kind**。算法仍走现有 `get-color-theme` / `color-theme-changed`
   两态；真实色值由 Webview 本地读 `--vscode-*` CSS 变量。

## 决策

1. **新包 `packages/ui-theme`（平台主题适配层）**：
   - `base.ts`：`buildTheme(dark)` / `UI_FONT_STACK` / `MONO_FONT_STACK`（自 ui 迁入）。
   - `theme-colors.ts`：`VSCODE_CSS_VAR_NAMES`（21 个 `--vscode-*` 变量清单，dev 中继脚本
     与其同源）+ `readVscodeCssVars(source)`（`CssVarSource` 结构化接口，ui-theme 不依赖
     DOM）+ `pick`（多候选取色回退）。
   - `contrast.ts`：`parseColor` / `relativeLuminance` / `contrastRatio` / `blend` /
     `ensureContrast`（WCAG 2.2 AA 方向，`scripts/check-contrast.mjs` 同思路）。
   - `map.ts`：`mapVscodeTheme(colors, dark)` 纯函数——只产中性/表面/边框/组件覆盖；文字灰阶
     由 `editor-foreground` 推导 alpha 并经 `ensureContrast` 保证 AA（正文/次级 ≥4.5:1，
     quaternary/placeholder ≥3:1）；缺失变量回退 base。
   - `merge.ts`：`mergeThemeConfig(base, overrides)`——token 浅合并 + components 逐组件
     浅合并，override 优先。
   - `build.ts`：`buildVscodeTheme(colors, dark) = merge(buildTheme(dark), map(...))`。
   - 子路径导出 `./theme-colors`（供扩展宿主 dev HTML 生成只取变量清单，不拖入 antd/ui）。
2. **store 注入（`packages/ui/src/app-store.ts`）**：新增 `themeConfig: ThemeConfig | null` +
   `setThemeConfig`（运行时派生，**不持久化**）；`MamepApp` 单一装配点改为
   `<ConfigProvider theme={themeConfig ?? buildTheme(theme === "dark")}>`——浏览器/Electron
   恒 null 走原路径，UI 无平台分支。
3. **宿主装配（`apps/web/src/vscode-app-host.ts`）**：构造时（`getColorTheme` 后）与
   `color-theme-changed` 事件时 → 读 `--vscode-*` → `buildVscodeTheme` → `setThemeConfig`；
   立即读一次 + 下一帧再读一次（生产 `color-theme-changed` 先于 CSS 变量更新到达、dev 中继
   消息晚于首读，双保险，幂等）。`VscodeAppHostOptions` 增加 `cssVarSource` / `scheduleFrame`
   注入（测试用）。
4. **dev 中继（dev-only，不新增 kind）**：`html.ts` 中继脚本三时机下发（加载 / 转发
   `color-theme-changed` / 响应请求）；`vscode-dev-bridge.ts` 新增 `installVscodeDevThemeRelay`
   （安装时发 `theme-colors-request` 闭合竞态 + 物化变量到 iframe 文档根）。中继消息
   非 HostMessage Envelope 形状（自定义 source/type），主 frame 拦截不转发回宿主。

## 影响

- **正向**：VSCode Webview 完整跟随宿主主题（含用户自定义主题、高对比度），三端核心视觉
  语言一致；dev/prod 行为一致；协议层零改动；浏览器/Electron 主题零变化。
- **负向**：dev 中继为 dev-only 专属代码（主 frame 脚本 + iframe 物化），需与 ui-theme 变量
  清单保持同源（有单测锁定核心变量）；生产 `color-theme-changed` 与 CSS 变量更新时序不保证
  （rAF 延迟重读 + 双读兜底，实测未见闪烁）。

## 测试与验收

- `packages/ui-theme` 单测 27 用例：读取/回退、明/暗/HC 金样映射、AA 对比度抽样、合并。
- `packages/ui`：store `themeConfig` 用例 + `MamepApp` ConfigProvider 注入断言（antd cssVar
  输出 token；注意 colorPrimary 会被 antd 色板派生转换，断言用表面色 token）。
- `apps/web`：`VscodeAppHost` 主题装配 3 用例（构造读变量装配 / 事件重读重建 / 无变量回退
  base）+ dev 中继 4 用例。
- `apps/vscode-extension`：`getDevHtml` 中继脚本断言（变量清单、三时机下发、请求拦截在
  `vscode.postMessage` 之前）。
- `tests/e2e-vscode/real/real-theme.spec.ts`（MAMEP_REAL 门控，UI 级）：生产 webview 内
  antd 表面 token 跟随 `--vscode-*`；切 Light/Dark Modern 实时生效；面板关闭重开正确；
  无 console 错误。

## 后续复审条件

- 若后续引入 `platform-vscode` 包，可评估把 dev 中继/取色封装下沉到该层（当前不必要）。
- 真机人工复核：生产 VSCode 装 VSIX 后切换主题/高对比度主题的观感（e2e 已覆盖自动化断言）。
