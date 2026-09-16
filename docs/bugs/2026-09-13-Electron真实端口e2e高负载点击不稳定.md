# Electron 真实串口 e2e：高负载下弹窗控件点击不稳定（not stable → detached）

- **日期**：2026-09-13
- **类型**：测试稳定性缺陷（非产品缺陷）
- **发现于**：`pnpm test:all` 全量回归，步骤 `test:e2e:electron`
- **影响文件**：`tests/e2e-electron/tests/diag-loop.spec.ts`、`tests/e2e-electron/tests/serial-rtu-loop.spec.ts`

## 现象

`pnpm test:all` 跑到 `test:e2e:electron` 时 2 个用例失败（其余 32 通过）；**单独跑 `pnpm test:e2e:electron` 则 34/34 全绿**。

失败用例与报错（均为 `locator.click` 超时 30s）：

| 用例                                 | 目标控件                                    | 报错                                                                 |
| ------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------- |
| 取消/无可用端口：下拉框空态…         | `Port` 表单项内的 `.ant-select`             | `element is not stable` → 重试 → `element was detached from the DOM` |
| 串口下拉选择 + FC03 读 + FC10 写闭环 | `Port` 表单项内的 `button[title="Refresh"]` | 同上                                                                 |

## 根因

Playwright 的 `click()` 含**行动性检查**：要求元素在**连续两帧**内包围盒一致（stability）。`test:all` 串行跑完前面 40 余分钟步骤（三端真实端口 e2e + 全仓单测 + 35 分钟浏览器 e2e）后机器负载高，连接设置弹窗的重排/重渲染使稳定性检查持续失败 → 重试 → 期间节点被替换（React 重渲染）→ `detached` → 直到超时。

单跑时无负载，故 100% 通过；这与「用例本身有 bug」不同，属**环境敏感的脆弱点击**。

## 修复

把这 2 个 spec 中针对弹窗控件（Port 下拉、Refresh 按钮）的 6 处点击改为 **`click({ force: true })`**：
保留 Playwright 的完整鼠标事件序列（antd Select 依赖 **mousedown** 才展开下拉），仅跳过包括稳定性在内的行动性检查。

> 中途试过、**不可行**的方案（已回退，记录以免再踩）：
>
> - `element.click()`（DOM click / `evaluate`）：**不派发 mousedown → antd Select 打不开**，反而让 5 个用例失败；
> - 纯 `click()`：即本次缺陷本身。

## 验证

- `pnpm test:e2e:electron`：**34 passed**（1.7 分钟，修复后两次运行均全绿）；
- `pnpm test:all`：全量重跑（见当日全量报告）。

## 附带发现（未处理，待决策）

`tests/e2e-electron/tests/diag-loop.spec.ts` 与 `tests/e2e-electron/tests/serial-rtu-loop.spec.ts` 是**同一份 spec 的重复副本**（303 行 vs 398 行，逐行对比仅排版换行差异），前者是后者的严格子集（少「范围行：多寄存器读/写闭环」一例，无独有覆盖）。
按 [docs/AGENTS.md](../../docs/AGENTS.md) 「临时诊断文件用完即删、不进正式 suite」的约定，建议删除 `diag-loop.spec.ts`（用例数 34 → 31，覆盖不减、运行更快、flake 面减半）；**因涉及删除已提交测试，未擅自处理，等确认**。
