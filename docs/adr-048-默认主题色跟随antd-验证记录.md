# ADR-048 验证记录：默认主题色运行时跟随 Ant Design 默认色

- 日期：2026-09-02
- 关联：[ADR-048-默认主题色运行时跟随AntDesign默认色.md](adr/ADR-048-默认主题色运行时跟随AntDesign默认色.md)
- 验证环境：Windows / pnpm 11 / dev server（`pnpm dev`，`?mockTransport=1`）/ 系统 Edge（Playwright）

## 变更摘要（相对 ADR-047）

| 文件 | 变更 |
|---|---|
| `packages/ui-theme/src/base.ts` | 删除品牌色（colorPrimary/colorLink/colorLinkHover/colorLinkActive）硬编码字面量；`buildTheme` **不覆盖**品牌 token（antd 默认种子直接生效）；新增 `getAntdDefaultBrandColors(dark)`（antd 公开 API `theme.getDesignToken({ algorithm })` 取值），供测试/校验/文档消费 |
| `apps/web/src/index.css` | 删除 `:root`/`[data-mamep-theme="dark"]` 中 `--mamep-brand-primary`/`--mamep-status-info`/`--mamep-focus-ring` 字面量；改为 `.ant-app { --mamep-brand-primary: var(--ant-color-primary); --mamep-focus-ring: var(--ant-color-primary); --mamep-status-info: var(--ant-color-info); }` |
| `scripts/check-contrast.mjs` | 品牌/链接/选中态色改由 antd 运行时令牌计算 |
| `MamepApp.tsx` | 零改动（注入 effect 保留；默认路径 token 无主色 → 跳过，插件色路径照常注入） |
| 测试 | ui-theme 新增 `base.test.ts`（5 用例）；`theme-color-presets.spec.ts` / `plugin-contributions.spec.ts` 去默认色字面量、改为与页面 `--ant-*` 运行时值对比，并新增「浅/深同步」用例 |

## 关键设计事实（antd 6.6.0 实测）

- 浅色默认令牌：`colorPrimary = colorLink = #1677ff`，`colorLinkHover = #69b1ff`，`colorLinkActive = #0958d9`；
- 暗色默认令牌：`colorPrimary = colorLink = #1668dc`，`colorLinkHover = #15417e`，`colorLinkActive = #1554ad`；
- **二次派生陷阱（已规避）**：若把 `getDesignToken` 的派生结果（如暗色 `#1668dc`）作为
  `token.colorPrimary` 覆盖喂回带 algorithm 的 ConfigProvider，antd 会把覆盖值当**种子**再派生
  （实测暗色渲染为 `#165bbe`，与 CSS 变量不一致）→ 故 `buildTheme` 不覆盖品牌色 token。

## 运行时验证（dev server + 系统 Edge，`?mockTransport=1`）

### 1. 令牌与 CSS 变量同步（浏览器内实测取值）

| 主题 | `.ant-app` 计算值 | 结果 |
|---|---|---|
| Light | `--ant-color-primary = #1677ff`；`--mamep-brand-primary = #1677ff`；`--mamep-focus-ring = #1677ff`；`--mamep-status-info = #1677ff` | ✅ 一致 |
| Dark | `--ant-color-primary = #1668dc`；`--mamep-brand-primary = #1668dc`；`--mamep-focus-ring = #1668dc`；`--mamep-status-info = #1668dc` | ✅ 一致 |

- 消费点（`--mamep-brand-primary` 用于 `.sheet-item--active::before`、WP 指示点、trace 状态点、
  滑块手柄、页签等）均在 `.ant-app` 子树内，解析正常；
- `.ant-app` 作用域无法覆盖的弹窗 portal 场景由 MamepApp 注入 effect 兜底（同源自 antd 令牌，未触发），无视觉差异；
- 深浅切换过程中无 console error、无渲染闪烁（切换后立即取值为新值）。

### 2. 截图 + 多模态确认（Qwen Vision，qwen3-vl-flash）

- 截图：`_screenshots/adr048-light.png`（浅色）、`_screenshots/adr048-dark.png`（深色）；
- 多模态结论（摘要）：
  - 第一张为浅色主题，Read/Write/Read All 主按钮为 **明亮亮蓝（≈ #1677ff 类型）**；
  - 第二张为深色主题，主按钮为 **较深的中等亮度蓝（≈ #1668dc 类型）**，暗背景下对比良好；
  - 无按钮变色失败、无背景缺失、无溢色异常；选中行/高亮态正常。

## 自动化验证

| 项 | 命令 | 结果 |
|---|---|---|
| ui-theme 单测 | `pnpm --filter @mamep2026/ui-theme test` | 5 文件 32 用例全绿（含新增 base 5 用例：与 getDesignToken 一致×2、模拟 antd 改色跟随、buildTheme 不覆盖品牌 token、算法跟随） |
| 受影响包 typecheck | `pnpm --filter @mamep2026/ui-theme --filter @mamep2026/ui --filter @mamep2026/web typecheck` | 通过 |
| 受影响包 lint | 同上 drei 包 | 通过 |
| e2e-web typecheck/lint | `@mamep2026/e2e-web` | 通过 |
| 主题相关 e2e | `@mamep2026/e2e-web exec playwright test tests/theme-color-presets.spec.ts tests/plugin-contributions.spec.ts` | **7/7 全绿**（含新增「默认蓝跟随 antd 令牌：--mamep-brand-primary 与 --ant-color-primary 浅/深同步（ADR-048，无字面量）」；全程无 console 错误） |

## 结论

- 「默认主题色 = 运行时来自 antd 公开令牌」已落地：代码无默认色字面量（仅测试夹具使用任意颜色值，
  不代表 Mamep 默认色）；antd 仅改颜色值时，`getDesignToken`/cssVar 自动返回新值 → 软件零代码修改即跟随；
- 「模拟 antd 改色自动跟随」已由单测覆盖（mock `theme.getDesignToken`），界面实际落地已由
  运行时取值断言 + 截图多模态确认；
- 行为差异说明：浅/深 link hover/active 从旧自定义值改为 antd 派生值（浅 hover `#4096ff`→`#69b1ff`，
  暗 `#8cb8ff`/`#4a8ff7`→`#15417e`/`#1554ad`），属本 ADR 预期修正；
- 未执行：全仓 e2e/全量回归（按任务要求，全量回归范围由用户确认后执行）。

## 临时文件

- `_screenshots/adr048-light.png` / `adr048-dark.png`：证据截图（保留）；
- `_screenshots/qwen-adr048.mjs`：视觉确认临时脚本（保留，可复用）。
