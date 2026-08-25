# ADR-019：VSCode 端骨架与安全 RPC

- 状态：已确认
- 日期：2026-08-23
- 决策来源：用户指令（2026-08-23 VSCode 端骨架落地：命令打开 Webview 加载共享 UI）

## 背景

PRD §8.2 的 P0「三端运行骨架」要求：浏览器、Electron、VSCode 三端均能启动并加载同一套 React UI 页面，VSCode 端可通过命令打开 Webview 加载同一 UI，不维护三份独立页面实现。

原规划（TECH_DESIGN §6.3 早期版本）中扩展位于仓库根 `vscode-extension/`（入口 `src/extension.ts`），webview 仅 dev 模式（iframe 指向 dev server），未落地生产资源加载、类型化 RPC 与集成测试，无法满足 P0 交付形态。

VSCode 端在骨架阶段的真实能力仅为「加载共享 UI + 桥能力（剪贴板、主题、能力查询）」：串口（Node Serial Adapter）、TCP（Node TCP Adapter）、文件持久化、Node 插件装配均未实现。按 AGENTS.md §32 ㉒「能力矩阵如实声明」，UI 必须通过能力矩阵隐藏不可用功能，不得暴露虚假入口。

## 决策

1. **工程结构**：扩展迁移到 `apps/vscode-extension/`（2026-08-23 自仓库根迁入）。`src/extension.ts`（扩展宿主入口）+ `src/ipc.ts`（可测 RPC 处理核心，外部能力经 `IpcDeps` 注入）+ `src/webview/vscode-bridge.ts`（Webview 侧类型化桥）。构建由 `scripts/build-vscode.mjs` 完成：`vite --mode vscode` 构建共享 UI → 拷贝到 `dist/media/` → esbuild 打包扩展宿主 `dist/extension.js` 与 webview bridge `dist/media/vscode-bridge.js`。

2. **Webview 加载双模式**：
   - 生产模式：加载 `dist/media/` 本地静态资源，经 `webview.asWebviewUri()` 重写资源 URI；`localResourceRoots` 仅放行 media 目录（安全边界）；构建期 CSP meta 声明 `style-src 'unsafe-inline'`（antd 需要），不执行 inline script、不加载远程脚本。
   - dev 模式：环境变量 `MAMEP_DEV_URL` 存在时，Webview 以 iframe 指向 Vite dev server（浏览器/Electron 同一页面，本地开发热更新）。

3. **类型化 RPC**：Extension Host ↔ Webview 复用 `packages/platform-api` 的 HostMessage v1 契约（版本化 Envelope + Zod 校验 + kind 白名单），`handleVscodeInvoke` 校验一切输入，不允许任意方法名调用，响应引用原 messageId，错误走结构化 `MamepError` 投影。骨架新增两个 kind（2026-08-23）：
   - request `get-color-theme`：查询当前颜色主题；
   - event `color-theme-changed`：`onDidChangeActiveColorTheme` 变化时推送，面板重新可见时重推。
   - VSCode `ColorThemeKind` 映射为 `light`/`dark`（antd 仅两态，高对比度映射为 `dark`）。

4. **能力矩阵如实声明**：`vscodeCapabilities`（`packages/platform-api/src/host-message.ts`）声明 `modbusRtu:false`、`modbusTcp:false`、`serialPorts:"unsupported"`、`filesystem:"unsupported"`、`nodePlugins:false`、`webPlugins:true`。`select-serial-port` request 在骨架阶段返回 `SERIAL_UNSUPPORTED`（category: capability）。UI 依据能力矩阵自动隐藏不可用功能。

5. **面板生命周期与资源释放**：单实例面板（重复执行命令 `reveal` 前置面板）；`registerWebviewPanelSerializer`（activationEvents `onWebviewPanel:mamep2026.mainPanel`）支持 VSCode 重载/重启后恢复面板；消息订阅、主题订阅、面板 dispose 全部随 `context.subscriptions` 释放，重复打开/恢复时先释放旧订阅。

6. **dev 探针**：命令 `mamep2026.debug:getPanel`（e2e/调试取面板引用，仅扩展宿主进程内代码可调用，Webview 无法调用）与 RPC `debug:get-state`（返回 platform/appVersion/colorTheme/capabilities；生产构建禁用，`isDev` 门控）。

7. **集成测试**：`tests/e2e-vscode`（真实 VSCode 环境，`@vscode/test-electron`）覆盖：扩展激活 → 命令打开主面板 → 生产 HTML 断言（资源经 `asWebviewUri` 重写、bridge 注入、CSP 不含 dev server）→ Webview bridge 启动后发送 `get-color-theme`/`get-capabilities` 类型化 RPC。

## 备选方案

- **维持根目录 + 仅 dev iframe 模式**：被否决。无法打包发布生产资源，不满足 P0「VSCode 端可命令打开 Webview 并加载同一 UI」的交付形态，也无法验证生产资源路径。
- **VSCode 自研独立 RPC 协议**：被否决。与 Electron 的 HostMessage v1 契约不一致，违背「三端共享同一套消息契约与安全校验」的目标，增加维护成本。
- **骨架即声明完整能力（`modbusRtu:true` 等）**：被否决。违背「能力矩阵如实声明」红线，UI 会暴露不可用功能并误导用户。

## 理由

- 三端共享同一套 React UI 与 HostMessage v1 契约，VSCode 专属代码最小化；
- 生产资源经 `asWebviewUri` + `localResourceRoots` 限定加载，符合 VSCode Webview 安全边界（TECH_DESIGN §22.4：严格 CSP、受控资源、所有消息由 Extension Host 校验）；
- 能力矩阵如实声明使共享 UI 自动隐藏不可用功能，避免「打开后是空壳」的误导；
- `tests/e2e-vscode` 用真实 VSCode 环境验证，保证骨架可回归。

## 正面影响

- P0 三端运行骨架全部落地：浏览器、Electron、VSCode 均能加载同一套共享 UI；
- HostMessage v1 复用：能力查询、剪贴板、主题同步等桥能力三端一致；
- 生产/开发双模式：本地开发走 dev server 热更新，打包走本地资源，互不干扰；
- 安全边界清晰：Webview 只能加载 `localResourceRoots` 内资源、只能调用白名单 kind。

## 负面影响

- VSCode 端实际能力（RTU/TCP/串口/文件持久化）尚未实现，骨架阶段仅「共享 UI + 桥」，需后续版本补齐；
- ~~主题仅做 `light`/`dark` 两态映射（高对比度映射为 dark），完整的 VSCode Theme Color → antd token 映射适配层（ui-theme 包）未落地~~ 已解决（2026-08-25，ADR-027：`packages/ui-theme` 完整令牌映射，dev 中继 + 生产 CSS 变量取色，协议零改动，浏览器/Electron 零变化）；
- dev 探针命令 `debug:getPanel` 暴露面板引用，仅扩展宿主进程内代码可调用（Webview 无法调用），无安全风险但需在正式发布时复核。

## 后续复审条件

- Node Serial Adapter（TECH_DESIGN §34.3 原型 + 串口库选型 ADR）落地后：VSCode 串口枚举/打开接线，`vscodeCapabilities` 翻转 `modbusRtu:true` / `serialPorts:"enumerated"`，`select-serial-port` 由 `SERIAL_UNSUPPORTED` 改为真实实现；
- Node TCP Adapter 落地后：`modbusTcp:true`，新增 TCP request kind；
- VSCode 文件持久化（workspaceState/globalState 或工作区文件）落地后：`filesystem` 能力翻转；
- VSCode 主题完整适配已落地（2026-08-25，ADR-027）：颜色映射从 light/dark 两态升级为完整主题令牌映射（`packages/ui-theme`，中性色跟随 + 品牌/状态保留，dev 中继 + 生产 CSS 变量取色，协议零改动）；
- 插件装配（nodePlugins）接线后：能力矩阵翻转；
- `tests/e2e-vscode` 随各能力落地持续扩展覆盖。
