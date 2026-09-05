# 分阶段 ToDoList

> 依据 [docs/PRD.md](docs/PRD.md)（§8.2–8.6 优先级）与 [docs/adr/](docs/adr/)（ADR-019–025 已知限制 / 真机验证项 / 后续复审条件）整理；以 PRD 与 ADR 为准，需求变更时更新。勾选 `[x]` 表示已完成；`[ ]` 表示未开始；「待真机验证」「部分完成」等在括号内注明。
>
> **2026-09-03 重排**：各阶段/优先组下的「待办（[ ]）」按**依赖关系先后**排在前，同依赖层内按**优先级从高到低**；被其他项依赖的基础项靠前，依赖他人/后续能力的项靠后（如「每个标签页独立连接」依赖「多活动连接」、「数据曲线/数据导出」依赖「Register Trace」采样、「多设备并行监控」依赖「多活动连接」）。跨阶段遵循 PRD §8.2–8.6 优先级（P1 → P2 → P3），功能依赖依据 PRD §21.2 与已落地 ADR 梳理；「已由 XX 覆盖 / 无新建开发量」的项置末尾作参考。
>
> **标签说明**：`[feat]` 新功能 · `[bug]` 缺陷修复 · `[plugin]` 插件相关 · `[docs]` 文档/帮助内容 · `[refactor]` 架构/迁移/重构 · `[test]` 测试/端到端 · `[verify]` 真机/验证。

## 阶段一：近期收尾（遗留已知限制 / 真机验证）

- [x] [verify] Node Serial Adapter 真机验证：COM10+ 真机、macOS / Linux、Electron / VSCode 打包后原生模块（serialport）加载 — ADR-020 / ADR-021（待真机验证；作为后述桌面端串口/TCP 能力可信度的前置验证项）
- [x] [test] 三端真实端口 e2e 全量回归（com0com + 真实 RTU/TCP 从站，浏览器需在系统 picker 手动选 COM4 一次）— ADR-024（ADR-024 落地后实际未跑通，2026-08-25 全量回归修复后首次真正全绿：web 12 / electron 24 / vscode 3，ADR-028）
- [x] [feat] 远程批任务取消（Electron TCP / VSCode `readAllRows` cancel 语义补全：渲染端生成 batchId + `session-batch-cancel` RPC + UI 取消入口，接口契约不变）— ADR-025（ADR-021/022 已知限制已解决）
- [x] [feat] VSCode 端 `readAllRows` cancel 补全（与 TCP 同一远程路径，ADR-025 一并解决）— ADR-021 已知限制
- [x] [feat] TCP Unit ID 会话内动态修改（每表独立 unitId，工具栏按协议切换 label；新增 `session-set-unit-id` kind）— ADR-026（ADR-022 已知限制已解决）
- [x] [feat] VSCode 主题完整适配（light/dark 两态 → 完整主题令牌映射，ui-theme）— ADR-027（ADR-019 后续复审条件已解决）
- [x] [test] scripts 从站创建（如 `scripts/dev-with-slave.mjs`）除在 COM5 创建 Modbus RTU 从站外，一并创建 Modbus TCP 从站（复用 `scripts/modbus-slave/modbus-tcp-slave.mjs`，host/port/unitId 取 `config/connections.json` `tcp-local-slave`）；若某个 Testcase 已自行创建 Modbus TCP 从站，则改用上面创建的共享从站、不再重复创建 — 测试/开发从站基建增强（关联 ADR-023 连接对象配置 / ADR-024 三端真实端口 e2e 从站编排，含 dev / e2e 双场景）
- [x] [test] scripts 从站创建（`scripts/modbus-slave/`）除功能码 03H/10H 外，追加支持应用层已落地的其他功能码（FC01 读线圈 / FC02 读离散输入 / FC04 读输入寄存器 / FC0F 写多线圈——ADR-043 基础表；以及自定义功能码如 FC65/FC66）— 让真实端口/从站 e2e 能覆盖这些功能码；涉及 `scripts/modbus-slave/lib/modbus-core.mjs`（默认规则区扩充）与 rtu/tcp slave 的请求分发（与上一条「TCP 从站一并创建」同属从站基建增强）。**2026-09-04 完成**：`modbus-core.mjs` 增常量/表类型规则（`tableType`）与位打包辅助、`DEFAULT_RULES` 追加基础表区；RTU/TCP `handleFrame` 分发 FC01/02/04/0F/65/66（分表存储 coil/离散输入/输入寄存器）；两个 config JSON 追加基础表规则与预置值；`--self-test` RTU 28/28、TCP 31/31 通过；真实端口 e2e 在 **Electron RTU**（`real-serial.spec.ts`）补齐基础表 + 自定义功能码用例，**`pnpm test:e2e:electron:real` 27/27 全绿**。**范围说明**：①基础表/自定义功能码为 **RTU-only**（ADR-043：基础表 TCP 承载未做、自定义 codec 为 RTU），故未补 TCP e2e；②浏览器 Web Serial 每次连接需系统 picker（无法自动化重连），故 web real 未补基础表用例（web 已有 mock `basic-tables.spec.ts`/`custom-function-code.spec.ts` 覆盖）；③**VSCode real** 暂未补——真实路径切到基础表协议后经 Connection Settings 重连回到 Offline（VSCode Extension Host 真实路径对基础表协议重连存在原生限制，非从站脚本问题；已在 `tests/e2e-vscode/real/real-rtu.spec.ts` 还原，不影响其既有 3 用例）

## 阶段二：V1.0 正式版（PRD §8.3 P1）

- [x] [feat] 崩溃后的状态恢复 — PRD §8.3（依赖已落地的工作区持久化：浏览器 IndexedDB / Electron `filesystem:"full"`（ADR-036）；§21.2「状态恢复依赖工作区持久化」）— 2026-09-04，ADR-049：关闭/崩溃时 flush（**visibilitychange→hidden**，pagehide 会中断异步写入且破坏「清工作区→reload」测试隔离）+ 恢复提示（RecoveryBanner 无按钮）+ §19.1 仓储接口补齐（reset/export/import/createBackup/getRecoveryInfo）；跨端 HostMessage 契约（workspace-load 响应 recoveryInfo + 新 kind workspace-create-backup）。**回归全绿**：typecheck 27/27、lint 0、受影响包单测、浏览器新 e2e 2/2、**Electron e2e 30/30**。**已知限制**：浏览器 unload 中断异步 IndexedDB 写入，flush 为 best-effort（autosave 500ms 兜底）；「模拟崩溃」e2e 未做（进程杀伐基建成本高）
- [x] [docs] 完整用户帮助 — PRD §8.3（帮助由 `Modal` 改为右侧 `Drawer` + 顶部 `Tabs` 10 页签；新增 `packages/ui/src/components/HelpDrawer.tsx` + `help/help-content.ts` 双语正文；复用 ADR-043 E-5 `documentation` 贡献点与 `renderMarkdown`/`KeyboardShortcutsTable`/`DocumentationPanel`；i18n `help.tab*`；详情见 [docs/features/2026-09-05-完整用户帮助.md](docs/features/2026-09-05-完整用户帮助.md)）。**回归全绿**：`pnpm test:all` 通过（typecheck 27/27、lint 0、真实端口 e2e web 14/electron 27/vscode 3、ui 单测 325/325、mock e2e web 129/electron 30/vscode、串口虚拟 109）。**踩坑**：antd v6 `Drawer` 用 `size` 代替弃用的 `width`（否则 console 弃用警告破坏「无 console 错误」断言）；v6 抽屉内容类为 `.ant-drawer-section`（非 `.ant-drawer-content`）；10 个页签在窄抽屉会横向溢出进「更多」下拉，改 `size={1100}` 容纳；Playwright 无法模拟 `?`（Shift+/）键位（产生 `key:"/"`+shift / `key:"?"` 无 shift，均不匹配应用的 `{key:"?", shift:true}` 组合，`?` 别名由单测覆盖）
- [x] [feat] 浏览器端连接设置不显示「协议」分组（浏览器仅支持 Modbus RTU，协议 Segmented 单选项冗余；Electron/VSCode 保留 RTU/TCP 切换）— 连接设置 UI 打磨，与能力矩阵门控联动（关联 ADR-022 协议门控 / ADR-046 浏览器兼容性检测）。**2026-09-06 完成**：`ConnectionSettingsModal` 按「可用协议数 > 1」显示协议分组（`showProtocolSwitcher`），浏览器 rtu-only 隐藏分组，保留 `<Controller>` 注册 + 隐藏 input 承载 `protocol="rtu"`，RTU 连接路径不变；相关单测 14/14、typecheck/lint 通过；详情见 [docs/features/2026-09-06-浏览器连接设置隐藏协议分组.md](docs/features/2026-09-06-浏览器连接设置隐藏协议分组.md)
- [x] [feat] Modbus RTU 通信选项「超时(毫秒)」默认值由 1000ms 改为 50ms（目前 `packages/domain/src/config.ts` `defaultConfig.rtu.requestTimeoutMs = 1000`），输入控件由 Input 改为 Select——固定选项 5/10/…/100ms（步进 5ms，共 20 项），无自定义数值输入；与旧软件保持一致 — 连接设置 UI 打磨（关联 ADR-022 连接设置字段 / RTU profile）。**2026-09-06 完成**：`defaultConfig.rtu.requestTimeoutMs` / `tcp.requestTimeoutMs` 1000→50；表单 `settingsSchema` 拆 `rtuTimeout`(5–100)/`tcpTimeout`(50–60000)，`rtuPersistedSettingsSchema.requestTimeoutMs` 收窄 5–100；RTU 超时控件 `InputNumber`→`Select`（`RTU_TIMEOUT_OPTIONS` 5..100 步进 5 共 20 项），TCP 保留 `InputNumber`；`toProfile`/`profileToValues`/`extractPersistedSettings` 按协议分别映射（顺带修复 RTU `toProfile` 未映射 `timeout`→`requestTimeoutMs` 缺口）；三处生产兜底 `?? 1000`→引用 `defaultConfig`；`config/connections.json`+README 同步 50；真实端口 e2e 延迟响应用例注释/等待时机改用例（默认 50ms、等待 3000ms）；RTU 超时 `Select` 加 `showSearch`（支持手动输入，仅范围内档位可选），真实端口 e2e 经手动输入（键入数值+Enter）将测试连接超时设为 100ms（应用默认维持 50ms）。详见 [docs/features/2026-09-06-RTU超时默认值与Select控件.md](docs/features/2026-09-06-RTU超时默认值与Select控件.md)。**回归**：单测 domain 57/communication 124/ui 325/web 85、typecheck 27/27、lint 全绿；**Electron 真实端口 e2e `test:e2e:electron:real` 27/27 全绿**（web/vscode real 已同步改用例，需各自环境：web 需系统 picker 选 COM4、vscode 需 build:vscode）
- [ ] [refactor] 删除 Modbus RTU 设置中的 Rx Delay（毫秒）UI 及其功能（`interRequestDelayMs`，默认 50ms、范围 0–5000ms）——该参数删除后两重作用均去除：①相邻请求之间最小附加间隔为 0（上一请求结束后立即开始下一请求）；②WP 轮询的重复读取不再有间隔（读完一个立即读下一个）。明确不做：不用于判断一帧是否结束 / 不替代请求超时 / 不影响已收到响应的解析（TECH_DESIGN §12.3）— 连接设置与通信调度简化，涉及 domain RTU profile、communication 请求节流、WP 轮询调度、UI 字段（关联 ADR-013「WP 轮询间隔=Rx Delay」语义）
- [ ] [feat] Header「Connect」按钮：Modbus RTU 若已选择 Port、或 Modbus TCP 若已填入 IP 地址，则不再弹出连接设置弹窗而是直接连接（关键字段缺失/未选时仍弹窗引导填写）— 连接流程 UX 优化，涉及 MamepApp Header Connect 行为与 Connection Settings 弹窗分流（依据当前 profile + 表单校验；关联 ADR-022 TCP 设置 / ADR-046 浏览器 CONNECT 门控）
- [ ] [feat] 将 Header 中的「连接状态显示」与「Connect/Disconnect 按钮」合并为一个多功能按钮（单一按钮按连接状态切换：未连接=Connect / 连接中=状态指示 / 已连接=Disconnect，或将状态点并入按钮的一体化控件）— Header 连接 UI 整合，涉及 MamepApp Header 连接控件与状态点（与「Connect 直连」同域；关联 ADR-022 连接状态 / ADR-035 状态点）
- [ ] [feat] 三端左上角 Mamep2026 右侧原本显示「Mock」的位置，在非 Mock 模式下会显示「Modbus RTU」——删除非 Mock 模式下的「Modbus RTU」显示，改为什么都不显示（Mock 模式保留「Mock」徽标不变）— Header 品牌/模式指示清理，涉及 apps/web Header 标题区徽标（`?mockTransport=1` dev 模式判定；仅显示清理、不影响任何逻辑）
- [ ] [bug] 双击页签标签或右键选择 Rename 后，焦点未落在重命名输入框内（须手动点击才能输入），并引发一系列其他显示 bug — 修复 SheetNameEditor 编辑态焦点管理（页签头当前因 dblclick 第二次 click 抢焦点触发 blur 退出之故未设 autoFocus；需在进入编辑态时可靠聚焦且避免二次 click/blur 误退出；关联页签重命名编辑态隔离、ADR-018 页签重命名）
- [ ] [bug] 侧边栏选择 sheet 进行 Rename 时，暗黑模式下重命名输入框的编辑区显示为明亮模式（白底黑字），需修复为正确的暗黑模式 — 修复 SheetNameEditor（侧边栏）在暗色下未跟随主题（输入框/容器背景与文字色未用主题令牌，可能硬编码或未继承 antd 暗色 token；涉及 ui-theme 明暗映射、侧边栏重命名输入样式；关联 ADR-027 主题适配）
- [ ] [plugin] 新增「安川蓝」主题色插件（`plugins/yaskawa-blue-theme`，仅贡献 `theme` 预设：把安川品牌蓝主题色注册为 Settings 可选预设）— 主题色预设插件贡献，参考 `plugins/example-theme`（单色种子 + antd 派生明暗两态；纯清单、无 runtime、需手动安装，不随包一次性安装；关联 ADR-047/048 主题色预设机制 / ADR-045 禁止新增内置插件）
- [ ] [plugin] 新增「施耐德绿」主题色插件（`plugins/schneider-green-theme`，仅贡献 `theme` 预设：把施耐德品牌绿主题色注册为 Settings 可选预设）— 主题色预设插件贡献，参考 `plugins/example-theme`（单色种子 + antd 派生明暗两态；纯清单、无 runtime、需手动安装，不随包一次性安装；关联 ADR-047/048 主题色预设机制 / ADR-045 禁止新增内置插件）
- [ ] [plugin] 新增「善诚绿」主题色插件（`plugins/technopro-green-theme`，仅贡献 `theme` 预设：把善诚品牌绿主题色注册为 Settings 可选预设）— 主题色预设插件贡献，参考 `plugins/example-theme`（单色种子 + antd 派生明暗两态；纯清单、无 runtime、需手动安装，不随包一次性安装；关联 ADR-047/048 主题色预设机制 / ADR-045 禁止新增内置插件）
- [ ] [feat] 侧边栏折叠状态下，分组子菜单以弹出（popup / 悬浮 layer）形式展示（当前折叠后分组缩为图标/头部，无法展开子项；需在折叠态悬停/点击弹出子菜单项）— 侧边栏导航可用性打磨，涉及 MamepApp 侧边栏 Menu + Sider 折叠态（antd Menu `inlineCollapsed` / SiderContext 弹出子菜单行为，关联 ADR-041 侧边栏分组）
- [ ] [feat] 侧边栏展开状态下可调节宽度（使用 antd `Splitter` 分隔面板，拖拽分隔条调整侧边栏与内容区宽度）— 侧边栏导航可用性/布局增强，涉及 MamepApp 主布局改为 Splitter 面板（与折叠态互斥：折叠仅图标、展开可拖宽；关联 ADR-041 侧边栏分组 / 侧边栏折叠态项）
- [ ] [bug] 侧边栏展开状态下文本过长产生横向滚动条，但滚动条未位于侧边栏最底部，而出现在最后一项文本下方 — 修复侧边栏容器横向滚动条定位（溢出/高度计算错误：滚动条不应跟随最后一个 Menu item，而应贴合侧边栏容器底部；涉及 MamepApp 侧边栏容器 overflow 布局与 Menu/分组头 CSS，关联 ADR-041 侧边栏分组 / 侧边栏可用性项）
- [ ] [feat] 寄存器表中二进制（Binary）数据表示时每 8 位加一个空格分组（如 16 位 → `0000 0000 1111 1111`；32/64 位范围行按字节分组为 4/8 组）— 寄存器表二进制可读性增强，涉及 data-conversion 二进制格式化（展示/解析需对称处理空格，避免编辑时报非法值）与 register-table/ui 渲染、范围行（关联 ADR-030 二进制类型 / 范围行）
- [ ] [feat] 单个寄存器 Type 为二进制（Binary）时，可展开以「一行一个 bit」形式显示位明细（如 16 位展开为 16 行，每行显示位号 + 0/1 + 可选注释，便于逐位查看）— 寄存器表位级可读性增强，涉及 register-table/ui 行展开渲染与二进制格式化（与上一条「二进制每 8 位加空格」同为二进制展示增强；参考范围行展开子行模式，关联 ADR-030）
- [ ] [feat] 寄存器格式（Type）选择之后，立即更新寄存器列的格式显示，但不做进制变换（原始值/基础表示不变，仅列格式与类型指示即时刷新）— 寄存器表格式切换即时反馈，涉及 register-table Type 切换与列显示即时响应（避免切换时把值做进制重新换算；关联 ADR-030 进制+scale 双列）
- [ ] [feat] 将 Settings 界面由模态框（Modal）改为抽屉（Drawer，侧滑展开）— Settings 容器 UI 调整，涉及 packages/ui Settings 弹窗组件改为 antd Drawer（含打开方式/宽度/遮罩与键盘交互适配；与 Settings 内工作区导入导出入口、`Ctrl+,` 快捷键联动）
- [ ] [feat] 删除「Plugin Manager」按钮，并将其打开后模态框内的插件管理功能挪入 Settings（在 Settings 内集成插件管理：安装/启用/禁用/卸载/恢复 Bundled 等，取代独立 Plugin Manager 弹窗入口）— 插件管理入口整合，涉及 PluginManagerModal 迁入 Settings、移除 Header/侧边栏既有按钮（建议与「Settings 改抽屉」同批实施；关联 ADR-038 插件安装 / ADR-044 可执行化 / ADR-045 Bundled 恢复）
- [ ] [refactor] 删除「随包插件（bundled plugin）」机制：所有插件必须手动安装；若确有随包分发之需，则直接做进主程序能力，而非随包配发为插件 — 撤销 ADR-045「首启一次性安装」模式（移除 `seeded` / `restoreBundledPlugin` / `bundledPlugins` / Plugin Manager「Restore bundled」按钮）；需逐项评估现有随包插件（example-panel / address-adjust / yaskawa / custom-function-code / example-theme 等）改为「手动安装」或「并入主程序」；涉及 plugin-api、AppHost 装配层、PluginManager UI、能力矩阵（关联 ADR-044/045）
- [x] [feat] 写后回读及延迟回读（每表独立配置，默认 ON 立即回读；工具栏 Select；WriteOutcome 扩展 5 种 verify 结果 + WriteVerifyCoordinator；写入期间暂缓同表行轮询；首个工作区迁移 v1→v2 把全局 readVerifySettings 迁移到各表）— PRD §8.3（ADR-029）
- [x] [feat] 多寄存器连续读写（范围行：Register 列范围输入 + Type 拆「进制 + scale」两列 + 范围行树形展开子行（每寄存器一子行，只读），支持 32/64 位整数与 ASCII 字符串，三端落地）— PRD §8.3（ADR-030：实施完成）
- [x] [feat] 批量任务结果统计（Read All 完成结果的全局提示：antd message 富内容展示成功/失败/跳过/取消 + 耗时，与底部面板消息并存；范围仅此，统计面板/历史记录等无对应需求，不实现）— PRD §8.3（2026-08-28）
- [x] [feat] 日志导出（仅导出功能，CSV 格式；搜索/过滤本软件不提供，由用户对导出数据使用第三方软件如 Excel 自行处理）— PRD §8.3（2026-08-28：通信日志面板新增 Export 按钮，antd Modal.confirm 隐私提示（可能含设备地址/寄存器数据/原始报文，§15.3.6/§20.6）→ 仅导出当前缓冲区；CSV 序列化在 packages/logging（`csv-export.ts`：16 列固定英文列名 + RFC 4180 转义 + RFC3339 本地时间 + 大写十六进制报文）；平台落盘经 HostMessage v1 新 request kind `save-text-file`（能力矩阵新增 `logExport`：浏览器 `download` Blob 下载 / Electron `save-dialog` 主进程 dialog+fs / VSCode `save-dialog` Extension Host showSaveDialog+workspace.fs，用户取消返回 saved:false 非错误）；文件名 `comm-log-<rtu|tcp|mixed>-<YYYYMMDD-HHmmss>.csv`）
- [x] [feat] 撤销和重做（工作区编辑命令栈：行级编辑 + 每表配置 + 表结构性操作，工具栏按钮 + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y；Data 编辑/设备读值/连接等不入栈，与 ADR-015 删除不弹窗决策兼容）— PRD §8.3（2026-08-28，ADR-032）
- [x] [feat] 工作区导入和导出（版本化 JSON 公开交换格式，复用 serializeWorkspace/parseWorkspace；Settings 弹窗入口 + 导入预览 Modal；导出复用 save-text-file，桌面端导入新增 open-text-file kind；能力矩阵 workspaceImport/workspaceExport；三端 e2e）— PRD §8.3（2026-08-29，ADR-033）
- [x] [feat] 自动重连（TCP 断线自动重连：有限次数 + 指数退避（内部默认值入 defaultConfig）、Application 层 ReconnectCoordinator、UI Switch 启用 + 状态点 + 最终失败提示、Electron/VSCode 注入 openTransport、dev 探针 debug:fake-tcp-drop，三端 e2e 全绿）— PRD §8.3（2026-08-30，ADR-035，ADR-022 已知限制已解决）
- [x] [feat] Electron 文件持久化（应用数据目录 JSON 存储，`filesystem` 能力翻转）— PRD §8.3 / ADR-019 复审条件（2026-08-30，ADR-036：主进程 `WorkspaceFileRepository` 原子保存 + 单份 .bak + 损坏自愈，HostMessage v1 `workspace-load/save/clear`，Renderer 薄桥，`filesystem:"full"`，e2e 经 `MAMEP_USER_DATA_DIR` 隔离）
- [x] [feat] 更完整的键盘操作（快捷键注册表 + 两级分发（app/表格）+ Help 弹窗快捷键总览；app 级 Ctrl+,/Ctrl+Enter/Ctrl+//?/Ctrl+[/Ctrl+]/Ctrl+Alt+N/W/O/T/L/Ctrl+Shift+S，表格级 F9/F8/Ctrl+Shift+Enter/Alt+P/↑↓/Ctrl+Alt+R；浏览器保留键规避三端一致，焦点在输入/弹窗打开抑制，i18n 双语）— PRD §8.3（2026-08-30，ADR-037）
- [x] [plugin] 插件安装入口（Plugin Manager 弹窗内「Install Plugin」：本地 manifest JSON → 校验 → §6.10.4 安全确认 → 仅清单注册零代码执行；能力矩阵 pluginInstall + app 级持久化三端（IndexedDB/plugins.json/globalState）+ plugin-store-load/save kind）— PRD §8.3（2026-08-30，ADR-038）
- [x] [plugin] 安川公开协议示例插件（Phase C 已实施：`plugins/yaskawa-memobus-67h-010dh-010eh`，表类型 + 协议扩展 + ROM/RAM toolbarAction + 寄存器手册 documentation，ADR-041/043）— PRD §8.3
- [x] [feat] 浏览器兼容性检测（Web Serial 存在性 + 安全上下文检测；启动横幅 + 连接弹窗警告与替代方案 + CONNECT 禁用；`?compatMiss=1` dev 覆盖 + e2e `browser-compat.spec`）— PRD §8.3（2026-09-02，ADR-046）
- [x] [plugin] 插件可执行化（Phase F：插件卸载（仅 installed）+ 隔离机制（Web Worker / worker_threads + 通信桥）+ 单文件 JS 安装（`export manifest` + `export activate`，隔离线程加载）+ `executablePlugins` 三端翻转；Host 插件（Extension Host worker_threads）宿主装配为后续）— PRD §8.5 插件化（2026-09-01，ADR-044）
- [x] [refactor] 内置插件移出为独立插件（example-panel / yaskawa / custom-function-code / builtin-address-adjust 移入 `plugins/` 作为随应用分发插件——installed + 首次启动一次性安装 + 可禁用/卸载/恢复；安川命令写移入插件；禁止新增内置插件规范）— ADR-045（2026-09-02）

## 阶段三：V1.x 增强与探索（PRD §8.4 P2 / §8.5 P3）

**P2 增强（PRD §8.4）**

- [ ] [feat] 多活动连接（多连接并行；作为「每个标签页独立连接」「多设备并行监控(P3)」的架构前置，见 PRD §21.2）
- [ ] [feat] 每个标签页独立连接（依赖「多活动连接」的会话/连接支撑）
- [ ] [feat] Register Trace（MVP 已有 TM 追踪窗，此为完整形态；作为「数据曲线」「数据导出」「寄存器波形高级分析(P3)」的采样来源）
- [ ] [feat] 数据曲线（依赖 Register Trace 采样数据）
- [ ] [feat] 数据导出（导出采集/追踪数据，依赖 Register Trace 缓冲）
- [ ] [feat] 更细粒度的轮询调度（周期轮询与任务控制细化，§21.2「周期轮询依赖单行读取和任务控制」）
- [ ] [feat] 每行独立从站地址（连接寻址粒度扩展）
- [ ] [feat] 自定义波特率（MVP 为固定选项，此为开放输入）
- [ ] [feat] 32 位整数 / 32 位浮点数（32 位/64 位整数已由阶段二「多寄存器连续读写（范围行）」覆盖，ADR-030；32 位浮点数仍待实现）
- [ ] [feat] 字节序和字序配置（范围行默认大端，可配置化待做）
- [ ] [feat] 配置模板（可复用配置作为模板）
- [ ] [feat] 标签页分组（UI 标签分组）
- [ ] [feat] 项目或工作区文件（在已落地的工作区导入导出/持久化（ADR-033/036）上扩展为完整项目文件）
- [ ] [feat] 寄存器表 CSV 导入导出（寄存器表数据以 CSV 交换）
- [ ] [feat] 配置差异比较（多配置/工作区差异比对，依赖多配置并存）
- [ ] [feat] Register Dump（寄存器快照转储）
- [ ] [feat] Register Sequence（寄存器操作序列）
- [ ] [feat] CRC16 Calculator（独立计算工具）
- [ ] [feat] 多寄存器组合类型（已由阶段二「多寄存器连续读写（范围行）」覆盖：32/64 位整数 + ASCII 字符串，ADR-030；无新建开发量）
- [x] [docs] 寄存器手册插件（Phase E 已实施：`documentation` 贡献点 markdown + Help 弹窗 DocumentationPanel，安川插件贡献手册，ADR-043 E-5）

**P3 探索 / 插件化（PRD §8.5）**

- [ ] [feat] 脚本化调试（脚本化调试基础设施）
- [ ] [feat] 自动化测试序列（依赖脚本化调试/序列执行能力）
- [ ] [plugin] 厂商私有协议（插件化协议扩展，复用已落地的插件/自定义功能码(codec/dataType)基础设施（ADR-043/044））
- [ ] [plugin] 插件市场（TECH_DESIGN：待插件 API/签名/权限/隔离机制成熟后再开放；基于已落地的插件安装/持久化（ADR-038））
- [ ] [feat] Memory Access（设备内存访问）
- [ ] [feat] 设备描述文件（设备描述/配置文件）
- [ ] [feat] 团队配置共享（配置共享，基于工作区/配置基础设施）
- [ ] [feat] 寄存器波形高级分析（依赖 P2「Register Trace / 数据曲线」采样数据）
- [ ] [feat] 多设备并行监控（依赖 P2「多活动连接」）
- [ ] [feat] 远程代理方式的浏览器 Modbus TCP（注：浏览器**不直接支持** Modbus TCP 为产品红线，此 P3 项为「远程代理方式」，实施前需先经产品决策 / ADR 确认）
- [x] [feat] 线圈表（Phase E 核心内置：FC01 读/FC0F 写，bool 类型，侧边栏分组，e2e-web + e2e-vscode 闭环，ADR-043 E-1/E-2/E-6；TCP 承载未做）
- [x] [feat] 离散输入表（Phase E 核心内置：FC02 只读，ADR-043 E-1/E-2）
- [x] [feat] 输入寄存器表（Phase E 核心内置：FC04 只读，ADR-043 E-1/E-2）
- [x] [plugin] 自定义功能码（Phase E 示例插件 `plugins/custom-function-code`：FC65/FC66 codec + dataType 贡献，ADR-043 E-4）
- [ ] [feat] 更新检查（Electron 后续支持，VSCode 由 VSCode 管理）— PRD §8.3 / TECH_DESIGN §7 能力矩阵

**明确不计划实现（PRD §8.6，非待办）**：RPN Calculator、M@MEp2006 老式品牌 / 授权信息区 / 访问计数器 / 老式 Win32 顶层菜单、无提示的设备危险写入、为视觉复刻而保留的无实际价值控件。
