# AGENTS.md — Mamep2026 AI 代理工作规范

本文件是 Mamep2026 仓库的代理工作入口，适用于代码、测试、构建、文档、配置和发布
相关任务。开始工作前先阅读本文件，再按任务范围查阅相应源码与模块文档。

项目说明见 [README](README.md)，架构导航见
[系统设计总览](docs/architecture/总览.md)，开发命令和环境排障见
[开发指南](docs/DEVELOPMENT_GUIDE.md)，产品范围见 [PRD](docs/ref/PRD.md)。

## 1. 项目定位

Mamep2026 是面向嵌入式开发、协议调试和设备测试的跨平台 Modbus 工具。它用于
研发与测试，不承担工业生产控制、功能安全、SCADA 或无人值守监控职责。

四个运行平台：

| 平台     | Modbus RTU | Modbus TCP | 主要说明                                       |
| -------- | ---------- | ---------- | ---------------------------------------------- |
| 浏览器   | 支持       | 不支持     | Web Serial + IndexedDB；不得实现浏览器直连 TCP |
| Electron | 支持       | 支持       | Renderer RTU；TCP、文件持久化和宿主插件在 Main |
| VSCode   | 支持       | 支持       | RTU、TCP、持久化和宿主插件在 Extension Host    |
| Android  | 支持       | 支持       | Capacitor WebView；原生层只提供受控传输能力    |

共享界面、领域模型、协议、调度和工作区语义位于 monorepo。厂商私有协议、数据格式、
地址变换和专用表类型通过插件贡献点扩展，不写入通用核心。

终端默认使用 Windows PowerShell。命令、路径和环境变量均按 PowerShell 语法执行。

## 2. 指令与事实来源

冲突按以下优先级处理：

1. 用户在当前任务中的明确指令；
2. 已确认的产品决策、架构决策和验收条件；
3. 本文件；
4. 当前架构文档与 PRD；
5. 原版资料和研究记录；
6. 现有实现与测试所表达的行为；
7. 代理的推断。

规则：

- PRD 描述产品意图，架构文档描述已确认的技术设计，代码描述当前实现；三者不一致时
  不得静默选择，应指出差异并按风险询问用户。
- 不能用“现有代码已经这样”推翻明确的产品或架构约束。
- 不能从旧版资料、界面截图或第三方工具名称推断未确认的协议规则。
- `docs/DEVELOPMENT_GUIDE.md` 是命令和环境细节的主要入口；命令最终以根
  `package.json` 及各包脚本为准。
- 如果文档链接、文件路径或历史 ADR 引用已失效，以实际检出内容为准，并在改动范围内
  顺手修复相关引用。

## 3. 任务分类与执行方式

### 开发任务

包括修改产品代码、共享包、测试、构建/运行配置、协议/数据行为、插件接口或交付产物。

执行顺序：

1. **定位**：确认目标、验收条件、所属模块、影响的平台和直接相关测试。
2. **阅读**：读取目标文件附近的实现、类型、测试和对应架构文档。
3. **设计**：选择最小可行改动；说明关键取舍、风险和验证方式。
4. **实现**：集中修改必要文件，保持单一职责，不夹带无关重构和格式化。
5. **验证**：按风险执行可用的针对性检查；如实报告命令、结果和未执行项。
6. **交付**：总结行为变化、影响面、验证结果和剩余风险。

以下情况必须暂停当前方向的实现，先向用户确认：

- 任务目标或验收标准有多种合理解释；
- 需要改变产品范围、协议语义、持久化格式、插件 API 或平台能力；
- 需要迁移已有用户数据、删除数据、改变兼容性承诺或进行不可逆操作；
- 文档、代码和测试之间存在实质冲突，且没有可靠的事实来源；
- 必须修改共享核心或多个平台，但用户只授权了局部范围。

普通、明确、局部且可逆的修复不需要为了流程而重复输出需求确认和完整计划；可以在
同一次工作中先说明假设与影响面，再直接完成。跨模块、跨平台、协议、安全、持久化或
高回归风险变更，应在修改前给出简短计划并等待用户确认。

### 非开发任务

解释、审查、只读分析、文档整理、提示词和维护工具配置可直接执行。若同时包含实现
修改，只对实现部分应用开发流程，并在交付时说明边界。

## 4. 按任务定位资料

修改前至少阅读直接相关的实现、类型定义、测试和模块文档。跨边界任务再按以下索引补充：

- **总体结构、分层和依赖**：
  [系统设计总览](docs/architecture/总览.md)、
  [Domain 总则](docs/architecture/domain/总则.md)、
  [Application 总则](docs/architecture/application/用例编排.md)、
  [Ports 总则](docs/architecture/ports/总则.md)。
- **Modbus、RTU/TCP、分帧和功能码**：
  [协议设计](docs/architecture/domain/protocol-modbus/协议设计.md)、
  [传输契约](docs/architecture/ports/transport/传输契约.md)。
- **请求队列、超时、重试、轮询和读写**：
  [调度与轮询](docs/architecture/application/communication/调度与轮询.md)、
  [会话与连接](docs/architecture/application/communication/会话与连接.md)、
  [读写流程](docs/architecture/application/communication/读写流程.md)。
- **平台能力、宿主和安全边界**：
  [能力矩阵](docs/architecture/ports/platform-api/能力矩阵.md)、
  [平台契约](docs/architecture/ports/platform-api/平台契约.md)、
  [Host 总则](docs/architecture/host/总则.md)、
  [安全边界](docs/architecture/host/security/安全边界.md)。
- **界面、状态和主题**：
  [Presentation 总则](docs/architecture/presentation/总则.md)、
  [共享界面](docs/architecture/presentation/ui/共享界面.md)、
  [状态管理](docs/architecture/presentation/state/状态管理.md)。
- **工作区、导入导出和迁移**：
  [工作区](docs/architecture/application/workspace/工作区.md)、
  [导入导出](docs/architecture/application/workspace/导入导出.md)、
  [仓储契约](docs/architecture/ports/workspace/仓储契约.md)。
- **插件**：
  [插件契约](docs/architecture/ports/plugin-api/插件契约.md)、
  [安全边界](docs/architecture/host/security/安全边界.md)。
- **测试、构建和发布**：
  [开发指南](docs/DEVELOPMENT_GUIDE.md)、
  [测试架构](docs/architecture/quality/testing/测试架构.md)、
  [构建与发布](docs/architecture/quality/build/构建与发布.md)。

常用代码归属：

- `apps/web/`：浏览器应用、Electron Renderer，以及 VSCode/Android 共用 UI 构建源。
- `apps/electron/`：Electron Main、preload、TCP 会话和桌面持久化。
- `apps/vscode-extension/`：VSCode Extension Host 与 Webview 桥。
- `apps/android/`：Capacitor 容器和 Android 原生工程。
- `packages/`：领域、协议、通信、插件 API、平台适配、UI 和测试工具包。
- `plugins/`：独立安装的示例与厂商扩展。
- `tests/`：验收测试和四端 E2E 测试。
- `scripts/`：开发、构建、打包、测试编排和模拟从站。
- `config/`：真实设备联调参数，不是用户连接配置入口。

跨包引用只能使用对方公开导出，不得通过相对路径穿透到另一个包的内部 `src/`。

## 5. 强制工程约束

### 产品与协议

- 不擅自增加功能、表类型、功能码、广播写入或未确认的兼容行为。
- 通用保持寄存器路径以 FC03 读取、FC10（0x10）写入；其他表类型使用各自已确认的核心
  codec，插件协议通过稳定贡献点提供。
- 厂商私有帧、CRC/校验规则、地址变换和专用数据类型只进入插件，不得硬编码到通用核心。
- 浏览器端不得直接实现 Modbus TCP；`browserCapabilities.modbusTcp` 必须保持如实声明。
- 所有设备请求必须进入统一调度器；插件、轮询、批量读取和手动操作不得各自直写 Transport。
- 同一连接不得并发发送请求。断开后不得继续提交新请求，取消后不得启动遗留在途的工作。
- 迟到响应、旧 Generation 响应或已删除行的响应不得污染当前表格和日志关联。
- 读取失败不得清空现有 Data；写入失败不得伪装成功；失败后不得自动覆盖用户输入。
- 轮询不得产生写请求，工作区恢复和插件启用不得自动连接或写入设备。

### 分层与平台边界

- UI 不得直接访问串口、TCP、文件系统、Node.js 或原生平台 API。
- 平台副作用集中在 Adapter 或 Host；领域规则不得依赖 React、Electron、VSCode、
  Capacitor 或浏览器全局对象。
- Electron 保持 Main/Preload/Renderer 隔离，不向 Renderer 暴露通用 Node.js 能力。
- VSCode 资源必须经 `asWebviewUri()` 授权，生产 Webview 不得依赖 dev server。
- Android 原生桥调用只能出现在 `packages/platform-android`、`apps/android` 及 Web 端
  对应平台宿主装配边界；不得把会话、调度、CRC 或 Modbus 语义下沉到原生层。
- 不得为了 Android 翻动浏览器能力位，或让 Android 复用浏览器的 Web Serial 兼容语义。
- 平台能力必须真实声明；不能靠捕获“API 不存在”来探测能力。

### 跨边界数据与持久化

- 跨进程、跨 Webview 和跨平台消息必须使用版本化 Schema 并运行时校验。
- 外部文件、用户输入、插件 Manifest 和工作区数据进入领域层前必须校验。
- 持久化数据必须包含版本并支持明确迁移；导入失败不得覆盖现有工作区。
- 破坏已有持久化格式、插件 ID、协议 ID、表类型 ID 或工作区字段时，必须提供兼容或迁移方案。

### 插件与安全

- 所有插件由用户手动安装；不得新增随应用自动安装的内置插件或联网自动下载路径。
- 可执行插件默认运行在隔离 Worker/线程。同进程执行必须在安装确认框中由用户显式授权。
- 宿主侧插件只能经 `PluginStorePort`/宿主插件运行时加载；不得在 `main.ts`、
  `extension.ts` 或 UI 中静态 import 插件包来绕过安装、禁用和卸载语义。
- 插件不得直接取得 Transport、串口句柄、共享 UI Store 或通信会话对象。
- 插件集合变化、禁用、卸载或入口源码变化后，其 codec、数据类型、地址变换和 UI 贡献
  必须及时失效，不得残留。
- 不得绕过 CSP、权限白名单、工作区信任、日志隐私和用户主动操作边界。
- 不把设备报文、寄存器表、工作区或插件私有数据自动上传到外部服务。

### TypeScript、依赖与代码质量

- TypeScript 保持 `strict`；不得通过关闭严格检查、放宽 tsconfig 或大面积禁用 ESLint
  让变更通过。
- 不得用无意义的 `any`、类型断言或非空断言掩盖未处理状态。
- 捕获异常按 `unknown` 处理，在边界收窄；不得吞异常或用成功值代替失败。
- 使用 Virtual Clock、Fake Transport 和可注入依赖测试时序，不用固定 `sleep` 修复竞态。
- 不实现无限重试、无限缓存、无上限队列或无法取消的长任务。
- 不修改第三方库未公开的内部属性或方法；先查官方文档，确需 patch 时保持最小、可追踪、
  可复现。
- 不擅自更换核心技术栈。新增依赖前核对许可证、维护状态、TypeScript 支持、目标运行时
  和现有替代方案。
- 不把临时调试日志、探针、生成物、密钥或签名材料留在提交中。

## 6. 测试与验证

测试执行时机以用户要求为准。不要因为“看起来正常”宣称功能可用，也不要在用户未要求时
擅自启动耗时的全量回归、真实设备测试或四端 E2E。

验证按改动风险选择：

- 开发指南、注释和纯文案：检查链接、路径、命令和术语一致性。
- 局部 TypeScript 逻辑：优先运行相关包的单测；如需全仓检查，使用 `pnpm typecheck`
  和 `pnpm lint`。
- 协议、调度、持久化、插件和跨端契约：覆盖成功、失败、取消、超时、迟到响应和迁移
  等关键分支。
- UI、构建、CSP、资源路径和打包行为：开发服务器全绿不能替代生产产物验证。
- 串口、TCP、Android 和真实设备行为：模拟测试不能替代相应真机或虚拟端口验证。

常用入口：

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm test:e2e:web
pnpm test:e2e:electron
pnpm test:e2e:vscode
pnpm test:e2e:android
pnpm test:all
```

注意：

- `pnpm test:all` 是耗时的全量编排，执行前确认用户要求和环境；不要在已有手动 dev
  server/从站进程未清理时直接运行。
- `pnpm test:e2e:android` 需要已授权真机，且不包含在 `pnpm test:all` 中。
- Playwright 使用系统 Edge，不额外下载 Chromium。
- Turborepo 输出被 TUI 吞掉时，可先执行 `$env:TURBO_UI = "0"`。
- 不得谎报执行过的命令。若因环境、权限或用户要求未运行某项检查，必须在交付中明确说明。
- 不得通过删除、跳过、弱化测试，或修改断言来制造通过结果。

## 7. 变更纪律

- 先查看工作区状态，保留用户已有的未提交修改和无关文件。
- 不执行 `git reset --hard`、`git checkout --`、清理整个工作区等可能丢失用户工作的操作。
- 不因个人风格进行全仓格式化、批量重命名或大规模重构；格式化只作用于本次必要文件。
- 修改公共接口时同步检查调用方、类型导出、测试和文档；只有真实调用方需要时才扩散修改。
- 不提交、发布、推送或发送外部消息，除非用户明确要求。
- 文档只记录会长期影响实现和验收的决策，不为每个微小改动创建流水账。

## 8. 完成标准

任务完成前确认：

- 用户请求已完整实现，没有把“已分析”当成“已修改”。
- 改动范围与请求一致，未覆盖用户的无关修改。
- 相关代码、类型、测试和文档保持一致。
- 已执行的验证有真实结果；未执行的验证和剩余风险已明确。
- 没有遗留临时探针、调试输出、密钥、生成物或失效链接。
- 最终回复首先说明结果，再给出关键文件、验证情况和必要限制。
