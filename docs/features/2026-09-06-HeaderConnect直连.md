# Header「Connect」按钮直连（连接流程 UX 优化）

> 日期：2026-09-06　状态：进行中
> 关联决策：ADR-022（TCP 设置）/ ADR-046（浏览器 CONNECT 门控）/ ADR-041（连接协议按活动表类型）

## 需求摘要

Header 主「Connect」按钮：Modbus RTU 若已选择 Port、或 Modbus TCP 若已填入 IP 地址，则不再弹出连接设置弹窗而是直接连接；关键字段缺失/未选时仍弹窗引导填写。

## 边界条件

- 仅 Header 主 `Connect` 按钮参与直连；Header 右侧独立「Connection」设置按钮始终打开弹窗（不变）。
- 已连接时点 `Connect` 仍为断开（现有语义不变）。
- 浏览器仅 RTU（能力矩阵门控）；TCP 直连仅 Electron/VSCode。
- Mock 模式（`?mockTransport=1`）启动即自动连接；断开后点 `Connect` 可无端口直连（`null` handle）。
- 直连传输协议取存储 profile 的 `protocol`（决策 3）；codec 协议按活动表经 `protocolForSheetType` 传入（与弹窗一致）。

## 异常场景

- 存储 profile 为 RTU 但无已选端口（真实模式）→ 弹窗引导选口。
- 存储 profile 为 TCP 但 `host` 为空 → 弹窗补填。
- 浏览器兼容性失败（无 Web Serial / 非安全上下文）→ 弹窗（展示警告 + CONNECT 禁用）。
- 平台不支持所选传输协议 → 弹窗。
- 连接中/断开中/重连态重复点击 → 防抖/忽略，避免并发连接。
- 直连失败 → 回退弹窗并展示错误（决策 5）。

## 性能与安全

- 仅 UI 连接流程分流；零协议层/调度器改动，不新增 HostMessage kind。
- 串口端口句柄仅会话内存，不持久化（遵守 docs/AGENTS.md §19.3，禁止自动连接记忆端口）。
- 不引入第三方库。

## 影响模块

| 包/端           | 文件                                            | 改动原因                                                                     |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| packages/domain | `src/workspace-model.ts`                        | `createDefaultTcpProfile()` 默认 `host` 置空（删除默认占位，决策 2）         |
| packages/ui     | `src/app-store.ts`                              | 新增会话内串口选择/错误状态与 setter（决策 1/5）                             |
| packages/ui     | `src/connection-actions.ts`（新增）             | 共享「直连条件判定 + 连接执行」纯逻辑                                        |
| packages/ui     | `src/components/ConnectionSettingsModal.tsx`    | 串口/错误态改读写 store；复用共享 connect                                    |
| packages/ui     | `src/MamepApp.tsx`                              | Header `handleConnectToggle` 直连分流                                        |
| packages/ui     | `src/i18n`                                      | 如需新增提示文案（优先复用既有 `errors.*` key）                              |
| packages/ui     | 相关测试                                        | `MamepApp.test` / `connection-actions.test` / `ConnectionSettingsModal` 相关 |
| docs            | `docs/features/2026-09-06-HeaderConnect直连.md` | 本文件                                                                       |

## 计划（Plan 摘要）

1. domain：`createDefaultTcpProfile()` `host` 由 `"127.0.0.1"` 改为 `""`。
2. store：新增 `selectedSerialHandle` / `selectedSerialPortId` / `connectError` 与 `setSerialSelection` / `setConnectError`（会话内，不持久化）。
3. `connection-actions.ts`：`canDirectConnect`（TCP 能力+host 非空；RTU mock 或已选口且非串口阻断）+ `runConnect`（统一 `host.connect` / `connectTcp`）。
4. Modal：局部串口/错误态改读写 store；`afterOpenChange` 清错误移到关闭；`onSubmit` 复用 `runConnect`。
5. MamepApp：读 profile/串口状态；`handleConnectToggle` 分流；直连失败写 store 错误并回退弹窗；防重复触发（连接忙态 + ref）。
6. 范围边界：Header「Connection」按钮与「Ctrl+Enter」仍打开弹窗（不改）。

## 测试策略

- 新增 `connection-actions.test.ts`：`canDirectConnect` 分支（RTU 已选/未选、mock、串口阻断、TCP host 空/非空、TCP 能力门控）+ `runConnect` 路由（TCP→connectTcp / RTU 真实→带 handle / RTU mock→null handle）。
- `connection-settings-model.test.ts` 校对（默认 TCP host 变空）。
- **集成/UI 级**：Header `Connect` 点击路由（直连 vs 弹窗）因 jsdom 下渲染完整 `MamepApp` + 打开连接设置弹窗会触发 antd `getComputedStyle` 循环、令 vitest 进程崩溃（与 AGENTS「重 jsdom 组件测试本就慢」一致），**未纳入 jsdom 单测**；该 UI 级连接流程改由 **e2e**（`tests/e2e-web` 等，`app.spec.ts` 连接流程）覆盖。
- 回归：`pnpm --filter @mamep2026/ui test` + `pnpm typecheck` + `pnpm lint`。
- 执行时机：**由用户决定**（docs/AGENTS.md §27）；不得谎报。

## 风险与回滚

- 风险：串口选择状态提升到 store 影响弹窗生命周期；`createDefaultTcpProfile` 默认 host 变空可能影响依赖默认 host 的测试/real e2e（真实 e2e 用 `config/connections.json` host，不依赖默认，需逐一核对）；Header 直连采用持久化 profile（与弹窗关闭落盘一致），表单未保存值不参与直连。
- 回滚：改动集中在 ui 层 + domain 一个字段，可逆；保留原 `handleConnectToggle`（仅弹窗）即可整体回退。
