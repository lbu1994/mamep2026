# Mamep2026

三端（浏览器 / Electron / VSCode 插件）Modbus 调试工具。单表管理不连续保持寄存器，仅功能码 03 读 / 0x10 写，插件隔离厂商私有功能，不以复刻原 M@MEp2006 界面为目标。

> **面向 AI 编码代理**：工作入口与速览见 [AGENTS.md](AGENTS.md)；完整 43 节开发手册见 [docs/AGENTS.md](docs/AGENTS.md)。

## 技术栈

- TypeScript（strict）+ pnpm 11 monorepo + Turborepo
- React 19 + Vite + Ant Design 6（三端共享同一套 UI）
- 状态管理 Zustand；表单与校验 React Hook Form + Zod
- 浏览器持久化 IndexedDB（idb）；三端统一领域模型与端口适配
- 测试：Vitest（包内单测）、Playwright（浏览器 E2E，系统 Edge）

## 仓库结构

- `apps/web/` — 浏览器端（Vite + React），装配平台能力与共享 UI（兼作 Electron Renderer）
- `apps/electron/` — Electron 主进程与 preload（Main/Preload/Renderer 三层 + 版本化安全 IPC，ADR-016）
- `packages/` — 分层共享包：`domain`、`protocol-modbus`、`data-conversion`、`communication`、`workspace`、`logging`、`plugin-api`、`register-table`、`platform-api`、`platform-web`、`ui`、`test-kit`
- `tests/` — `acceptance`（ATDD 核心闭环）与 `e2e-web`（Playwright）
- `vscode-extension/` — VSCode 插件（本轮仅保证编译不破坏）
- `docs/` — PRD、TECH_DESIGN、RESEARCH、ADR、界面特征整理、测试指南

## 常用命令

| 命令                                         | 作用                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                                   | 网页端 Vite dev server（http://localhost:5173），不启动 Electron |
| `pnpm dev:electron`                          | Electron 开发模式（构建主进程/preload 到 `dist-electron/`）      |
| `pnpm start:electron`                        | 启动 Electron 窗口（`electron .`）                               |
| `pnpm build` / `pnpm build:electron`         | 构建网页端 / Electron                                            |
| `pnpm build:vscode`                          | 编译 `vscode-extension/`                                         |
| `pnpm preview`                               | 本地预览网页端构建产物（apps/web，`vite preview`）               |
| `pnpm lint`                                  | ESLint（全仓）                                                   |
| `pnpm typecheck`                             | turbo 全包类型检查                                               |
| `pnpm test`                                  | turbo 全包 vitest                                                |
| `pnpm test:acceptance` / `pnpm test:e2e:web` | 单独跑对应测试包                                                 |
| `pnpm test:e2e:electron`                     | Electron E2E（自动先构建，Playwright 启动窗口断言）             |
| `pnpm format` / `pnpm format:check`          | Prettier                                                         |

## 快速开始

```bash
pnpm install
pnpm dev               # 打开 http://localhost:5173/?mockTransport=1 体验内置模拟 Modbus RTU
pnpm test              # 全包单测
pnpm test:e2e:web      # 浏览器 E2E（Playwright 使用系统 Edge）
```

> `?mockTransport=1` 启用 dev 内置模拟 Modbus RTU 传输（生产构建不启用），无需真实串口即可调试完整读写/轮询/Trace 闭环。

## 文档地图

完整文档地图见 [AGENTS.md](AGENTS.md) 的「文档地图」一节。核心文档：

- [docs/PRD.md](docs/PRD.md) — 产品范围、MVP（P0~P3）、验收
- [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) — 技术设计、ADR、三端能力矩阵、测试策略
- [docs/RESEARCH.md](docs/RESEARCH.md) — 调研结论
- [docs/adr/](docs/adr/) — 已确认产品决策（ADR-013~015）
- [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) — 浏览器 E2E 工作流与踩坑
