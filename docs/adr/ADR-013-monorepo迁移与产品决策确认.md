# ADR-013：Monorepo 迁移与浏览器 MVP 产品决策确认

- 状态：已确认
- 日期：2026-08-13
- 决策来源：用户指令（优先级最高）

## 背景

工程此前为扁平结构（`src/` 为网页端、`electron/`、`vscode-extension/`），与 TECH_DESIGN 目标 monorepo 不一致。同时存在多个产品细节待确认（TM/WP 定义、Address Adjust 归属、从站地址范围、轮询间隔来源等），影响浏览器侧 MVP（P0）实现。

## 决策

1. **Monorepo 迁移（立即执行）**：创建 `apps/web`、`packages/*`、`tooling/typescript-config`、`tests/{acceptance,e2e-web}`，网页端迁入 `apps/web`；根目录工程文件（package.json、pnpm-workspace.yaml、turbo.json、eslint.config.js、tsconfig、AGENTS.md）同步更新。Electron 与 VSCode 侧仅保证编译不被破坏，不在本轮实现与测试。
2. **从站地址范围 0~255**（默认 1）；地址 0 允许配置（广播语义，按标准无应答），MVP 不实现广播写入。
3. **Address Adjust 进入核心**：Connection Settings 配置项，ON 时发送地址 = 用户地址 − 1，默认 OFF；通信日志同时记录用户地址与发送地址。原「由插件转换 Hook 实现」的定位作废。
4. **TM/WP 定名**：TM = 轨迹追踪（勾选弹出 Memory Trace 追踪窗口，完整实现，PRD §6.5.4）；WP = 行周期轮询开关（现代 switch，不复刻笑脸锁定）。`traceEnabled` 与 `pollingEnabled` 独立字段。Trace Buffer `Continue` 档使用环形缓冲区硬上限 10000 条。
5. **无独立全局轮询间隔**：WP 轮询间隔 = Connection Settings 的 Rx Delay（interRequestDelayMs，默认 50 ms）；不提供全部行持续轮询（ALL Polling）。
6. **Connection Settings 用 Modal 实现，每次应用启动自动弹出**；浏览器端仅提供 Modbus RTU 配置（无 TCP 入口）。
7. **入口布局**：Connection Settings、Plugin Manager、Settings 入口统一在顶部应用栏；侧边栏仅保留寄存器表（标签页）列表。
8. **连接按钮单按钮化**：CONNECT ↔ DISCONNECT 同一个切换按钮；连接状态用文字 + 语义色展示。
9. **表格列规格**：No / TM / Name / Register[HEX] / WP / READ / Data / WRITE / Type / Comment；无 Status 列；READ/WRITE 按钮必须包含完整文字；可编辑单元格输入框铺满列宽（点击整格可编辑）；Comment 随工作区持久化。
10. **通信日志 UI 简化**：仅展示时间、方向与 Request/Response 原始字节（hex）；内部数据模型保留结构化字段但不做功能码解析展示。
11. **语言与模拟传输**：i18next 初始化 en-US（主）+ zh-CN；浏览器 E2E 使用 dev 环境内置模拟 Modbus RTU 传输（`?mockTransport=1`，生产构建不启用）。

## 备选方案

- Address Adjust 保留为插件转换 Hook（原设计）：被否决，用户明确要求放入 Connection Settings 并保持老版软件一致行为。
- 从站地址 1~~247（Modbus 标准常用范围）：被否决，用户明确 0~~255。
- 侧边栏承载三入口（原 PRD 6.9 建议）：被否决，三入口移至顶栏。

## 理由

- 与老版 M@MEp2006 使用习惯保持一致，降低老用户迁移成本；
- 简化浏览器端 MVP 界面层级，高频操作直达；
- 消除 TM/WP 定义冲突与文档矛盾，为 TDD 实现提供单一事实来源。

## 正面影响

- 文档与实现决策一致，减少实现偏差；
- 轮询参数来源唯一（Rx Delay），配置面更小；
- 日志 UI 简化降低渲染与理解成本。

## 负面影响

- 从站地址 0 配置后按标准无应答，可能造成用户误配（以文档说明与消息提示缓解）；
- Address Adjust 进入核心后，厂商差异扩展点减少（未来如有多厂商需求再评估 Hook 回归）。

## 复审条件

- 实机验证 Address Adjust 的偏移方向与设备行为不符时；
- 需要支持其他厂商地址规则时；
- 浏览器 E2E 模拟传输不能满足验收要求时。
