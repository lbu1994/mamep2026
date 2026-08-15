---
name: browser-e2e-testing
description: 在 VS Code 内置浏览器中对 Web 工程执行自动化交互验证（打开页面 → 交互 → 断言）。适用于浏览器端 E2E、界面改动后的冒烟自检、Playwright 交互调试，以及 Mamep2026 的 mockTransport E2E 验证。关键词：E2E、Playwright、read_page、无障碍快照、run_playwright_code、mockTransport、控制台错误检查。
---

# 浏览器端自动化测试（Browser E2E）

> 详细方法与完整代码模式见 [docs/浏览器端自动化测试方法指南.md](../../../docs/浏览器端自动化测试方法指南.md)。本技能是执行要点提炼。

## 何时使用

- 需要"打开页面 → 交互 → 断言"的自动化验证（手动或脚本化）
- 界面改动后的冒烟自检：关键布局在、状态流转正确、无控制台错误
- Mamep2026 浏览器 E2E 用例（`tests/e2e-web/tests/*.spec.ts`，Playwright 使用系统 Edge，`channel: "msedge"`）
- 手工用内置浏览器辅助调试 UI（先用 `?mockTransport=1` 规避真实串口授权）

## 核心工作流

1. **后台起 dev server**：`run_in_terminal`（`mode: async`），如 `pnpm dev`。Mamep2026 页面 URL 为 http://localhost:5173/。
2. **打开浏览器**：`open_browser_page` 拿到 `pageId`，后续所有浏览器操作复用同一 `pageId`。
3. **读快照**：`read_page` 返回无障碍快照（元素层级 + 文本 + ref）。**这是主要验证手段**，截图仅辅助。快照过大时会写入临时文件，用返回的文件路径 `read_file` 读取。
4. **交互**：简单点击用 `click_element`（传 ref 或 CSS/role 选择器）；复杂/批量操作用 `run_playwright_code` 一段脚本完成。
5. **断言**：交互后再次 `read_page`，或用 Playwright 脚本把关键值读出来返回 JSON 核对。
6. **收尾抓 console 错误（必做）**：挂 console/pageerror 监听 → reload → 做一轮交互 → 返回 errors。
7. **清理**：`kill_terminal` 杀掉后台 dev server（或留着供用户预览）。

## 关键技巧（极易踩坑）

- **先设真实桌面视口**：`await page.setViewportSize({ width: 1600, height: 900 });`。默认视口很窄会把桌面布局压塌、触发响应式分支导致误判。
- **持续轮询/动画时 `.click()` 会超时**（元素被判定"不稳定"）：用 `await page.getByRole("button", { name: "X", exact: true }).evaluate((el) => el.click());` 原生触发。
- **优先快照而非截图**：`screenshot_page` 返回的图片对本模型不一定可见；以 `read_page` 为准。
- **选择器优先于 ref**：`read_page` 里的 `e10` 这类 ref 每次重渲染后会变；多次/断言请用 CSS/role/文本选择器。
- **`run_playwright_code` 必须是纯 JS**（不能写 `el as HTMLElement` 这类 TS 语法），`return` 可 JSON 序列化的值，异步操作要 `await`。
- **未跑完会返回 `deferredResultId`**：用同一 `pageId`、不带 code 再调用一次拿结果。
- **antd v6 Modal 结构变了**：没有 `.ant-modal-content`，改用 `.ant-modal-container` / `.ant-modal-body` 定位弹窗内元素。
- **antd v6 Tabs 结构变了（页面有两个 Tabs 时极易误匹配）**：
  - 活动面板 DOM 类是 `.ant-tabs-content-active`（**不是** v5 的 `.ant-tabs-tabpane`，v6 无 tabpane 类）。Mamep2026 主表格页签类名是 `.register-table-tabs`，断言表格列头/单元格时选择器必须限定 `.register-table-tabs .ant-tabs-content-active ...`，否则会误匹配 BottomPanel 的页签。
  - `+` 新建按钮 `.ant-tabs-nav-add` 在 DOM 出现两次，可见的在 `.ant-tabs-nav-list` 内，用 `.ant-tabs-nav-list .ant-tabs-nav-add` 定位。
  - 页签关闭按钮 `.ant-tabs-tab-remove` 是 `div[role=tab]` 的兄弟节点，定位用 `.ant-tabs-tab` 容器 hasText + 后代 remove，不能从 `getByRole('tab')` 下找。
- **antd v6 `List` 已弃用**：使用会在 dev console 报弃用警告，污染「无 console 错误」断言。虚拟列表用 `Listy`（`items`+`itemRender`，渲染类 `.ant-listy-item`）。PluginManager 已用它。
- **弃用/错误用法导致 dev console.error**：e2e 断言「无 console 错误」前，改动 UI 组件后务必检查没有使用已弃用的 antd API（如 `List`、`Tag bordered`、`Space direction` 等）。
- **HMR 会让服务单例脱钩**：改了服务模块后遇到诡异状态先整页 `reload`。
- **弹窗（antd Modal）里选 Select**：先对目标 Select 容器 `dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))` 打开下拉，再点 `.ant-select-dropdown:visible [title="选项文字"]`。别用 `:has-text` 匹配 label。
- **日志面板**：`allInnerTexts()` 返回当前渲染行；要看最新日志取数组**末尾**。

## Mamep2026 专用要点

- **Mock 传输**：dev server 下访问 `http://localhost:5173/?mockTransport=1`（生产构建不包含）。页面暴露 dev-only 钩子 `window.__mamepMock`：
  ```js
  await page.evaluate(() => window.__mamepMock.setRegister(0x0001, 0x1234));
  const reg = await page.evaluate(() => window.__mamepMock.getRegister(0x0001));
  ```
- **Mock 模式启动不弹** Connection Settings：直接用默认 RTU 配置自动连接模拟设备。就绪信号 = header 出现 `DISCONNECT` 且无可见 `.ant-modal-container`。
- **非 Mock 模式**：启动自动弹 Connection Settings Modal，需断言 `.ant-modal-container` 存在与默认参数（Slave Address=1、Rx Delay=50ms、Address Adjust=OFF）。
- **连接按钮是单按钮**：离线 `CONNECT` / 在线 `DISCONNECT`，用 `getByRole('button', { name: /CONNECT|DISCONNECT/ })` 断言切换。
- **通信日志断言**：日志行仅含 时间/方向/字节 三要素，只检查大写十六进制字节串（如 `01 03 00 00 00 01 84 0A`），不检查功能码解析字段。

## 每轮开发后自检模板

```js
// 1) 设视口
await page.setViewportSize({ width: 1600, height: 900 });
// 2) 刷新 + 抓错误
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.reload();
await page.waitForTimeout(600);
// 3) 冒烟：连一连、读一读、点开弹窗
await page
  .getByRole("button", { name: "api Connect", exact: true })
  .evaluate((el) => el.click());
await page.waitForTimeout(1200);
// 4) 断言关键状态（自定义）
const chip = (await page.locator(".conn-chip").innerText()).trim();
// 5) 返回结果 + 错误
return JSON.stringify({ chip, errors });
```

断言项参考：核心布局在（顶栏/侧边栏/表格/底栏）、关键列顺序、状态流转、弹窗可开合、刷新后状态不恢复运行、窄视口下仍可操作、无控制台错误、无未释放定时器。
