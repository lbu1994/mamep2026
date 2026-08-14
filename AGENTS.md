# AGENTS.md — Mamep2026 AI 代理工作入口

本文件是 AI 编程代理在本仓库的工作入口与速览。**详细规范见 [docs/AGENTS.md](docs/AGENTS.md)（43 节完整手册），开始任何开发任务前必须先阅读它。**

## 项目是什么

Mamep2026：三端（浏览器 / Electron / VSCode 插件）Modbus 调试工具。单表管理不连续保持寄存器，仅功能码 03 读 / 0x10 写，插件隔离厂商私有功能，不以复刻原 M@MEp2006 界面为目标。

## 指令优先级

用户当前任务指令 > 已确认产品决策 / ADR > [docs/AGENTS.md](docs/AGENTS.md) > [TECH_DESIGN.md](docs/TECH_DESIGN.md) > [PRD.md](docs/PRD.md) > Research / 原版界面资料 > 现有代码与测试行为 > AI 推测。冲突不得静默取舍；未确认事项（见 docs/AGENTS.md §35）必须先提问，不得自行拍板。

## 当前实际工程结构（重要）

- **已迁移到 pnpm monorepo**（2026-08-13，ADR-013）：网页端在 `apps/web/`（Vite + React）；`packages/` 下为分层共享包（domain、protocol-modbus、data-conversion、communication、workspace、logging、plugin-api、register-table、platform-api、platform-web、ui、test-kit）；`tooling/typescript-config` 共享 TS 配置；`tests/` 下为 acceptance 与 e2e-web。
- Electron 主进程仍在 `electron/main.ts`（不在本轮实现/测试范围，仅保证编译与路径引用不破坏）；`vscode-extension/` 同理。
- **开发进度（2026-08-13）**：浏览器侧 MVP（P0）已实现并验收——文档修正（ADR-013）→ monorepo 迁移 → domain/protocol/data-conversion/communication/workspace/logging/plugin-api/register-table/platform-web/ui 分层实现（TDD，包内测试 170+）→ acceptance 与 e2e-web（Playwright 系统 Edge，mock 传输）全绿。浏览器端支持：Web Serial RTU（含 dev mock 传输 `?mockTransport=1`）、单表寄存器 FC03/FC0x10、单行/全表读取、WP 轮询（间隔=Rx Delay）、TM 追踪窗、多标签页、通信日志（仅字节）、IndexedDB 自动保存与恢复、浅/深主题、i18n（en-US 主 + zh-CN）、最小插件注册表。
- **开发进度（2026-08-15，ADR-015）**：行编辑完整落地——插入行、剪切/粘贴（系统 CSV + 应用内剪贴板）、多行选择（antd rowSelection 原生）、行级键盘快捷键、行级右键菜单（Dropdown）；多选/剪切/粘贴由 PRD §8.3 P1 提前到 MVP；删除维持直接删除不弹确认（用户决策）。

## 常用命令（以根 package.json 实际脚本为准，不得假设不存在的脚本）

- `pnpm dev` — 网页端 Vite dev server（http://localhost:5173，apps/web），**不启动 Electron**
- `pnpm dev:electron` — Electron 开发模式（apps/web `vite --mode electron`，主进程仍打包到根 `dist-electron/`；**本轮不验证不测试**）
- `pnpm build` / `pnpm build:electron` — 构建网页端 / Electron（产物 `apps/web/dist/`）
- `pnpm build:vscode` — 编译 `vscode-extension/`（`tsc -p vscode-extension`，本轮仅确认不破坏）
- `pnpm lint` — ESLint（全仓）
- `pnpm typecheck` — turbo 全包类型检查（各包 `tsc --noEmit`）
- `pnpm test` — turbo 全包 vitest；`pnpm test:acceptance` / `pnpm test:e2e:web` 单独跑对应测试包
- `pnpm format` / `pnpm format:check` — Prettier

## 环境要点与坑

- 包管理 **pnpm 11**；原生依赖构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`（旧字段 `onlyBuiltDependencies` 已失效，pnpm 会自动往该文件追加占位键，注意 YAML 键重复）。
- 镜像：`.npmrc` 指向 npmmirror；Electron 二进制需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- Electron：入口 `dist-electron/main.js`（根目录）；dev 用 `VITE_DEV_SERVER_URL` 加载网页，生产 `loadFile` 指向 `apps/web/dist/index.html`。无 preload/IPC，保持 `contextIsolation: true`、`nodeIntegration: false`。
- VSCode 插件：webview 当前为 dev 模式（iframe 指向 dev server，`MAMEP_DEV_URL` 可覆盖）；CSP 必须含 `style-src 'unsafe-inline'` 并设置 html/body/iframe 100% 宽高，否则 iframe 缩成 300×150。
- 浏览器自动化测试：**Playwright 使用系统 Edge**（`channel: "msedge"`），不下载 Chromium。工作流见 [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md)。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。

## 测试约定

- 非界面变更走 TDD / ATDD（先写失败测试再实现）；界面开发不要求测试先行。
- 包内单测用 vitest（每包 `pnpm test`）；调度测试用 Virtual Clock + FakeTransport（packages/test-kit）。
- 浏览器端 E2E：Playwright 使用系统 Edge（`channel: "msedge"`），配置在 `tests/e2e-web/playwright.config.ts`；以 `?mockTransport=1` 启用 dev 内置模拟 Modbus RTU 传输（生产构建不启用）。工作流见 [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md)。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。

## 关键红线（详见 docs/AGENTS.md §32「AI 禁止行为」）

不擅自扩展产品范围；浏览器端不实现 Modbus TCP；UI 不直接访问串口/TCP/文件系统；所有设备请求进入统一调度器；厂商私有规则只进插件不进核心；不得关闭类型检查或用 `any`/断言蒙混；不得谎报未执行的命令或测试。

## 文档地图

| 文档                                                                                                                                                                                                                                                                   | 内容                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [docs/AGENTS.md](docs/AGENTS.md)                                                                                                                                                                                                                                       | 43 节完整手册：架构强制规则、Modbus 协议、调度、持久化、错误模型、TDD、禁止行为、完成自检等  |
| [docs/PRD.md](docs/PRD.md)                                                                                                                                                                                                                                             | 产品范围、MVP（P0~P3）、验收                                                                 |
| [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)                                                                                                                                                                                                                             | 技术设计、ADR-001~012、三端能力矩阵、测试策略                                                |
| [docs/RESEARCH.md](docs/RESEARCH.md)                                                                                                                                                                                                                                   | 调研结论（原 M@MEp2006 分析、COM10 bug 等）                                                  |
| [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) / [docs/adr/ADR-013-monorepo迁移与产品决策确认.md](docs/adr/ADR-013-monorepo迁移与产品决策确认.md) / [docs/adr/ADR-014-寄存器地址进制显示选择.md](docs/adr/ADR-014-寄存器地址进制显示选择.md) / [docs/adr/ADR-015-行编辑交互与剪贴板决策.md](docs/adr/ADR-015-行编辑交互与剪贴板决策.md) | 浏览器端自动化测试工作流与踩坑 / MVP 产品决策记录 / Register 地址列 HEX/DEC 按表独立选择决策 / 行编辑交互与剪贴板决策 |
| [docs/M@MEp2006串口选择对话框 界面特征整理.md](docs/M@MEp2006串口选择对话框%20界面特征整理.md) / [docs/M@MEp2006主寄存器监控界面 界面特征整理.md](docs/M@MEp2006主寄存器监控界面%20界面特征整理.md)                                                                    | 原版工具界面特征参考（背景资料，不是复刻规格）                                               |

工作区技能：`.agents/skills/frontend-design/`（前端视觉设计指引，设计新 UI 时使用）；`.agents/skills/browser-e2e-testing/`（浏览器自动化交互验证与 E2E 冒烟自检要点，详见 [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md)）。
