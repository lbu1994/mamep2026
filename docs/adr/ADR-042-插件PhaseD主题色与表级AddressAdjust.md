# ADR-042：插件 Phase D —— 主题色（用户设置层）+ 表级 Address Adjust

- 状态：**已确认（2026-09-01）**
- 日期：2026-09-01
- 决策来源：用户任务（docs/插件功能设计.md §4.4/§4.5/§10/§11；Phase A~C 已落地 ADR-039/040/041）；用户确认：①Address Adjust 移出核心 + 内置插件开箱即用 ②VSCode 派生 token 取舍（主色存活、派生跟随 VSCode）③非活动表轮询按各自 sheet ④复制表继承 addressTransform、type 固定）

## 背景

- **Phase A（ADR-039）已落地**：`theme` 贡献点消费方（`MamepApp.tsx` L125-139 装配链，纯数据）+ `addressTransform` 贡献点 schema（仅 `{id, protocol, titleKey?}`，**空消费方**）+ Manifest v2 + 内置同进程执行面。
- **Phase B/C（ADR-040/041）已落地**：codec 注入 + 表类型 + ROM/RAM。
- **Address Adjust 现状**：全局 profile 级——`RtuConnectionProfile.addressAdjust`（domain/schema/session-payloads）→ `RtuSessionHost.getAddressAdjustMode`（连接时 profile 快照）→ `SessionHostCore` 注入 `RegisterTableService` → `computeSentAddress`（发送 = 用户 − 1，0 下溢报错）；轮询读全局 profile（`apps/web/src/App.tsx` L155/243）。
- **主题现状**：`buildTheme` 硬编码 `colorPrimary #1460d6/#1668dc`；`MamepApp.tsx` L133-139 装配链 = 插件贡献 → themeConfig(null) → 默认，**无用户设置层**；`apps/web/src/index.css` 存在第二份硬编码 `--mamep-brand-primary`（2 定义 + 8 消费）与 `--mamep-focus-ring`。
- workspace schemaVersion = 5（v4→v5 表类型，ADR-041）。

## 决策

### 1. Address Adjust 移出核心，内置插件开箱即用（ADR-013 逆转）

- 删除核心侧全局 addressAdjust 全链路：`ConnectionSettingsModal` Select、`connection-settings-model`（settingsSchema/rtuPersistedSettingsSchema/toProfile/profileToValues/extractPersistedSettings）、`RtuConnectionProfile.addressAdjust`（domain/config/schema/session-payloads）、`CommProperties.addressAdjust` + BottomPanel 展示。
- 改为**表级配置 + 插件贡献**：
  - `RegisterSheet` 增 `addressTransform: { transformId: string; enabled: boolean } | null`（随工作区持久化；null=不调整）。
  - `addressTransform` 贡献点 schema 扩展 `defaultConfig?: { enabled }`；`apply`/`validate` 是函数**不能进 payload**，由插件 `activate` 注册进 `AddressTransformRegistry`（仿 codec 模式，ADR-040）。
  - 内置 `builtin.address-adjust` 插件开箱即用（`source:"builtin"`，apply=user−1，0 下溢 `ADDRESS_ADJUST_UNDERFLOW`）。
  - 发送链：`RegisterTableService` 注入 `getAddressTransform`（活动表配置解析出的变换）→ `applyAddressTransform`；`userAddress` 仍随 meta 传通信层（日志双地址语义不变）。
  - 轮询按表：`buildPollingTargets`/`applyPollResult`/`pollResultAddressMatches` 按**各行所属 sheet** 的 addressTransform 应用（非活动表轮询亦然）。
  - 会话层：`SessionHostCore` 新增可变 `addressTransform` + `setAddressTransform`；`getAddressTransform` 源 = 活动表配置（经注入 `resolveAddressTransform` 解析，默认仅内置）。浏览器/Electron RTU 本地直接 set；**host 端会话经新 kind `session-set-address-transform` RPC**（复刻 `session-set-slave-address`/`session-set-unit-id` 五处接线模板）。
- **技术落点**：`AddressTransform` 接口 + `applyAddressTransform` + `BUILTIN_ADDRESS_ADJUST_TRANSFORM` 定义于 `packages/register-table/src/address.ts`（地址语义归属地，application 直接依赖）；plugin-api 定义结构兼容的注册表类型（plugin-api 不依赖 register-table）。

### 2. 主题色：插件贡献 → 用户设置 → 默认（用户设置层落地）

- `workspace.preferences.themePrimary: { light: string; dark: string } | null`（随工作区持久化；null=默认品牌蓝）。
- Settings 弹窗新增「主题色」分组：浅/深两个 antd `ColorPicker`（依赖已在 antd 依赖树，`@rc-component/color-picker`）+ 重置按钮；i18n 双语。
- 装配链（`MamepApp.tsx` L133-139）：`base = themeConfig ?? buildTheme(dark)` → `mergeThemeConfig(base, userOverrides)`（用户层）→ 再 `mergeThemeConfig(_, pluginThemeConfig)`（插件层最高优先）。
- **对比度**：装配时对用户主色做 AA 校验（白字 on 主色 ≥4.5，复用 `ui-theme/contrast.ts`），不达标 warning message + 回退默认。
- **VSCode（ADR-027）**：`mapVscodeTheme` 品牌/状态色保留 → 用户主色可存活；派生 token（colorPrimaryBg/Border 等）**跟随 VSCode 覆盖**（取舍：主色存活、派生跟随）。
- **index.css 第二事实源**：`--mamep-brand-primary`/`--mamep-focus-ring` 保留 CSS 兜底定义，主题装配时由 effect 在 `document.documentElement` 内联 `setProperty` 覆盖（内联样式优先于 `:root`/`[data-mamep-theme]` 规则），消除硬编码副本。

### 3. workspace schema v5→v6 迁移（复刻 v1→v2 全局→每表范本）

- 各 sheet 补 `addressTransform`：全局 `profile.addressAdjust === "on"` → `{ transformId: "builtin.address-adjust", enabled: true }`，否则 `{ ..., enabled: false }`；已有值保留。
- 删除各 profile 的 `addressAdjust` 字段；`preferences` 补 `themePrimary: null` 缺省。
- `workspaceSchemaVersion` 5→6；`serializeWorkspace`/`parseWorkspace`/`exchange.ts` 自动跟进（schema 直通）。

### 4. 撤销与 UI

- `SheetEditSnapshot` 增 `addressTransform`（snapshot/apply/sheetFrom 三处）；app-store `setSheetAddressTransform`（照抄 `setSheetWriteVerify` 快照入栈）。
- RegisterTable 工具栏新增每表 Address Adjust 控件（antd `Segmented` OFF/ON + Tooltip + aria-label + i18n，照抄 writeVerify/radix 模式）；选项来源 = `addressTransform` 贡献点（内置恒在）。
- 复制表继承 `addressTransform`、`type` 固定不可复制（与既有跨类型复制限制一致）。

## 影响面

- 删除：`RtuConnectionProfile.addressAdjust`（domain/config/schema/session-payloads/connection-settings-model/ConnectionSettingsModal/BottomPanel/CommProperties）、各 app-host `addressAdjust` 回退、`config/connections.json` 字段（测试基建，ADR-024 消费方同步核对）。
- 新增：`RegisterSheet.addressTransform`、`Preferences.themePrimary`、`AddressTransformRegistry`（plugin-api）、`BUILTIN_ADDRESS_ADJUST_TRANSFORM`（register-table）、kind `session-set-address-transform`（五处接线）、工具栏控件、Settings ColorPicker、迁移 v5→v6。
- 能力矩阵/协议层/调度器零改动（Address Adjust 在 Renderer/会话注入层应用，不触协议帧）。

## 测试

- 单测：register-table（transform/apply/轮询按表/undo）、workspace（v5→v6 迁移）、plugin-api（schema/registry）、application（setAddressTransform/getAddressTransform）、platform-api（新 kind + payload）、ui（工具栏/装配链/ColorPicker/对比度回退）、两端 ipc 穷尽守卫。
- e2e：e2e-web（每表 ON/OFF 读写 + 轮询按表 + 撤销 + 无 console 错误）、e2e-electron/e2e-vscode（`session-set-address-transform` 真实 RPC 路径）、主题色设置与插件贡献。

## 已知限制 / 后续

- 仅内置 `builtin.address-adjust` 变换（-1 语义）；第三方 addressTransform 插件经贡献点 + registry 扩展（Phase F 正式化后）。
- VSCode 派生 token 取舍已定（主色存活、派生跟随 VSCode），若后续需强一致可再 ADR。
