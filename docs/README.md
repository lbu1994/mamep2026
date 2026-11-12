# Mamep2026 文档索引

本目录是项目文档入口。代理执行规则以根 [AGENTS.md](../AGENTS.md) 和
[AGENTS.md](AGENTS.md) 为准；工程状态以 [PROJECT_STATUS.md](PROJECT_STATUS.md)
为准；命令、环境和排障以 [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) 为准。

## 项目入口

- [根 README](../README.md)：项目介绍、启动、构建、打包和用户可见功能
- [AGENTS.md](AGENTS.md)：完整的 43 节开发规范、架构规则和禁止行为
- [PROJECT_STATUS.md](PROJECT_STATUS.md)：当前工程结构与按日期记录的实施进度
- [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)：常用命令、环境要求、踩坑和测试基础设施

## 产品与技术设计

- [PRD.md](PRD.md)：产品范围、功能优先级、交互需求和验收条件
- [TECH_DESIGN.md](TECH_DESIGN.md)：架构、模块边界、能力矩阵、协议和测试策略
- [RESEARCH.md](RESEARCH.md)：背景调研与原 M@MEp2006 分析
- [插件功能设计.md](插件功能设计.md)：插件能力、贡献点、权限和运行时边界
- [插件开发入门指南.md](插件开发入门指南.md)：插件包的开发与发布流程

## 决策与任务记录

- [adr/](adr/)：产品与架构决策记录，编号从 ADR-013 起持续累积
- [features/](features/)：已实施功能的任务记录、行为边界和验证结果
- [bugs/](bugs/)：缺陷复现、根因、修复和回归记录
- [templates/feature-request.md](templates/feature-request.md)：功能记录模板
- [templates/bug-report.md](templates/bug-report.md)：缺陷记录模板
- [prompts/](prompts/)：Codex / Copilot 工作流提示词存档

## 平台与工程资料

- [Android README](../apps/android/README.md)：Capacitor 工程、真机调试和构建前置
- [连接对象配置说明](../config/README.md)：测试与探针使用的 `connections.json`
- [Modbus 从站说明](../scripts/modbus-slave/README.md)：RTU/TCP 从站、共享规则和扩展行为
- [node-serial-prototype-验证记录.md](node-serial-prototype-验证记录.md)：Node 串口适配器原型验证
- [node-tcp-adapter-验证记录.md](node-tcp-adapter-验证记录.md)：Node TCP 适配器原型验证
- [adr-048-默认主题色跟随antd-验证记录.md](adr-048-默认主题色跟随antd-验证记录.md)：主题色实现验证
- [adr-050-验证记录.md](adr-050-验证记录.md)：Android 方案与真机验证

## 测试与排障

- [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)：命令索引、环境坑和测试分层
- [浏览器端自动化测试方法指南.md](浏览器端自动化测试方法指南.md)：浏览器 E2E、
  Playwright、mockTransport 和常见选择器问题
- [插件开发入门指南.md](插件开发入门指南.md)：插件安装、权限与运行时排障

## 背景与参考

- [M@MEp2006串口选择对话框 界面特征整理.md](M@MEp2006串口选择对话框%20界面特征整理.md)
- [M@MEp2006主寄存器监控界面 界面特征整理.md](M@MEp2006主寄存器监控界面%20界面特征整理.md)
- [安川MEMOBUS公开协议参考.md](安川MEMOBUS公开协议参考.md)
- [Mamep2026图标AI生成提示词.md](Mamep2026图标AI生成提示词.md)

工作区技能位于 [.agents/skills/](../.agents/skills/)；开发任务统一使用
[dev-workflow](../.agents/skills/dev-workflow/SKILL.md)，浏览器交互验证使用
[browser-e2e-testing](../.agents/skills/browser-e2e-testing/SKILL.md)。
