# Mamep2026

四端（浏览器 / Electron / VSCode 插件 / Android）Modbus 调试工具。单表管理不连续保持寄存器，仅功能码 03 读 / 0x10 写，插件隔离厂商私有功能，不以复刻原 M@MEp2006 界面为目标。

当前状态与详细开发进度见 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)。

**Android 端（第四平台）Phase 1 已落地**（2026-09-10，ADR-050）：Capacitor 8 容器 + WebView 内**同一份共享 UI**，`packages/platform-android` 经 Capacitor 桥把 Modbus TCP 接到原生 `java.net.Socket`（会话仍在 JS，原生只做字节搬运）；真机 e2e（`pnpm test:e2e:android`）TCP 闭环 2/2 全绿；串口（USB-RS485）为 Phase 2，能力矩阵**如实声明**不支持。

**宿主侧插件执行面已实施完成**（2026-09-12，ADR-055）：Electron 主进程 / VSCode Extension Host 改为从**同一份插件存储**加载「已启用 + 同进程」插件并执行（新增 `@mamep2026/platform-node/plugin` 的 `HostPluginRuntime`），使插件贡献的 codec / addressTransform 在宿主会话真正生效；两端对插件包的**静态 import 与依赖已删除**，`hostPlugins` 翻转为 `true`（浏览器 / Android 维持 false）；同步按「集合签名（id + entrySource）变化即全量重建 dataType/addressTransform 注册表」执行，避免卸载 / 禁用插件在宿主侧残留能力。附带修复**生产 CSP**：`script-src` 增加 `blob:`（只放行 `worker-src` 时 Worker 内 / 文档内对 Blob entry 的动态 `import()` 会被拦截 → 可执行插件在四端打包产物中均无法加载，dev e2e 无法暴露）。

> **面向 AI 编码代理**：最小执行入口见 [AGENTS.md](AGENTS.md)；完整开发手册见
> [docs/AGENTS.md](docs/AGENTS.md)，工程现状见
> [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)，命令与排障见
> [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)。

## 技术栈

- TypeScript（strict）+ pnpm 11 monorepo + Turborepo
- React 19 + Vite + Ant Design 6（三端共享同一套 UI）
- 状态管理 Zustand；表单与校验 React Hook Form + Zod
- 浏览器持久化 IndexedDB（idb）；三端统一领域模型与端口适配
- 桌面端：Electron（Main/Preload 安全 IPC）、VSCode 扩展（Extension Host + Webview）、Node 串口库 serialport@13（ADR-020 选型）、Android（Capacitor 8 容器 + WebView 内共享 UI，ADR-050）
- 跨边界消息：HostMessage v1 版本化 Envelope + Zod 校验 + kind 白名单（`packages/platform-api`）
- 测试：Vitest（包内单测）、Playwright（浏览器/Electron/VSCode E2E，浏览器用系统 Edge）、真实端口 e2e（com0com + 从站）

## 仓库结构

- `apps/web/` — 浏览器端（Vite + React），装配平台能力与共享 UI（兼作 Electron Renderer）
- `apps/electron/` — Electron 主进程与 preload（Main/Preload/Renderer 三层 + 版本化安全 IPC，ADR-016）；RTU 复用浏览器 Web Serial、TCP 会话承载主进程（ADR-022）
- `apps/vscode-extension/` — VSCode 扩展：Extension Host（`extension.ts` + `ipc.ts` + `session-host.ts`）经 Webview 加载共享 UI，HostMessage v1 类型化 RPC（ADR-019/021/022）
- `apps/android/` — Android 容器工程（Capacitor 8 + app 内 Kotlin TCP 插件，JDK ≤24 构建；详见 `apps/android/README.md`，ADR-050）
- `packages/` — 分层共享包：`domain`、`protocol-modbus`、`data-conversion`、`communication`、`workspace`、`logging`、`plugin-api`、`register-table`、`platform-api`（HostMessage v1 契约）、`platform-web`、`platform-node`（Node Serial/TCP Adapter）、`platform-android`（Android 适配层：Capacitor 桥契约 + TCP 传输，ADR-050）、`application`（三端共享会话编排 RtuSessionHost/TcpSessionHost）、`ui`、`ui-theme`（平台主题适配层：base 主题 + VSCode 完整令牌映射，ADR-027）、`test-kit`
- `plugins/` — 外部插件（**均需手动安装**，随包不分发安装：`address-adjust`、`yaskawa-memobus-67h-010dh-010eh`、`custom-function-code` 为可执行插件，`example-theme` / `example-panel`（`panels` 贡献示例） / 品牌主题色插件为纯清单插件；用 `pnpm build:plugins` 生成可安装产物到 `release/plugins/`；**禁止新增内置插件**，ADR-045 / ADR-054）
- `config/` — 连接对象配置文件 `connections.json`（测试/验证基建：real e2e 参数与探针，ADR-023/034）
- `scripts/` — 构建/打包/开发辅助（`build-vscode.mjs`、`package-electron.mjs`、`package-vscode.mjs`、`e2e-real.mjs`、`dev-vscode.mjs`、`dev-with-slave.mjs`、`generate-icons.mjs` 等）与 Modbus 从站（`modbus-slave/`：RTU/TCP 共享核心 `lib/modbus-core.mjs`）
- `tests/` — `acceptance`（ATDD 核心闭环）、`e2e-web` / `e2e-electron` / `e2e-vscode`（Playwright，各自含 `tests-real|real` 真实端口套件，ADR-024）、`e2e-android`（真机 TCP e2e：CDP 接 WebView + `adb reverse`，需真机，ADR-050）
- `docs/` — PRD、TECH_DESIGN、RESEARCH、ADR（013~050）、界面特征整理、测试指南、验证记录

## 常用命令（以根 package.json 实际脚本为准）

| 命令                                                          | 作用                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                    | 网页端 Vite dev server（http://localhost:5173），不启动 Electron                                                                                                                                                                                                                                                                                                                        |
| `pnpm dev:electron`                                           | Electron 开发模式（构建主进程/preload 到 `dist-electron/`）                                                                                                                                                                                                                                                                                                                             |
| `pnpm start:electron`                                         | 启动 Electron 窗口（`electron .`）                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm dev:vscode`                                             | VSCode 扩展开发模式（构建并启动 VSCode 窗口，Webview 指向 dev server）                                                                                                                                                                                                                                                                                                                  |
| `pnpm build` / `pnpm build:electron`                          | 构建网页端 / Electron                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm build:vscode`                                           | 构建 VSCode 扩展（共享 UI → `dist/media/`，esbuild 打包 Extension Host 与 bridge）                                                                                                                                                                                                                                                                                                      |
| `pnpm dist:portable`                                          | Electron 免安装绿色版打包（产出 `release/win-unpacked/` 整个文件夹，拷贝即用，ADR-018）                                                                                                                                                                                                                                                                                                 |
| `pnpm dist:vscode`                                            | VSCode 扩展 VSIX 打包（产出 `release/mamep2026-<version>.vsix`，仅打包不发布）                                                                                                                                                                                                                                                                                                          |
| `pnpm build:android`                                          | Android APK 构建（web `--mode android` → `cap sync` → `assembleDebug`；**需 JDK ≤24**，见 `apps/android/README.md`）                                                                                                                                                                                                                                                                    |
| `pnpm test:e2e:android`                                       | Android 真机 e2e（CDP 接 WebView + `adb reverse` 真实 TCP 往返；**需真机 + USB 调试 + 解锁屏幕**，不进 `test:all`）                                                                                                                                                                                                                                                                     |
| `pnpm preview`                                                | 本地预览网页端构建产物（apps/web，`vite preview`）                                                                                                                                                                                                                                                                                                                                      |
| `pnpm lint`                                                   | ESLint（全仓）                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm typecheck`                                              | turbo 全包类型检查                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm test`                                                   | turbo 全包 vitest                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test:all`                                               | **全量回归测试**：一条命令跑完全量（三端真实端口 e2e → 单测 → acceptance → 三端 mock e2e → 虚拟串口 → lint → typecheck；real 缺环境 SKIP 不失败，fail-fast）。**运行本命令前不要先运行任何其他指令**（例如启动 dev server、启动从站等），前置环境由 `e2e-real.mjs` 统一编排；已有手动启动的进程须先清理。各步骤输出逐步骤写入 `test-reports/run-<时间戳>/` 下的独立日志与 `result.json` |
| `pnpm test:acceptance`                                        | 验收测试（ATDD 核心闭环）                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test:e2e:web` / `test:e2e:electron` / `test:e2e:vscode` | 三端 E2E（浏览器系统 Edge / Electron / 真实 VSCode，后两者自动先构建）                                                                                                                                                                                                                                                                                                                  |
| `pnpm test:e2e:real`                                          | 三端「真实端口」e2e 统一编排（com0com + 真实 RTU/TCP 从站，ADR-024；缺环境 SKIP 不失败）                                                                                                                                                                                                                                                                                                |
| `pnpm test:e2e:web:real` / `:electron:real` / `:vscode:real`  | 单独跑某一端真实端口 e2e                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm test:serial:virtual`                                    | Layer 2 com0com 虚拟串口验证（packages/platform-node）                                                                                                                                                                                                                                                                                                                                  |
| `pnpm dev:slave` / `dev:electron:slave` / `dev:vscode:slave`  | 附带启动 Modbus 从站的开发模式                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm slave`                                                  | 启动 Modbus RTU 从站（`scripts/modbus-slave/modbus-rtu-slave.mjs`）                                                                                                                                                                                                                                                                                                                     |
| `pnpm format` / `pnpm format:check`                           | Prettier                                                                                                                                                                                                                                                                                                                                                                                |

> **测试报告/日志**：`test:all` 及单测/acceptance/三端 e2e/虚拟串口/lint/typecheck 等各测试脚本，都会把终端输出 tee 到 `test-reports/run-<时间戳>/` 下**每种测试一个独立 `.log`**，并写入步骤级 `summary.json`；`test:all` 额外写 `result.json`（总体 status + 各步骤、失败步骤）。`test-reports/` 为生成产物，已加入 `.gitignore`。可用 `MAMEP_TEST_ALL_STEPS=<步骤名逗号分隔>` 只跑 `test:all` 的部分步骤（如 `lint,typecheck`）。详见 [docs/features/2026-09-07-测试结果日志收集.md](docs/features/2026-09-07-测试结果日志收集.md)。

## 快速开始

```bash
pnpm install
pnpm dev               # 打开 http://localhost:5173/?mockTransport=1 体验内置模拟 Modbus RTU
pnpm test              # 全包单测
pnpm test:e2e:web      # 浏览器 E2E（Playwright 使用系统 Edge）
pnpm test:all          # 全量回归（一条命令跑完全量；运行前不要启动/运行任何其他指令，如 dev server、从站）
```

> `?mockTransport=1` 启用 dev 内置模拟 Modbus RTU 传输（生产构建不启用），无需真实串口即可调试完整读写/轮询/Trace 闭环。VSCode 端对应 `MAMEP_FAKE_SERIAL=1` / `MAMEP_FAKE_TCP=1`（dev 门控），工作区导入导出闭环对应 `MAMEP_FAKE_DIALOG=1`（假文件对话框，ADR-033）。MOCK/FAKE 均为显式可选手段，不带任何开关即走真实设备（连接参数见 `config/connections.json`）。

### 启动四端

| 端       | 开发启动                                                                                               | 说明                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 浏览器   | `pnpm dev`                                                                                             | 打开 http://localhost:5173/?mockTransport=1                                                    |
| Electron | `pnpm dev:electron` + `pnpm start:electron`                                                            | dev 加载 Vite dev server；生产 `loadFile` 加载 `apps/web/dist-electron/`                       |
| VSCode   | `pnpm dev:vscode`（或先 `pnpm build:vscode`）                                                          | 命令打开 Webview 加载共享 UI；生产加载 `dist/media/` 本地资源                                  |
| Android  | `pnpm build:android` + `adb install -r apps/android/android/app/build/outputs/apk/debug/app-debug.apk` | Capacitor 容器加载 `apps/web/dist-android/`（构建需 JDK ≤24；**不做 `dev:android`**，ADR-050） |

### 打包分发

```bash
pnpm dist:portable   # Electron 免安装绿色版：产出 release/win-unpacked/（含 Mamep2026.exe），整个文件夹拷给同事双击即用
pnpm dist:vscode     # VSCode 插件 VSIX：产出 release/mamep2026-<version>.vsix，供 VSCode 安装
```

Electron 免安装版无需安装包、无需任何环境（Node/pnpm），当前面向 Windows x64，详见 [docs/adr/ADR-018-免安装绿色版打包.md](docs/adr/ADR-018-免安装绿色版打包.md)。VSCode VSIX 仅打包不发布（staging 原因见 `scripts/package-vscode.mjs` 头注释）。

## 文档索引

完整文档索引见 [docs/README.md](docs/README.md)。核心文档：

- [docs/PRD.md](docs/PRD.md) — 产品范围、MVP（P0~P3）、验收
- [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) — 技术设计、三端能力矩阵、测试策略
- [docs/RESEARCH.md](docs/RESEARCH.md) — 调研结论
- [docs/AGENTS.md](docs/AGENTS.md) — 43 节完整开发手册（架构强制规则、Modbus 协议、调度、持久化、错误模型、TDD、禁止行为、完成自检等）
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — 当前工程结构与按日期记录的实施进度
- [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) — 常用命令、环境要求、排坑与测试基础设施
- [docs/adr/](docs/adr/) — 已确认产品决策（ADR-013~038）：monorepo 迁移 / 地址进制 / 行编辑交互 / Electron 骨架与安全 IPC / Web Serial 复用 / 免安装打包 / VSCode 骨架与安全 RPC / 串口库选型 / VSCode RTU 接线 / 两端 TCP 接线 / 连接对象配置文件化（应用侧已移除，ADR-034） / 三端真实端口 e2e / 远程批任务取消与 UI 取消入口 / TCP Unit ID 会话内动态修改 / VSCode 主题完整适配 / 真实端口 e2e 首次全量回归与 HostMessage 错误投影修复 / 写后回读及延迟回读（每表独立 + 首个迁移 v1→v2） / 多寄存器连续读写与范围行（Register 范围 + Type 双列 + 展开子行，实施完成，ADR-030） / 撤销和重做（工作区编辑命令栈，实施完成，ADR-032） / 工作区导入和导出（版本化 JSON 交换格式 + open-text-file kind，实施完成，ADR-033） / 移除 Load from Config File 以工作区导入替代（实施完成，ADR-034） / 自动重连（有限次数 + 指数退避 + 内部默认值 + 状态点 + 最终失败提示，实施完成，ADR-035） / Electron 文件持久化（应用数据目录 JSON + filesystem 能力翻转，实施完成，ADR-036） / 更完整的键盘操作（快捷键注册表 + 两级分发 + Help 总览，实施完成，ADR-037） / 插件安装入口（Plugin Manager 内本地 manifest 安装 + 安全确认 + 三端持久化 + pluginInstall 能力，实施完成，ADR-038） / 插件 Phase D：主题色用户设置 + 表级 Address Adjust（ColorPicker + preferences.themePrimary + 内置 address-adjust 插件 + sheet.addressTransform + session-set-address-transform kind + schema v5→v6，实施完成，ADR-042；**主题色部分 2026-09-02 由 ADR-047 逆转**：移除任意取色 → 内置仅 Ant Design 默认蓝 + 插件注册一个或多个可选主题色 + themePrimary 改预设 ID + schema v7→v8） / 插件 Phase E：P3 精选（基础表 coil/discrete-input/input-register 核心内置 + 自定义功能码示例插件 + 寄存器手册 documentation + dataType 开放 + VSCode codec 接线，实施完成，ADR-043） / 插件 Phase F：可执行插件正式化（卸载 + 隔离机制 Web Worker/worker_threads + 单文件 JS 安装 + executablePlugins 翻转，实施完成，ADR-044） / 浏览器兼容性检测（Web Serial + 安全上下文检测 + 启动横幅 + CONNECT 禁用，实施完成，ADR-046）
- [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) — 浏览器 E2E 工作流与踩坑
- [docs/node-serial-prototype-验证记录.md](docs/node-serial-prototype-验证记录.md) / [docs/node-tcp-adapter-验证记录.md](docs/node-tcp-adapter-验证记录.md) — Node 串口 / TCP Adapter 原型验证记录
- [config/README.md](config/README.md) — 连接对象配置文件（`config/connections.json`）格式（测试/验证基建，应用侧导入由工作区导入承担，ADR-034）
- [scripts/modbus-slave/README.md](scripts/modbus-slave/README.md) — RTU/TCP 从站与共享规则、扩展行为
