# AGENTS.md — Mamep2026 AI 代理工作入口

本文件只保留代理开始工作所必需的项目边界、流程、护栏和文档导航。完整规范见
[docs/AGENTS.md](docs/AGENTS.md)；工程现状与开发历史见
[系统设计总览](architecture/总览.md)；命令、环境和排障见
[docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)。

## 项目边界

Mamep2026 是面向设备开发与嵌入式调试的 Modbus 工具，支持浏览器、Electron、
VSCode 插件和 Android 四个平台。核心能力围绕一张表管理不连续的保持寄存器；
通用核心的默认读写路径是 FC03 / 0x10，其他功能码和厂商私有规则必须通过已确认的
插件边界提供。项目只借鉴原 M@MEp2006 的交互背景，不以复刻其界面为目标。

终端环境为 Windows PowerShell。执行命令时使用 PowerShell 语法。

## 指令优先级

用户当前任务指令 > 已确认的产品决策 / ADR > [docs/AGENTS.md](docs/AGENTS.md) > [TECH_DESIGN.md](docs/TECH_DESIGN.md) > [PRD.md](docs/PRD.md) > Research / 原版资料 > 现有代码与测试行为 > AI 推测。

冲突不得静默取舍。涉及未确认事项时先提问；不得因为现有代码已经这样实现就推翻
已确认的产品或架构约束。未确认事项清单见
[docs/AGENTS.md](docs/AGENTS.md) §35。

## 开工要求

先判断任务类型：

- **开发任务**：会修改产品实现、共享包、测试、构建/运行配置、协议/数据行为或
  交付产物。必须执行下方开发工作流。
- **非开发任务**：只读分析、解释问答、普通文档整理、AI 提示词/技能/工具链配置。
  直接执行，不套用需求澄清、计划和特性文档门禁。
- **混合任务**：只对开发部分执行工作流，其余部分直接处理，并在汇报时说明边界。

开发任务开始前，必须完整阅读 [docs/AGENTS.md](docs/AGENTS.md)，并检查与任务直接
相关的代码、测试、README、ADR 和模块文档。涉及产品行为时同时阅读 PRD；涉及架构、
通信、平台适配、持久化或插件边界时同时阅读 TECH_DESIGN 和相关 ADR。范围不清时
不得先做大范围实现。

## 开发工作流

除非用户明确跳过某步，开发任务按以下顺序执行：

1. **需求澄清**：输出边界、异常、性能/安全、影响面和未确认项，等待确认。
2. **计划**：列出影响文件、变更点、测试策略、风险与回滚，等待“计划通过”。
3. **文档记录**：在 `docs/features/` 或 `docs/bugs/` 记录任务；架构/产品级决策
   另补 ADR，并更新 [系统设计总览](architecture/总览.md) 中受影响的架构说明。
4. **代码变更**：最小化、单一职责；先读相关测试与类型定义，遵守强制约束。
5. **测试**：先提出测试策略并等待用户决定执行时机；核心算法、协议、调度和
   Bug 修复优先采用“失败测试 → 实现 → 回归”。
6. **回归**：执行受影响包单测、`pnpm typecheck`、`pnpm lint`；界面或传输变更需
   提醒冒烟或相关 e2e，并先征得同意。

工具入口为 `.agents/skills/dev-workflow/SKILL.md`。完整命令与测试基础设施说明见
[docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)。

## 强制约束

以下是常见高风险的摘要；完整禁止行为和关键不变量见
[docs/AGENTS.md](docs/AGENTS.md) §32、§43。

- 不擅自扩展产品范围，不猜测未确认的协议规则。
- 浏览器端不得直接实现 Modbus TCP。
- UI 不得直接访问串口、TCP 或文件系统。
- 所有设备请求必须进入统一调度器；断开后不得继续发送新请求。
- 迟到响应不得污染后续请求；读取或写入失败不得擅自清空 Data 单元格。
- 厂商私有规则、专有 codec 和地址变换只进插件，不写入通用核心。
- 不新增内置/随包自动安装的插件；插件一律由用户手动安装。
- 同进程插件必须由用户在安装确认框中显式授权；宿主侧插件只能经
  `PluginStorePort` 加载，不得静态 import 插件包。
- Android 原生插件调用只能出现在 `packages/platform-android` 与 `apps/android`；
  不得为支持 Android 翻转浏览器能力位或把会话/调度逻辑下沉到原生。
- 所有跨边界消息必须经过版本化 Schema 校验；平台不支持的能力必须如实声明。
- 不得关闭严格类型检查，不得用 `any`、类型断言或非空断言掩盖问题。
- 不得吞异常、用固定 sleep 修复竞态、使用无限重试或无限缓存。
- 不得修改第三方库未公开的内部属性或方法；使用前先查官方文档。
- 不得谎报执行过的命令或测试，不得通过删除用户数据或测试让检查通过。

## 文档导航

- [docs/README.md](docs/README.md)：完整文档与 ADR 索引
- [docs/AGENTS.md](docs/AGENTS.md)：43 节开发规范、架构规则与禁止行为
- [系统设计总览](architecture/总览.md)：当前工程结构与系统架构
- [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)：常用命令、环境坑和测试
- [README.md](README.md)：用户视角的项目介绍、启动和打包
- [docs/PRD.md](docs/PRD.md)：产品范围、优先级和验收条件
- [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)：技术设计、能力矩阵和跨端契约
- [docs/adr/](docs/adr/)：已确认的产品与架构决策
- [docs/features/](docs/features/) / [docs/bugs/](docs/bugs/)：功能与缺陷记录
- [docs/templates/](docs/templates/)：特性记录和缺陷记录模板
