# Mamep2026

三端（浏览器 / Electron / VSCode 插件）Modbus 调试工具。单表管理不连续保持寄存器，仅功能码 03 读 / 0x10 写，插件隔离厂商私有功能，不以复刻原 M@MEp2006 界面为目标。

当前状态（2026-08-27）：**三端 RTU + TCP 已接线**——浏览器 Web Serial RTU、Electron 主进程承载 TCP（RTU 复用浏览器路径）、VSCode Extension Host 承载 serialport/net；连接对象配置文件 `config/connections.json` 保留供测试/探针（ADR-023/034）；具备三端「真实端口」e2e（com0com + 真实 RTU/TCP 从站，ADR-024）；远程批任务取消与 UI 取消入口（`session-batch-cancel`，ADR-025）；TCP Unit ID 会话内动态修改（每表独立 + 工具栏按协议切换，`session-set-unit-id`，ADR-026）；**VSCode 主题完整适配**（`packages/ui-theme` 完整主题令牌映射：中性色跟随 VSCode + 品牌/状态保留，生产 CSS 变量取色 + dev iframe 中继，协议零改动，ADR-027）；**真实端口 e2e 首次全绿与 HostMessage 错误投影 bug 修复**（2026-08-25，ADR-028：ADR-024 落地后实际未跑通，全量回归修复多层问题含两端 ipc `errorEnvelope` 硬编码错误 key，web 12 / electron 24 / vscode 3 全绿）；**写后回读及延迟回读**（2026-08-26，ADR-029：每表独立配置 + 工具栏 Select + 默认 ON 立即回读，`WriteOutcome` 扩展 5 种 verify 结果，`WriteVerifyCoordinator`，写入期间暂缓同表行轮询，首个工作区迁移 v1→v2 把全局 `readVerifySettings` 迁移到各表）。**多寄存器连续读写（范围行）已实施完成**（2026-08-27，ADR-030：Register 范围输入 + Type 拆「进制 + scale」两列 + 范围行树形展开子行，支持 32/64 位整数与 ASCII 字符串，三端落地，见 README 分阶段 ToDoList 已勾选）。**撤销和重做已实施完成**（2026-08-28，ADR-032：工作区编辑命令栈——行级编辑 + 每表配置 + 表结构性操作，工具栏按钮 + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键，Data 编辑/设备读值/连接等不入栈，与 ADR-015 删除不弹窗决策兼容）。**工作区导入和导出已实施完成**（2026-08-29，ADR-033：版本化 JSON 公开交换格式复用 serializeWorkspace/parseWorkspace（含 v1→v4 迁移），Settings 弹窗入口 + 导入预览 Modal；导出复用 save-text-file（浏览器 Blob / 桌面端保存对话框），桌面端导入新增 HostMessage v1 `open-text-file` kind（打开对话框读 UTF-8，取消返回 content:null 非错误），浏览器走客户端文件选择；能力矩阵新增 workspaceImport/workspaceExport）。**自动重连已实施完成**（2026-08-30，ADR-035：TCP 断线自动重连——Application 层 `ReconnectCoordinator`（有限次数 + 指数退避，内部默认值入 defaultConfig），UI Switch 启用 + 状态点 + 最终失败提示，Electron/VSCode 注入 openTransport，dev 探针 `debug:fake-tcp-drop`，三端 e2e 全绿）。**Electron 文件持久化已实施完成**（2026-08-30，ADR-036：工作区持久化由 Renderer IndexedDB 替换为主进程应用数据目录版本化 JSON——`WorkspaceFileRepository`（原子保存 + 单份 .bak 轮转 + 损坏从备份自愈写回），新增 HostMessage v1 `workspace-load/workspace-save/workspace-clear` kind，Renderer `FileWorkspaceRepository` 薄桥，`electronCapabilities.filesystem` 翻转为 `"full"`，e2e 经 `MAMEP_USER_DATA_DIR` 隔离 userData，浏览器/VSCode 零改动）。**更完整的键盘操作已实施完成**（2026-08-30，ADR-037：快捷键注册表单一事实源 + 两级分发——app 级 `Ctrl+,`/`Ctrl+Enter`/`Ctrl+/`/`?`/`Ctrl+[`·`Ctrl+]`/`Ctrl+Alt+N/W/O/T/L`/`Ctrl+Shift+S`、表格级 `F9`/`F8`/`Ctrl+Shift+Enter`/`Alt+P`/`↑↓`/`Ctrl+Alt+R`；规避浏览器保留键、三端一致；焦点在文本输入/弹窗打开时抑制；Help 弹窗扩展为快捷键总览（`?`/`Ctrl+/` 打开）；`row-io`/`useWorkspaceTransfer` 抽取消除按钮与快捷键逻辑复制）。**插件安装入口已实施完成**（2026-08-30，ADR-038：Plugin Manager 弹窗内「Install Plugin」——本地 manifest JSON 选择（浏览器客户端文件选择 / 桌面端 `open-text-file` 对话框）→ `pluginManifestSchema` 校验 → §6.10.4 安全确认（来源/版本/权限/平台/风险）→ `PluginRegistry.register(manifest, {source:"installed"})` 仅清单注册零代码执行；能力矩阵新增 `pluginInstall`（browser `upload` / Electron·VSCode `file`）；已安装插件 + 启用状态 app 级持久化（浏览器 IndexedDB / Electron userData `plugins.json` 原子保存 + .bak / VSCode `context.globalState`），HostMessage v1 新增 `plugin-store-load/save` kind，`PluginPersistenceCoordinator` 启动 hydrate + 事件落盘，内置示例插件不持久化）。**插件 Phase D：主题色（2026-09-02 按 ADR-047 逆转）+ 表级 Address Adjust 已实施完成**（2026-09-01，ADR-042：Settings 弹窗浅/深 ColorPicker 持久化 `workspace.preferences.themePrimary`；**默认主题色改为运行时跟随 Ant Design 默认色已实施完成**（2026-09-02，ADR-048：`buildTheme` 品牌色组改由 antd 公开 API `theme.getDesignToken({ algorithm })` 运行时获取，index.css 品牌令牌映射 antd cssVar（`.ant-app` 作用域 `var(--ant-color-primary)`），antd 仅改颜色值即自动跟随、零代码修改；link hover/active 对齐 antd 派生值，暗色 focus-ring `#6ba1ff` 兜底移除；插件主题色/持久化/能力矩阵/协议层零改动）（装配优先级 插件 → 用户 → 默认，AA 白字对比度校验不达标回退并警告），`index.css` 品牌色第二事实源改为主题装配注入；**2026-09-02 ADR-047：移除任意取色 → 内置仅 Ant Design 默认蓝（#1677ff 浅 / #1668dc 暗）+ 插件经 theme 贡献点注册一个或多个可选主题色（Settings Select，预设自带浅/深两态，不再自动应用，禁用/卸载后回退默认）+ themePrimary 改预设 ID + schema v7→v8 迁移**；Address Adjust 移出核心（删除 Connection Settings 全局项），改为内置 `address-adjust` 插件贡献 + 每表工具栏 Segmented 配置 + `sheet.addressTransform` 随工作区持久化（workspace schema v5→v6 迁移把旧全局 `profile.addressAdjust` 复制到各表）+ 读/写/轮询按表应用 + HostMessage v1 新 kind `session-set-address-transform`（VSCode host 端会话同步））。**浏览器兼容性检测已实施完成**（2026-09-02，ADR-046：Web Serial 存在性 + 安全上下文检测（`detectBrowserCompatibility`，domain 类型 + platform-web 纯函数）；启动级横幅 `BrowserCompatibilityBanner`（明确提示 + Chromium/桌面端替代方案）；连接弹窗警告增强 + 检测失败禁用 CONNECT（PRD §15.7「不得执行不可用的串口操作」）；`AppHost.browserCompatibility`（桌面端 null）；dev 门控 `?compatMiss=1` 覆盖供 e2e，`browser-compat.spec` 驱动）。浏览器端不直接支持 Modbus TCP（产品红线，PRD §8.6）。

> **面向 AI 编码代理**：工作入口与速览见 [AGENTS.md](AGENTS.md)；完整 43 节开发手册见 [docs/AGENTS.md](docs/AGENTS.md)。

## 技术栈

- TypeScript（strict）+ pnpm 11 monorepo + Turborepo
- React 19 + Vite + Ant Design 6（三端共享同一套 UI）
- 状态管理 Zustand；表单与校验 React Hook Form + Zod
- 浏览器持久化 IndexedDB（idb）；三端统一领域模型与端口适配
- 桌面端：Electron（Main/Preload 安全 IPC）、VSCode 扩展（Extension Host + Webview）、Node 串口库 serialport@13（ADR-020 选型）
- 跨边界消息：HostMessage v1 版本化 Envelope + Zod 校验 + kind 白名单（`packages/platform-api`）
- 测试：Vitest（包内单测）、Playwright（浏览器/Electron/VSCode E2E，浏览器用系统 Edge）、真实端口 e2e（com0com + 从站）

## 仓库结构

- `apps/web/` — 浏览器端（Vite + React），装配平台能力与共享 UI（兼作 Electron Renderer）
- `apps/electron/` — Electron 主进程与 preload（Main/Preload/Renderer 三层 + 版本化安全 IPC，ADR-016）；RTU 复用浏览器 Web Serial、TCP 会话承载主进程（ADR-022）
- `apps/vscode-extension/` — VSCode 扩展：Extension Host（`extension.ts` + `ipc.ts` + `session-host.ts`）经 Webview 加载共享 UI，HostMessage v1 类型化 RPC（ADR-019/021/022）
- `packages/` — 分层共享包：`domain`、`protocol-modbus`、`data-conversion`、`communication`、`workspace`、`logging`、`plugin-api`、`register-table`、`platform-api`（HostMessage v1 契约）、`platform-web`、`platform-node`（Node Serial/TCP Adapter）、`application`（三端共享会话编排 RtuSessionHost/TcpSessionHost）、`ui`、`ui-theme`（平台主题适配层：base 主题 + VSCode 完整令牌映射，ADR-027）、`test-kit`
- `plugins/` — 外部插件（随应用分发、首次启动一次性安装：`example-panel`、`address-adjust`、`yaskawa-memobus-67h-010dh-010eh`、`custom-function-code`；`example-theme` 为**手动安装示例**不随包；**禁止新增内置插件**，ADR-045）
- `config/` — 连接对象配置文件 `connections.json`（测试/验证基建：real e2e 参数与探针，ADR-023/034）
- `scripts/` — 构建/打包/开发辅助（`build-vscode.mjs`、`package-electron.mjs`、`package-vscode.mjs`、`e2e-real.mjs`、`dev-vscode.mjs`、`dev-with-slave.mjs`、`generate-icons.mjs` 等）与 Modbus 从站（`modbus-slave/`：RTU/TCP 共享核心 `lib/modbus-core.mjs`）
- `tests/` — `acceptance`（ATDD 核心闭环）、`e2e-web` / `e2e-electron` / `e2e-vscode`（Playwright，各自含 `tests-real|real` 真实端口套件，ADR-024）
- `docs/` — PRD、TECH_DESIGN、RESEARCH、ADR（013~045）、界面特征整理、测试指南、验证记录

## 常用命令（以根 package.json 实际脚本为准）

| 命令                                                          | 作用                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                                                    | 网页端 Vite dev server（http://localhost:5173），不启动 Electron                         |
| `pnpm dev:electron`                                           | Electron 开发模式（构建主进程/preload 到 `dist-electron/`）                              |
| `pnpm start:electron`                                         | 启动 Electron 窗口（`electron .`）                                                       |
| `pnpm dev:vscode`                                             | VSCode 扩展开发模式（构建并启动 VSCode 窗口，Webview 指向 dev server）                   |
| `pnpm build` / `pnpm build:electron`                          | 构建网页端 / Electron                                                                    |
| `pnpm build:vscode`                                           | 构建 VSCode 扩展（共享 UI → `dist/media/`，esbuild 打包 Extension Host 与 bridge）       |
| `pnpm dist:portable`                                          | Electron 免安装绿色版打包（产出 `release/win-unpacked/` 整个文件夹，拷贝即用，ADR-018）  |
| `pnpm dist:vscode`                                            | VSCode 扩展 VSIX 打包（产出 `release/mamep2026-<version>.vsix`，仅打包不发布）           |
| `pnpm preview`                                                | 本地预览网页端构建产物（apps/web，`vite preview`）                                       |
| `pnpm lint`                                                   | ESLint（全仓）                                                                           |
| `pnpm typecheck`                                              | turbo 全包类型检查                                                                       |
| `pnpm test`                                                   | turbo 全包 vitest                                                                        |
| `pnpm test:all`                                               | **全量回归测试**：一条命令跑完全量（三端真实端口 e2e → 单测 → acceptance → 三端 mock e2e → 虚拟串口 → lint → typecheck；real 缺环境 SKIP 不失败，fail-fast）。**运行本命令前不要先运行任何其他指令**（例如启动 dev server、启动从站等），前置环境由 `e2e-real.mjs` 统一编排；已有手动启动的进程须先清理。各步骤输出逐步骤写入 `test-reports/run-<时间戳>/` 下的独立日志与 `result.json` |
| `pnpm test:acceptance`                                        | 验收测试（ATDD 核心闭环）                                                                |
| `pnpm test:e2e:web` / `test:e2e:electron` / `test:e2e:vscode` | 三端 E2E（浏览器系统 Edge / Electron / 真实 VSCode，后两者自动先构建）                   |
| `pnpm test:e2e:real`                                          | 三端「真实端口」e2e 统一编排（com0com + 真实 RTU/TCP 从站，ADR-024；缺环境 SKIP 不失败） |
| `pnpm test:e2e:web:real` / `:electron:real` / `:vscode:real`  | 单独跑某一端真实端口 e2e                                                                 |
| `pnpm test:serial:virtual`                                    | Layer 2 com0com 虚拟串口验证（packages/platform-node）                                   |
| `pnpm dev:slave` / `dev:electron:slave` / `dev:vscode:slave`  | 附带启动 Modbus 从站的开发模式                                                           |
| `pnpm slave`                                                  | 启动 Modbus RTU 从站（`scripts/modbus-slave/modbus-rtu-slave.mjs`）                      |
| `pnpm format` / `pnpm format:check`                           | Prettier                                                                                 |

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

### 启动三端

| 端       | 开发启动                                      | 说明                                                                     |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| 浏览器   | `pnpm dev`                                    | 打开 http://localhost:5173/?mockTransport=1                              |
| Electron | `pnpm dev:electron` + `pnpm start:electron`   | dev 加载 Vite dev server；生产 `loadFile` 加载 `apps/web/dist-electron/` |
| VSCode   | `pnpm dev:vscode`（或先 `pnpm build:vscode`） | 命令打开 Webview 加载共享 UI；生产加载 `dist/media/` 本地资源            |

### 打包分发

```bash
pnpm dist:portable   # Electron 免安装绿色版：产出 release/win-unpacked/（含 Mamep2026.exe），整个文件夹拷给同事双击即用
pnpm dist:vscode     # VSCode 插件 VSIX：产出 release/mamep2026-<version>.vsix，供 VSCode 安装
```

Electron 免安装版无需安装包、无需任何环境（Node/pnpm），当前面向 Windows x64，详见 [docs/adr/ADR-018-免安装绿色版打包.md](docs/adr/ADR-018-免安装绿色版打包.md)。VSCode VSIX 仅打包不发布（staging 原因见 `scripts/package-vscode.mjs` 头注释）。

## 文档地图

完整文档地图见 [AGENTS.md](AGENTS.md) 的「文档地图」一节。核心文档：

- [docs/PRD.md](docs/PRD.md) — 产品范围、MVP（P0~P3）、验收
- [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md) — 技术设计、三端能力矩阵、测试策略
- [docs/RESEARCH.md](docs/RESEARCH.md) — 调研结论
- [docs/AGENTS.md](docs/AGENTS.md) — 43 节完整开发手册（架构强制规则、Modbus 协议、调度、持久化、错误模型、TDD、禁止行为、完成自检等）
- [docs/adr/](docs/adr/) — 已确认产品决策（ADR-013~038）：monorepo 迁移 / 地址进制 / 行编辑交互 / Electron 骨架与安全 IPC / Web Serial 复用 / 免安装打包 / VSCode 骨架与安全 RPC / 串口库选型 / VSCode RTU 接线 / 两端 TCP 接线 / 连接对象配置文件化（应用侧已移除，ADR-034） / 三端真实端口 e2e / 远程批任务取消与 UI 取消入口 / TCP Unit ID 会话内动态修改 / VSCode 主题完整适配 / 真实端口 e2e 首次全量回归与 HostMessage 错误投影修复 / 写后回读及延迟回读（每表独立 + 首个迁移 v1→v2） / 多寄存器连续读写与范围行（Register 范围 + Type 双列 + 展开子行，实施完成，ADR-030） / 撤销和重做（工作区编辑命令栈，实施完成，ADR-032） / 工作区导入和导出（版本化 JSON 交换格式 + open-text-file kind，实施完成，ADR-033） / 移除 Load from Config File 以工作区导入替代（实施完成，ADR-034） / 自动重连（有限次数 + 指数退避 + 内部默认值 + 状态点 + 最终失败提示，实施完成，ADR-035） / Electron 文件持久化（应用数据目录 JSON + filesystem 能力翻转，实施完成，ADR-036） / 更完整的键盘操作（快捷键注册表 + 两级分发 + Help 总览，实施完成，ADR-037） / 插件安装入口（Plugin Manager 内本地 manifest 安装 + 安全确认 + 三端持久化 + pluginInstall 能力，实施完成，ADR-038） / 插件 Phase D：主题色用户设置 + 表级 Address Adjust（ColorPicker + preferences.themePrimary + 内置 address-adjust 插件 + sheet.addressTransform + session-set-address-transform kind + schema v5→v6，实施完成，ADR-042；**主题色部分 2026-09-02 由 ADR-047 逆转**：移除任意取色 → 内置仅 Ant Design 默认蓝 + 插件注册一个或多个可选主题色 + themePrimary 改预设 ID + schema v7→v8） / 插件 Phase E：P3 精选（基础表 coil/discrete-input/input-register 核心内置 + 自定义功能码示例插件 + 寄存器手册 documentation + dataType 开放 + VSCode codec 接线，实施完成，ADR-043） / 插件 Phase F：可执行插件正式化（卸载 + 隔离机制 Web Worker/worker_threads + 单文件 JS 安装 + executablePlugins 翻转，实施完成，ADR-044） / 浏览器兼容性检测（Web Serial + 安全上下文检测 + 启动横幅 + CONNECT 禁用，实施完成，ADR-046）
- [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) — 浏览器 E2E 工作流与踩坑
- [docs/node-serial-prototype-验证记录.md](docs/node-serial-prototype-验证记录.md) / [docs/node-tcp-adapter-验证记录.md](docs/node-tcp-adapter-验证记录.md) — Node 串口 / TCP Adapter 原型验证记录
- [config/README.md](config/README.md) — 连接对象配置文件（`config/connections.json`）格式（测试/验证基建，应用侧导入由工作区导入承担，ADR-034）
- [scripts/modbus-slave/README.md](scripts/modbus-slave/README.md) — RTU/TCP 从站与共享规则、扩展行为
