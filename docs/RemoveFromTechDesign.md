# 从 TECH_DESIGN.md 移出的内容

本文件保存已确认不属于 TECH_DESIGN.md 定位范围的章节。章节编号沿用移出前的原编号，便于对照历史引用和 ADR。

# 24. UI 技术设计

## 24.1 UI 组成

共享 UI 包含：

1. AppShell；
2. TopBar；
3. Sidebar；
4. SheetTabs；
5. RegisterToolbar；
6. RegisterGrid；
7. BottomPanel；
8. ConnectionDialog；
9. PluginManager；
10. SettingsView；
11. StatusIndicator；
12. NotificationCenter。

## 24.2 ViewModel

UI 不直接消费复杂领域对象，而使用 ViewModel。

例如 RegisterRowViewModel 包含：

- rowId；
- displayIndex；
- name；
- addressText；
- addressError；
- pollingState；
- readButtonState；
- cellText；
- writeValidation；
- dataType；
- operationState；
- statusText。

ViewModel 由 Selector 或 Presenter 生成，避免组件中重复业务判断。

## 24.3 表格单元格编辑

Data 单元格使用受控 Input，编辑直接更新 Store 行数据：

1. 输入变化即时写入单元格当前值；
2. 无编辑会话、草稿或提交事务；
3. 读取成功结果无条件覆盖单元格内容，包括正在编辑时；
4. 单元格值存放在 Store 行数据中，不随虚拟化卸载丢失。

## 24.4 撤销和重做

撤销栈只处理工作区编辑操作：

- 新增行；
- 删除行；
- 修改名称；
- 修改地址；
- 修改 Type；
- 修改轮询设置；
- 粘贴；
- 移动行；
- 标签页操作。

不撤销：

- 设备读取结果；
- Data 单元格文本修改；
- 已经发送的写入；
- 连接和断开；
- 通信日志；
- 设备产生的外部状态。

写入设备后不能使用普通 UI 撤销恢复设备值。

## 24.5 可访问性

实现要求：

- 所有图标按钮有辅助文本；
- 表格使用适当 ARIA 语义；
- 单元格错误与编辑器关联；
- 焦点状态清晰；
- 状态不只依赖颜色；
- 动态读取不抢夺焦点；
- 日志自动滚动可暂停；
- 对频繁轮询结果使用非侵入式更新；
- 键盘可以完成核心任务；
- 对话框具有焦点圈定和关闭恢复；
- 表格虚拟化不能破坏屏幕阅读器的基本导航。

## 24.6 国际化

界面文案使用集中式资源键。

建议采用成熟 React 国际化库。

要求：

- 业务层不拼接用户文案；
- 错误使用 message key 和参数；
- 原始报文不翻译；
- Type 内部值不本地化；
- CSV 或工作区字段名不依赖界面语言；
- 时间通过平台 Locale 格式化；
- 数字协议转换使用固定规则，不使用本地显示格式作为协议输入。

---

# 28. 性能设计

## 28.1 表格性能

措施：

- 行虚拟化；
- 细粒度 Store Selector；
- 稳定 rowId；
- 避免整个表格因单行读取结果全部重渲染；
- 单元格文本局部更新；
- 日志与表格状态分离；
- 低频保存使用 debounce；
- 批量粘贴使用单一事务；
- 计算型格式化函数缓存或按需执行。

性能测试至少覆盖：

- 1000 行；
- 1000 行中多行周期更新；
- 大量日志；
- 多标签页切换；
- 深色主题；
- 缩放；
- VSCode Webview。

## 28.2 日志性能

措施：

- 环形缓冲；
- 日志列表虚拟化；
- 批量事件更新；
- 暂停自动滚动；
- 原始字节延迟格式化；
- 导出在 Host 或 Worker 中执行；
- 避免每个字节创建独立 React 节点。

## 28.3 通信性能

措施：

- 通信在 Electron Main 或 VSCode Extension Host 中执行；
- Browser 中避免阻塞 UI；
- CRC 和帧解析使用 Uint8Array；
- 不在通信热路径中进行大型 JSON 序列化；
- 日志事件可以批量推送到 UI；
- 不为轮询创建无限 Timer；
- 使用单一调度器或最小化定时器数量。

## 28.4 Worker 使用

MVP 不强制引入 Web Worker。

以下任务达到性能瓶颈后可迁移：

- 大型日志导出；
- 大型工作区导入校验；
- Trace 数据处理；
- 大量数据格式转换；
- 曲线降采样。

串口和 TCP 通信仍由对应 Host 能力负责，不因 Worker 引入新的平台分叉。

---

# 32. 技术决策记录

重要技术变更通过 Architecture Decision Record 记录。

建议首批 ADR：

1. ADR-001：采用 TypeScript Monorepo；
2. ADR-002：采用 React 共享 UI；
3. ADR-003：采用 Ports and Adapters；
4. ADR-004：不建设远程后端；
5. ADR-005：工作区使用版本化文档存储；
6. ADR-006：统一串行请求调度；
7. ADR-007：核心 Modbus 协议采用内部最小实现；
8. ADR-008：寄存器表采用 Ant Design Table；
9. ADR-009：Data 单元格采用单一当前值模型，读取结果强制覆盖，无草稿与编辑事务；
10. ADR-010：MVP 插件限制为内置和受信任来源；
11. ADR-011：Electron Renderer 使用严格进程隔离；
12. ADR-012：插件通信必须经过统一调度器。

> 现状注记（2026-08-23）：`docs/adr/` 当前已落地的决策文件为 ADR-013（monorepo 迁移与产品决策确认）、ADR-014（寄存器地址进制显示选择）、ADR-015（行编辑交互与剪贴板决策）、ADR-016（Electron 骨架与安全 IPC）、ADR-017（MVP Electron 复用 Web Serial 与串口库替换）、ADR-018（免安装绿色版打包）、[ADR-019](adr/ADR-019-vscode骨架与安全RPC.md)（VSCode 骨架与安全 RPC）、[ADR-020](adr/ADR-020-串口库选型与NodeSerialAdapter原型.md)（串口库选型与 Node Serial Adapter 原型）、[ADR-021](adr/ADR-021-vscode-rtu接线.md)（VSCode RTU 接线）、[ADR-022](adr/ADR-022-两端TCP接线.md)（两端 Modbus TCP 接线）；上述 ADR-001~012 为规划清单，尚无以文件形式归档的独立记录。

每个 ADR 应包含：

- 背景；
- 决策；
- 备选方案；
- 选择理由；
- 正面影响；
- 负面影响；
- 后续复审条件。

---

# 33. 分阶段实现建议

## 33.1 阶段一：核心协议与数据模型

实现：

- Monorepo；
- domain；
- protocol-modbus；
- data-conversion；
- test-kit；
- 固定协议向量；
- 工作区基础 Schema。

完成条件：

- 03 和 0x10 编解码测试通过；
- CRC 测试通过；
- 数据类型转换测试通过；
- 不依赖任何 UI 和真实设备。

## 33.2 阶段二：通信会话与调度器

实现：

- TransportPort；
- CommunicationSession；
- RequestScheduler；
- Timeout；
- Retry；
- PollingCoordinator；
- BatchReadCoordinator；
- Fake Transport。

完成条件：

- 串行行为可测试；
- 超时、重试和取消可测试；
- 轮询不积压；
- 断开后无新请求；
- 迟到响应不污染后续请求。

## 33.3 阶段三：三端基础骨架与浏览器原型

实现：

- React AppShell；
- 三端运行骨架：浏览器 Vite dev server、Electron 最小 Main 窗口（Main 与 Renderer 分离打包）、VSCode Extension Host 最小 Webview；
- 三端均加载同一套共享 UI 页面；
- 寄存器表原型；
- Web Serial Adapter；
- IndexedDB；
- 单行读写；
- 全表读取；
- 轮询；
- 日志；
- 状态恢复。

目标：

- 最早验证共享 UI；
- 验证三端基础页面加载与开发调试链路；
- 验证表格编辑；
- 验证 Web Serial 能力限制；
- 验证工作区模型。

## 33.4 阶段四：Electron

实现：

- Main、Preload 和 Renderer；
- 串口（MVP 复用 Web Serial API，ADR-017；后续替换为 Node Serial）；
- Node TCP；
- 文件持久化（已移出 MVP，后续版本）；
- IPC；
- 安全配置；
- 桌面打包（2026-08-22 已落地免安装绿色版 `pnpm dist:portable` → `release/win-unpacked/`，ADR-018；正式安装包为后续事项）。

Electron 成为完整参考客户端。

## 33.5 阶段五：VSCode

实现：

- Extension Host；
- Webview；
- RPC；
- Node Serial；
- Node TCP；
- VSCode 存储；
- 主题适配（已移出 MVP，后续版本）；
- Extension 测试。

目标：

- 最大化复用核心和 UI；
- 只在 Host 和布局层处理 VSCode 差异。

## 33.6 阶段六：插件基础

实现：

- plugin-api；
- Manifest；
- 生命周期；
- 权限；
- 贡献点；
- 错误隔离；
- 示例插件。

示例插件不能反向污染核心协议包。

---

# 45. Trace 扩展预留

完整 Trace（TM 的 Memory Trace 追踪窗口）已确认属于浏览器端 MVP 核心范围（ADR-013，PRD §6.5.4），核心实现为数据列表采样；本节的预留边界用于后续 Register Trace 等扩展形态。

建议预留：

- SampleEvent；
- TraceSession；
- TraceBuffer；
- TraceExporter；
- SampleSource；
- SamplingPolicy。

Trace 不应直接监听 React State，而应订阅通信成功事件。

采样数据至少包含：

- sequence；
- timestamp；
- rowId；
- rawValue；
- formattedValue；
- dataType；
- requestId。

Continue 缓冲必须设置系统上限或流式写入文件，禁止真正无限保存在内存中。

Average 计算应基于可明确定义的数值：

- 默认基于 Type 解释后的数值；
- HEX 和 Binary 转换为原始数值后参与计算；
- 无有效样本时不显示平均值；
- 缓冲截断时明确统计范围。

---

# 48. 实现完成定义

一个技术模块被认为完成，需要满足：

1. 接口和职责明确；
2. 不违反模块依赖规则；
3. 外部输入经过校验；
4. 错误使用结构化模型；
5. 资源能够释放；
6. 关键分支具有自动化测试；
7. 平台差异通过 Adapter 表达；
8. 不把运行时状态错误地持久化；
9. 不绕过通信调度器；
10. 对应 PRD 验收行为可以追踪到实现模块和测试；
11. 类型检查通过；
12. 构建通过；
13. 没有未说明的跨端行为差异；
14. 没有把厂商私有规则写入通用核心；
15. 已记录必要的技术限制和后续事项。

具体的开发步骤、命令顺序、提交粒度和代理自检流程由 AGENTS.md 定义。

---

# 49. PRD 与技术模块追踪关系

| PRD 能力         | 主要技术模块                                                |
| ---------------- | ----------------------------------------------------------- |
| Modbus RTU       | protocol-modbus、communication、platform-web、platform-node |
| Modbus TCP       | protocol-modbus、communication、platform-node               |
| 单行读取         | register-table、communication、protocol-modbus              |
| 单行写入         | register-table、communication、data-conversion              |
| 写后回读         | WriteVerifyCoordinator、RequestScheduler                    |
| 全表读取         | BatchReadCoordinator                                        |
| 周期轮询         | PollingCoordinator、RequestScheduler                        |
| 不连续寄存器     | RegisterSheet、RegisterRow                                  |
| 数据类型         | data-conversion                                             |
| 多标签页         | register-table、workspace、ui                               |
| 状态恢复         | workspace、各平台 Repository Adapter                        |
| 通信日志         | logging、communication                                      |
| 通信属性         | connection session、UI ViewModel                            |
| 三端适配         | platform-api、各平台 Adapter 和 Host                        |
| 插件基础         | plugin-api、Plugin Host、Plugin Manager UI                  |
| 现代界面         | ui、ui-theme                                                |
| 1000 行表格      | Ant Design Table、性能测试                                  |
| 浏览器不支持 TCP | Capability Matrix、Browser Host                             |
| Electron 安全    | Main、Preload、Renderer 隔离                                |
| VSCode 主题适配  | VSCode Theme Adapter                                        |
| 国际化           | UI 文案资源和错误消息键                                     |
| 测试驱动         | test-kit、Vitest、Playwright、平台集成测试                  |

该追踪表用于确认 PRD 能力具有明确技术归属，不替代详细测试追踪矩阵。

---

# 50. 与 AGENTS.md 的边界

以下内容不写入本技术设计，应由 AGENTS.md 定义：

1. AI 代理开始任务前必须阅读哪些文件；
2. 安装依赖的具体命令；
3. 开发服务器命令；
4. 类型检查命令；
5. 单元测试命令；
6. 端到端测试命令；
7. 格式化命令；
8. Lint 命令；
9. 单次任务允许修改的文件范围；
10. 测试执行时机（由用户决定）与测试先行的实际操作顺序；
11. 修改协议代码后的强制检查清单；
12. 修改跨端 UI 后的强制检查清单；
13. 依赖升级流程；
14. 提交信息格式；
15. Pull Request 模板；
16. 失败后的回滚方法；
17. AI 不得修改的文件；
18. 生成代码后的自检步骤；
19. 任务完成时需要报告的内容；
20. 临时文件和调试代码清理规则。

TECH_DESIGN.md 说明系统如何设计。

AGENTS.md 说明 AI 代理如何在该工程中安全执行开发任务。

两者不得互相替代。

---

# 51. 文档维护

本技术设计在以下情况发生时需要更新：

1. 技术栈发生变化；
2. 核心模块边界变化；
3. 平台能力变化；
4. 工作区 Schema 发生结构性变化；
5. 插件 API 发生变化；
6. 请求调度策略发生变化；
7. Electron 或 VSCode 安全边界变化；
8. 新增 Modbus 功能码；
9. 引入新的表类型；
10. 引入远程后端或数据库；
11. 关键原型结论否定当前设计；
12. ADR 形成新的架构决策。

普通编码细节、局部重构和命名调整不需要全部同步到本文档，除非其改变了公开契约、模块职责或跨端行为。

---

# 52. 技术设计完成定义

当以下条件满足时，本技术设计可作为工程实现基线：

1. PRD 中影响架构的待确认事项已得到处理，或已被明确标记为可替换策略；
2. Monorepo、模块和依赖方向已确认；
3. 三端 Host 和 Adapter 边界已确认；
4. 串口库完成原型验证（后续版本替换阶段，ADR-017；MVP Electron 使用 Web Serial）；
5. Web Serial 能力边界完成验证；
6. 表格方案完成 1000 行原型验证；
7. RTU 和 TCP 分帧方案完成测试；
8. RequestScheduler 行为已确认；
9. 轮询间隔语义已确认；
10. Data 单元格单一值模型与读取结果强制覆盖方案已确认；
11. 工作区持久化和迁移方案已确认；
12. 插件 MVP 装载范围已确认；
13. Electron IPC 安全边界已确认；
14. VSCode Webview RPC 边界已确认；
15. 自动化测试层级和模拟设备方案已确认；
16. 关键技术风险均有应对方案；
17. ADR 清单已经建立；
18. TECH_DESIGN.md 与 PRD、AGENTS.md 的边界清晰；
19. 可以依据本文档创建工程骨架并开始分阶段实现。

完成上述事项后，可基于本文档编写 AGENTS.md，并进入 Mamep2026 的工程初始化、测试骨架建设和功能实现阶段。
