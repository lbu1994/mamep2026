# Mamep2026

三端（浏览器 / Electron / VSCode 插件）Modbus 调试工具。单表管理不连续保持寄存器，仅功能码 03 读 / 0x10 写，插件隔离厂商私有功能，不以复刻原 M@MEp2006 界面为目标。

当前状态（2026-08-25）：**三端 RTU + TCP 已接线**——浏览器 Web Serial RTU、Electron 主进程承载 TCP（RTU 复用浏览器路径）、VSCode Extension Host 承载 serialport/net；连接对象配置文件化（`config/connections.json`，ADR-023）；具备三端「真实端口」e2e（com0com + 真实 RTU/TCP 从站，ADR-024）；远程批任务取消与 UI 取消入口（`session-batch-cancel`，ADR-025）。浏览器端不直接支持 Modbus TCP（产品红线，PRD §8.6）。

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
- `packages/` — 分层共享包：`domain`、`protocol-modbus`、`data-conversion`、`communication`、`workspace`、`logging`、`plugin-api`、`register-table`、`platform-api`（HostMessage v1 契约）、`platform-web`、`platform-node`（Node Serial/TCP Adapter）、`application`（三端共享会话编排 RtuSessionHost/TcpSessionHost）、`connection-config`（连接对象配置文件 Zod schema）、`ui`、`test-kit`
- `config/` — 连接对象配置文件 `connections.json`（真实设备连接参数集中管理，ADR-023）
- `scripts/` — 构建/打包/开发辅助（`build-vscode.mjs`、`package-electron.mjs`、`package-vscode.mjs`、`e2e-real.mjs`、`dev-vscode.mjs`、`dev-with-slave.mjs`、`generate-icons.mjs` 等）与 Modbus 从站（`modbus-slave/`：RTU/TCP 共享核心 `lib/modbus-core.mjs`）
- `tests/` — `acceptance`（ATDD 核心闭环）、`e2e-web` / `e2e-electron` / `e2e-vscode`（Playwright，各自含 `tests-real|real` 真实端口套件，ADR-024）
- `docs/` — PRD、TECH_DESIGN、RESEARCH、ADR（013~024）、界面特征整理、测试指南、验证记录

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
| `pnpm test:acceptance`                                        | 验收测试（ATDD 核心闭环）                                                                |
| `pnpm test:e2e:web` / `test:e2e:electron` / `test:e2e:vscode` | 三端 E2E（浏览器系统 Edge / Electron / 真实 VSCode，后两者自动先构建）                   |
| `pnpm test:e2e:real`                                          | 三端「真实端口」e2e 统一编排（com0com + 真实 RTU/TCP 从站，ADR-024；缺环境 SKIP 不失败） |
| `pnpm test:e2e:web:real` / `:electron:real` / `:vscode:real`  | 单独跑某一端真实端口 e2e                                                                 |
| `pnpm test:serial:virtual`                                    | Layer 2 com0com 虚拟串口验证（packages/platform-node）                                   |
| `pnpm dev:slave` / `dev:electron:slave` / `dev:vscode:slave`  | 附带启动 Modbus 从站的开发模式                                                           |
| `pnpm slave`                                                  | 启动 Modbus RTU 从站（`scripts/modbus-slave/modbus-rtu-slave.mjs`）                      |
| `pnpm format` / `pnpm format:check`                           | Prettier                                                                                 |

## 快速开始

```bash
pnpm install
pnpm dev               # 打开 http://localhost:5173/?mockTransport=1 体验内置模拟 Modbus RTU
pnpm test              # 全包单测
pnpm test:e2e:web      # 浏览器 E2E（Playwright 使用系统 Edge）
```

> `?mockTransport=1` 启用 dev 内置模拟 Modbus RTU 传输（生产构建不启用），无需真实串口即可调试完整读写/轮询/Trace 闭环。VSCode 端对应 `MAMEP_FAKE_SERIAL=1` / `MAMEP_FAKE_TCP=1`（dev 门控）。MOCK/FAKE 均为显式可选手段，不带任何开关即走真实设备（连接参数见 `config/connections.json`）。

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
- [docs/adr/](docs/adr/) — 已确认产品决策（ADR-013~025）：monorepo 迁移 / 地址进制 / 行编辑交互 / Electron 骨架与安全 IPC / Web Serial 复用 / 免安装打包 / VSCode 骨架与安全 RPC / 串口库选型 / VSCode RTU 接线 / 两端 TCP 接线 / 连接对象配置文件化 / 三端真实端口 e2e / 远程批任务取消与 UI 取消入口
- [docs/浏览器端自动化测试方法指南.md](docs/浏览器端自动化测试方法指南.md) — 浏览器 E2E 工作流与踩坑
- [docs/node-serial-prototype-验证记录.md](docs/node-serial-prototype-验证记录.md) / [docs/node-tcp-adapter-验证记录.md](docs/node-tcp-adapter-验证记录.md) — Node 串口 / TCP Adapter 原型验证记录
- [config/README.md](config/README.md) — 连接对象配置文件（`config/connections.json`）格式与三端加载方式
- [scripts/modbus-slave/README.md](scripts/modbus-slave/README.md) — RTU/TCP 从站与共享规则、扩展行为

---

## 分阶段 ToDoList

> 依据 [docs/PRD.md](docs/PRD.md)（§8.2–8.6 优先级）与 [docs/adr/](docs/adr/)（ADR-019–025 已知限制 / 真机验证项 / 后续复审条件）整理；以 PRD 与 ADR 为准，需求变更时更新。勾选 `[x]` 表示已完成；`[ ]` 表示未开始；「待真机验证」「部分完成」等在括号内注明。

### 阶段一：近期收尾（遗留已知限制 / 真机验证）

- [x] 三端真实端口 e2e 全量回归（com0com + 真实 RTU/TCP 从站，浏览器需在系统 picker 手动选 COM4 一次）— ADR-024
- [ ] Node Serial Adapter 真机验证：COM10+ 真机、macOS / Linux、Electron / VSCode 打包后原生模块（serialport）加载 — ADR-020 / ADR-021（待真机验证）
- [x] 远程批任务取消（Electron TCP / VSCode `readAllRows` cancel 语义补全：渲染端生成 batchId + `session-batch-cancel` RPC + UI 取消入口，接口契约不变）— ADR-025（ADR-021/022 已知限制已解决）
- [x] VSCode 端 `readAllRows` cancel 补全（与 TCP 同一远程路径，ADR-025 一并解决）— ADR-021 已知限制
- [ ] TCP Unit ID 会话内动态修改（当前宿主已守卫，工具栏从站地址对 TCP 无效）— ADR-022 已知限制
- [ ] 浏览器真实端口 e2e 免手动选口（dev-only 自动恢复钩子 `getPorts` 匹配记录，ADR-024 备选方案）— ADR-024
- [ ] VSCode 主题完整适配（light/dark 两态 → 完整主题令牌映射，ui-theme）— ADR-019 后续复审条件

### 阶段二：V1.0 正式版（PRD §8.3 P1）

- [ ] 写后回读及延迟回读 — PRD §8.3
- [ ] 批量任务结果统计 — PRD §8.3
- [ ] 日志搜索、过滤和导出 — PRD §8.3
- [ ] 撤销和重做（行编辑基础已在 MVP，ADR-015；撤销/重做未实现）— PRD §8.3（部分完成）
- [ ] 工作区导入和导出 — PRD §8.3
- [ ] 自动重连（TCP profile 字段已就绪、UI 灰显占位）— PRD §8.3 / ADR-022（部分完成）
- [ ] Electron 文件持久化（应用数据目录 JSON 存储，`filesystem` 能力翻转）— PRD §8.3 / ADR-019 复审条件
- [ ] 更完整的键盘操作 — PRD §8.3
- [ ] 插件安装入口 — PRD §8.3
- [ ] 安川公开协议示例插件 — PRD §8.3
- [ ] 浏览器兼容性检测 — PRD §8.3
- [ ] 崩溃后的状态恢复 — PRD §8.3
- [ ] 更新检查（Electron 后续支持，VSCode 由 VSCode 管理）— PRD §8.3 / TECH_DESIGN §7 能力矩阵
- [ ] 完整用户帮助 — PRD §8.3

### 阶段三：V1.x 增强与探索（PRD §8.4 P2 / §8.5 P3）

**P2 增强（PRD §8.4）**

- [ ] Register Trace（MVP 已有 TM 追踪窗，此为完整形态）
- [ ] 数据曲线
- [ ] 数据导出
- [ ] Register Dump
- [ ] Register Sequence
- [ ] CRC16 Calculator
- [ ] 寄存器手册插件
- [ ] 配置模板
- [ ] 标签页分组
- [ ] 项目或工作区文件
- [ ] 寄存器表 CSV 导入导出
- [ ] 配置差异比较
- [ ] 32 位整数 / 32 位浮点数
- [ ] 多寄存器组合类型
- [ ] 字节序和字序配置
- [ ] 多活动连接
- [ ] 每个标签页独立连接
- [ ] 每行独立从站地址
- [ ] 自定义波特率
- [ ] 更细粒度的轮询调度

**P3 探索 / 插件化（PRD §8.5）**

- [ ] 线圈表
- [ ] 离散输入表
- [ ] 输入寄存器表
- [ ] 自定义功能码
- [ ] 厂商私有协议
- [ ] 自动化测试序列
- [ ] 脚本化调试
- [ ] 寄存器波形高级分析
- [ ] 团队配置共享
- [ ] 远程代理方式的浏览器 Modbus TCP（注：浏览器**不直接支持** Modbus TCP 为产品红线，此 P3 项为「远程代理方式」，实施前需先经产品决策 / ADR 确认）
- [ ] 插件市场
- [ ] Memory Access
- [ ] 设备描述文件
- [ ] 多设备并行监控

**明确不计划实现（PRD §8.6，非待办）**：RPN Calculator、M@MEp2006 老式品牌 / 授权信息区 / 访问计数器 / 老式 Win32 顶层菜单、无提示的设备危险写入、为视觉复刻而保留的无实际价值控件。
