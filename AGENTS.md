# AGENTS.md — Mamep2026 AI 代理工作入口

本文件是 AI 编程代理在本仓库的工作入口与速览。**详细规范见 [docs/AGENTS.md](docs/AGENTS.md)（43 节完整手册），开始任何开发任务前必须先阅读它。**

## 项目是什么

Mamep2026：三端（浏览器 / Electron / VSCode 插件）Modbus 调试工具。单表管理不连续保持寄存器，仅功能码 03 读 / 0x10 写，插件隔离厂商私有功能，不以复刻原 M@MEp2006 界面为目标。

## 指令优先级

用户当前任务指令 > 已确认产品决策 / ADR > [docs/AGENTS.md](docs/AGENTS.md) > [TECH_DESIGN.md](docs/TECH_DESIGN.md) > [PRD.md](docs/PRD.md) > Research / 原版界面资料 > 现有代码与测试行为 > AI 推测。冲突不得静默取舍；未确认事项（见 docs/AGENTS.md §35）必须先提问，不得自行拍板。

## 当前实际工程结构（重要）

- 目前是**扁平结构**：`src/`（Vite + React 网页端）、`electron/`（Electron 主进程，仅 `main.ts`）、`vscode-extension/`（VSCode 插件）。与 docs/AGENTS.md §7 描述的目标 monorepo（`apps/`、`packages/`…）不同，**尚未迁移，不得为对齐示意图做大范围移动**。
- **开发进度**：`src/` 仍是 Vite 脚手架（`App.tsx` 是计数器 demo）；zustand/antd/i18n/serialport 等依赖已装，业务代码尚未开始。三端骨架已可用（网页 dev、Electron 窗口、VSCode webview 面板）。
- `pnpm-workspace.yaml` 的 packages 通配（`apps/*` 等）当前无匹配子项目。

## 常用命令（以根 package.json 实际脚本为准，不得假设不存在的脚本）

- `pnpm dev` — 仅网页端 Vite dev server（http://localhost:5173），**不启动 Electron**
- `pnpm dev:electron` — Electron 开发模式（`vite --mode electron`）
- `pnpm build` / `pnpm build:electron` — 构建网页端 / Electron
- `pnpm build:vscode` — 编译 `vscode-extension/`（`tsc -p vscode-extension`）
- `pnpm lint` — ESLint
- ⚠️ **尚无 test / typecheck 脚本**（vitest、playwright 已安装但未配置），不得声称执行过不存在的命令

## 环境要点与坑

- 包管理 **pnpm 11**；原生依赖构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`（旧字段 `onlyBuiltDependencies` 已失效，pnpm 会自动往该文件追加占位键，注意 YAML 键重复）。
- 镜像：`.npmrc` 指向 npmmirror；Electron 二进制需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- Electron：入口 `dist-electron/main.js`；dev 用 `VITE_DEV_SERVER_URL` 加载网页，生产 `loadFile`。无 preload/IPC，保持 `contextIsolation: true`、`nodeIntegration: false`。
- VSCode 插件：webview 当前为 dev 模式（iframe 指向 dev server，`MAMEP_DEV_URL` 可覆盖）；CSP 必须含 `style-src 'unsafe-inline'` 并设置 html/body/iframe 100% 宽高，否则 iframe 缩成 300×150。
- 浏览器自动化测试：**Playwright 使用系统 Edge**（`channel: "msedge"`），不下载 Chromium。工作流见 [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md)。
- dev server 是后台长驻进程，会话中可能被系统清理；测试前先确认 5173 端口，停了就重启 `pnpm dev`。

## 测试约定

- 非界面变更走 TDD / ATDD（先写失败测试再实现）；界面开发不要求测试先行。
- 浏览器端自动化测试按 [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) 执行：以无障碍快照断言为主、选择器优先于 ref、antd v6 Modal 用 `.ant-modal-container`、HMR 后状态异常先整页刷新。

## 关键红线（详见 docs/AGENTS.md §32「AI 禁止行为」）

不擅自扩展产品范围；浏览器端不实现 Modbus TCP；UI 不直接访问串口/TCP/文件系统；所有设备请求进入统一调度器；厂商私有规则只进插件不进核心；不得关闭类型检查或用 `any`/断言蒙混；不得谎报未执行的命令或测试。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [docs/AGENTS.md](docs/AGENTS.md) | 43 节完整手册：架构强制规则、Modbus 协议、调度、持久化、错误模型、TDD、禁止行为、完成自检等 |
| [docs/PRD.md](docs/PRD.md) | 产品范围、MVP（P0~P3）、验收 |
| [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) | 技术设计、ADR-001~012、三端能力矩阵、测试策略 |
| [docs/RESEARCH.md](docs/RESEARCH.md) | 调研结论（原 M@MEp2006 分析、COM10 bug 等） |
| [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) | 浏览器端自动化测试工作流与踩坑 |
| [docs/M@MEp2006串口选择对话框 界面特征整理.md](docs/M@MEp2006串口选择对话框%20界面特征整理.md) / [docs/M@MEp2006主寄存器监控界面 界面特征整理.md](docs/M@MEp2006主寄存器监控界面%20界面特征整理.md) | 原版工具界面特征参考（背景资料，不是复刻规格） |

工作区技能：`.agents/skills/frontend-design/`（前端视觉设计指引，设计新 UI 时使用）。
