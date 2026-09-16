# Modbus RTU「超时(毫秒)」默认值与 Select 控件

> 日期：2026-09-06　状态：完成
> 关联：ADR-022 连接设置字段 / RTU profile。纯连接设置 UI 打磨，无新增 ADR。
>
> **修订（2026-09-16）**：RTU 超时档位上限由 100 ms 放宽至 1000 ms（新增 13 个长超时档位，表单与持久化 schema 上限同步放宽），见 [2026-09-16-RTU超时档位扩充.md](2026-09-16-RTU超时档位扩充.md)；本文中「5–100」的取值描述以该文档为准。

## 需求摘要

Modbus RTU 通信选项「超时(毫秒)」默认值由 1000ms 改为 50ms；输入控件由数字输入（`InputNumber`）改为下拉框（`Select`），固定选项 `5/10/…/100ms`（步进 5ms，共 20 项），无自定义输入；与旧软件「全下拉优先」风格一致。

## 边界条件

- **范围**：仅 RTU 超时改为固定 `Select`；RTU 与 TCP 超时字段在表单层**分开**（`rtuTimeout` / `tcpTimeout`），互不串值。
- **默认值**：`defaultConfig.rtu.requestTimeoutMs` 与 `defaultConfig.tcp.requestTimeoutMs` 均 1000→50。
- **固定档位**：5, 10, …, 100（步进 5，共 20 项）；默认 50。
- **schema 收窄**：RTU 超时表单与持久化 schema 均收窄为 `5–100`（`min(5).max(100)`）；TCP 超时维持 `50–60000`（控件仍为 `InputNumber`，默认 `?? 50`）。
- 不改动：同组 Rx Delay（`interRequestDelayMs`，另有独立待办）、Header、能力矩阵、HostMessage v1、调度器、协议层。
- 旧持久化/配置文件中的 `requestTimeoutMs > 100` 值不做迁移、不做截断（用户确认「不做特别处理」），新 schema 下超界值在 `setConnectionSettings` 写回时会被拒绝。

## 异常场景

- 旧工作区含 RTU `requestTimeoutMs > 100`：加载工作区不受影响（workspace schema 仍 `min(0)`），但经连接设置 `extractPersistedSettings` 写回时因持久化 schema 收窄被拒绝，profile 保持原值（用户已确认接受）。
- RTU `Select` 与「占位值」：`profileToValues` 为另一协议填充占位默认（引用 `defaultConfig`），切协议不串值。

## 性能与安全

- 纯表单控件与默认值改动，零协议/跨端/HostMessage 改动，无安全影响。

## 影响模块

| 包/端           | 文件                                                                                   | 改动原因                                                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/domain | `src/config.ts`                                                                        | `rtu.requestTimeoutMs` / `tcp.requestTimeoutMs` 1000→50                                                                                                                                                                                                                                                         |
| packages/domain | `src/config.test.ts`                                                                   | 断言 1000→50                                                                                                                                                                                                                                                                                                    |
| packages/ui     | `src/components/connection-settings-model.ts`                                          | 新增 `RTU_TIMEOUT_OPTIONS`；`settingsSchema` 拆 `rtuTimeout`(5–100)/`tcpTimeout`(50–60000)；`rtuPersistedSettingsSchema.requestTimeoutMs` 收窄 5–100；`toProfile`/`profileToValues`/`extractPersistedSettings` 按协议分别映射（顺带修复 RTU `toProfile` spread 未映射 `timeout`→`requestTimeoutMs` 的潜在缺口） |
| packages/ui     | `src/components/ConnectionSettingsModal.tsx`                                           | RTU 超时 `name="rtuTimeout"` 改 `Select`（`showSearch` 支持手动输入，仅范围内档位可选；`RTU_TIMEOUT_OPTIONS` 5..100 步进 5 共 20 项）；TCP `name="tcpTimeout"` 保留 `InputNumber`                                                                                                                               |
| packages/ui     | `src/components/connection-settings-model.test.ts`                                     | 字段改名 + 范围断言                                                                                                                                                                                                                                                                                             |
| packages/ui     | `src/app-store.test.ts`                                                                | `setConnectionSettings` 用例改 5–100 内 / 默认断言 50                                                                                                                                                                                                                                                           |
| packages/ui     | `src/components/ConnectionSettingsModal.tcp.test.tsx`                                  | 适配新字段/控件                                                                                                                                                                                                                                                                                                 |
| apps/web        | `src/AppHost.ts` / `electron-app-host.ts` / `vscode-app-host.ts`                       | `?? 1000` 兜底统一改 `?? defaultConfig` 引用                                                                                                                                                                                                                                                                    |
| config          | `connections.json` + `README.md`                                                       | `requestTimeoutMs` 1000→50（真实端口 e2e 连接对象，匹配 Select 上限）                                                                                                                                                                                                                                           |
| tests           | `tests/e2e-*/tests-real/real-serial.spec.ts`、`tests/e2e-vscode/real/real-rtu.spec.ts` | 真实端口 e2e 连接流：RTU 超时经 `showSearch` 手动输入（键入数值+Enter）设为 100ms（应用默认维持 50ms），替代点击下拉项；延迟响应用例注释/等待时机改用例                                                                                                                                                         |

## 计划（Plan 摘要）

1. `defaultConfig`：RTU 与 TCP 超时默认 1000→50。
2. `settingsSchema` 拆 `rtuTimeout` / `tcpTimeout`；`rtuPersistedSettingsSchema.requestTimeoutMs` 收窄 5–100。
3. `toProfile` / `profileToValues` / `extractPersistedSettings` 按协议分别映射。
4. `ConnectionSettingsModal`：RTU 超时改 `Select`（`RTU_TIMEOUT_OPTIONS`），TCP 保留 `InputNumber`。
5. 三处生产兜底 `?? 1000` → 引用 `defaultConfig`。
6. `config/connections.json` + 真实端口 e2e 改用例。

## 测试策略

- 新增/修改测试：`config.test.ts`、`connection-settings-model.test.ts`、`app-store.test.ts`、`ConnectionSettingsModal.tcp.test.tsx`。
- 回归：受影响包单测（domain/ui/web/vscode-extension/communication/workspace）+ `pnpm typecheck` + `pnpm lint`；真实端口 e2e 改用例后跑（`test:e2e:*:real`，需 com0com/从站环境）。
- 执行时机：**由用户决定**（docs/AGENTS.md §27）；不得谎报。
- **验证（2026-09-06）**：单测 domain 57 / communication 124 / ui 325 / web 85 全绿；typecheck 27/27、lint 通过；**Electron 真实端口 e2e `pnpm test:e2e:electron:real` 27/27 全绿**（RTU 超时经 `showSearch` 手动输入设 100ms，应用默认维持 50ms；延迟响应/通信日志/写后回读/基础表/断开重连均通过）。web/vscode 真实端口 e2e 已同步改用例，需各自环境（web 需系统 picker 选 COM4；vscode 需 build:vscode）。

## 风险与回滚

- 风险 1：RTU 持久化 schema 收窄至 100 后，含旧 >100 值的工作区写回被拒（用户已确认接受）。
- 风险 2：RTU 默认 50ms 较激进，慢设备可能超时；com0com 下偏紧（真实 e2e 通过为测试连接手动设 100ms 规避）。若 com0com 延迟 >100ms 仍可能不稳（用户已确认接受该风险，见 ADR 决策）。
- 风险 3：手动输入 e2e 依赖 antd `showSearch` + 键入+Enter 交互，若 antd 行为变化可能不够稳健（当前已验证可用）。
- 回滚：`defaultConfig`、schema、modal、兜底改动可独立 revert；改回 1000 与 `InputNumber` 即回原状。
