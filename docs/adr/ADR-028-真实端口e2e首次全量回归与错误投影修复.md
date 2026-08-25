# ADR-028：真实端口 e2e 首次全量回归的问题修复与 HostMessage 错误投影 bug

- 状态：已确认
- 日期：2026-08-25
- 决策来源：用户指令「跑全量所有测试」→ 三端真实端口 e2e（ADR-024）首次真正完整执行，
  暴露并修复一批隐藏问题，其中含一个产品 bug（HostMessage 错误投影）。

## 背景

- ADR-024（2026-08-24）声明三端真实端口 e2e 已落地、覆盖双协议全矩阵，README ToDoList
  亦勾选「三端真实端口 e2e 全量回归」完成。**但实际从未真正跑通**：落地后受下述多层隐藏
  问题阻挠（从站脚本 bug → 测试选择器/断言错误 → 交互竞态 → 测试基础设施 → 产品 bug），
  直到 2026-08-25 用户要求全量测试、`pnpm test:e2e:real` 首次完整执行时才逐一暴露。
- 首次完整执行结果：三端 real 全部失败（electron 22 failed / 2 passed，vscode real 加载即
  SyntaxError，web 依赖人工选口未完成）；修复后三端全绿。

## 发现的问题与修复

### 1. 从站脚本：`LOG_LEVELS` 未导入（blocking）
- `scripts/modbus-slave/modbus-rtu-slave.mjs` 的 `loadConfig` 引用 `LOG_LEVELS` 但未从
  `lib/modbus-core.mjs` 导入 → 从站启动即 `ReferenceError` 退出 → 三端 real 全部
  「rtu-slave 提前退出」。
- 修复：补 import；`modbus-tcp-slave.mjs` 顺带把内联 `{ debug:1, info:1, warn:1, error:1 }`
  校验键统一为共享 `LOG_LEVELS`（原注释「未导出到本文件」已过时）。

### 2. 测试选择器：进制切换 `setRadixHex` 用错组件类（blocking）
- 地址进制切换控件是 antd `Segmented`（渲染 `.ant-segmented`），real 套件 `setRadixHex`
  却用 `.table-toolbar__radix .ant-select`（Select 类）→ 首个连接用例在切 HEX 处 30s 超时；
  失败后 UI 状态残留**连锁污染**后续用例（弹窗/遮罩拦截点击），放大为批量失败。
- 修复：5 个 real spec（web/electron/vscode）改用 `.table-toolbar__radix .ant-segmented-item`
  （对齐主套件 `register-radix.spec.ts`）。
- 根因：ADR-014（进制切换 Segmented 化）未同步到 real 套件，且 ADR-024 从未真正执行过。

### 3. React 受控组件竞态：`fill` + 立即 `Enter` 提交被跳过
- 共享 UI `EditableCellValue.commit` 用 `draft === value` 判「未修改不提交」，且 `draft` 是
  React state（闭包捕获渲染时的值）；自动化 `input.fill()` 触发 `onChange`（异步
  `setDraft`）后立即 `press("Enter")`，`commit` 闭包仍读到旧 draft → 地址/Data 提交被跳过
  （表现为地址列保持旧值、读错区）。真实用户打字有间隔，但快速输入同样可能触发。
- **修复（UI 根治，2026-08-25 二次修复）**：`EditableCellValue` 增加 `draftRef`（ref 同步追踪
  最新草稿：`startEdit`/`onChange` 均同步写 ref），`commit` 改读 `draftRef.current`——不受
  React 并发渲染延迟影响。首次仅做测试侧修复（`fill` 后 `waitForTimeout(50)`），但高负载
  （`all` 编排串行跑）下仍偶发失败，根治后才稳定。测试侧等待保留为保险。
- 验证：`packages/ui` 单测 151 全绿；electron / vscode real 三端延迟响应用例稳定通过。

### 4. 通信日志断言：虚拟列表只渲染视口内行
- `BottomPanel` 用 antd `Listy` 虚拟列表，`toContainText` 只匹配渲染出的可见行；real 套件
  共享会话累积日志，早期帧被滚动挤出视口 → 断言历史帧失败。
- 修复：通信日志用例改为测试内 Clear（`panel.clear` 按钮）+ 重建目标帧（写值门控异常
  0x03、只读区异常 0x02、读 0x0000）。

### 5. **产品 bug：HostMessage 错误投影硬编码 userMessageKey / category**
- `apps/electron/src/main/ipc.ts` 与 `apps/vscode-extension/src/ipc.ts` 的 `errorEnvelope`
  把会话错误统一投影为 `userMessageKey: "errors.hostMessageRejected"`（category 也硬编码，
  Electron 侧连传入都漏掉）；`toErrorPayload`/`fromErrorPayload`（packages/platform-api）
  虽完整往返全部字段，但被 `errorEnvelope` 构造时覆盖。
- 后果：Electron/VSCode 的 **TCP 路径**下所有会话错误（含设备异常 MODBUS_EXCEPTION、
  超时 REQUEST_TIMEOUT）在 UI 显示原始 key `errors.hostMessageRejected`（i18n 无该 key），
  `aria-label`/状态点错误消息全错。RTU 本地路径（Renderer 直连，不走 IPC）正常，掩盖了 bug。
- 修复：`errorEnvelope` 增加 `category`/`userMessageKey` 参数（默认保持现状），
  `sessionResult`/`sessionVoid` 失败分支把 `result.error.category`/`result.error.userMessageKey`
  原样传入。

### 6. 从站延迟响应配置低估重试窗口
- RTU 无 Transaction ID，重试请求与原始请求完全相同；0x0700 `delayedResponse: 1500ms` 落在
  1000ms×2（retryCount=1）重试窗口内，迟到响应被当作重试响应消费 → 读「成功」无 error 点
  （TCP 有 tid 丢弃机制不受影响）。
- 修复：`modbus-slave*.config.json` 0x0700 延迟改为 2500ms（落在窗口外，验证迟到丢弃路径）。

### 7. VSCode real 模块加载：缺 `"type": "module"`
- `tests/e2e-vscode/real/*.spec.ts` 用 `import.meta`，包未声明 `"type": "module"` →
  `SyntaxError: Cannot use 'import.meta' outside a module`（主套件是 tsc 编译 CJS 产物，
  不受影响）。
- 修复：`tests/e2e-vscode/real/package.json` 单独声明 `"type": "module"`。

### 8. vscode-test-playwright@0.0.1-beta2 与 Playwright 1.62 不兼容
- 库调用已移除的内部 API `playwright._toImpl`（3 处：`_evaluator`×2 + `_enableRecorder`×1），
  且无更新版本（npm latest = 0.0.1-beta2）。
- 修复：**pnpm patch**（`patches/vscode-test-playwright@0.0.1-beta2.patch` +
  `pnpm-workspace.yaml` `patchedDependencies`）——`_evaluator` 改用公开
  `electronApp.process()`（VSCodeTestServer URL 打印在 stderr，库的 `waitForLine` 本就读
  stderr），`_enableRecorder` 省略关闭监听（仅本地手动录制用）。

### 9. VSCode webview 两层结构：frame 定位错误
- VSCode 1.134 webview 为两层：容器 frame（`vscode-webview://.../index.html`）+ 内容 frame
  （`.../fake.html`，承载共享 UI 的 `#root/.ant-app`）。`waitForWebviewFrame` 按 URL 前缀
  匹配到容器层 → UI 操作全部落空（弹窗找不到、主题 token 读不到）。
- 修复：改为定位含共享 UI 的内容 frame（`document.querySelector("#root .ant-app,
  .ant-layout")` 轮询）。

### 10. 串口下拉定位：误点「Load from Config File」连接对象下拉
- ADR-023 后弹窗首个 `.ant-select` 是「Load from Config File」连接对象下拉（非串口）；
  real-serial 点 `.ant-select` first 误点它。e2e-electron 恰好因连接对象名
  「COM4（com0com 主站…）」含 "COM4" 且 `applyConnection` 自动匹配串口而**侥幸通过**；
  VSCode 因测试工作区未加载 config 连接而失败——该「通过」实为脆弱巧合。
- 修复：三端 real-serial 按 Port Form.Item 语义定位串口下拉（`filter({ hasText: "Port" })`）。

### 11. `electron-smoke.spec.ts` 白名单断言漏 `sessionSetUnitId`
- ADR-026（TCP Unit ID 动态修改）新增 preload 桥方法，主套件「Renderer 安全边界」白名单
  断言未同步 → Electron 主套件 e2e 失败。补入断言。

## 验证结果（2026-08-25）

- 单测：`@mamep2026/electron` 57 / `@mamep2026/vscode-extension` 49 全绿（errorEnvelope
  改动后）。
- 主套件 e2e：浏览器 73 / Electron 17 / VSCode all checks passed。
- **真实端口 e2e：web 12 / electron 24 / vscode 3 全部通过**（ADR-024 首次真正全绿）。

## 经验教训

- **「已落地」≠「已跑通」**：ADR-024 的验收结论不成立，real e2e 因多层隐藏问题从未真正
  全绿。新落地的大型测试套件必须以**完整可执行回归**为验收标准，不能以「用例就绪/门控
  通过/环境 SKIP」为准。
- **测试基础设施版本漂移**：vscode-test-playwright（beta）等测试库与主框架（Playwright）
  版本漂移需在首次执行时验证；对无新版的已弃 API 用 pnpm patch（`patchedDependencies`）
  记录式修复。
- **real 套件与主套件共用 UI 选择器需保持同步**：ADR-014（Segmented 化）等 UI 变更需
  同步到所有引用该控件的测试。
- **错误投影属于安全边界**：HostMessage 错误 Envelope 是跨边界契约，字段（code/category/
  userMessageKey/technicalMessage）应原样往返，不得在宿主侧覆盖语义字段。
