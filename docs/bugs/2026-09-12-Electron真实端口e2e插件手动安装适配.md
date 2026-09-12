# Electron 真实端口 e2e 未适配 ADR-054「插件一律手动安装」（自定义功能码用例失败）

> 日期：2026-09-12　状态：已验证
> 关联 ADR：[ADR-054](docs/adr/ADR-054-删除随包插件机制与插件同进程执行.md)（删除随包插件机制）/ [ADR-043](docs/adr/ADR-043-插件PhaseEP3精选与dataType扩展与VSCodeCodec接线.md)（自定义功能码示例插件）/ [ADR-024](docs/adr/ADR-024-三端真实端口e2e测试.md)（真实端口 e2e）

## 现象

`pnpm test:all` 在步骤 2（`test:e2e:electron:real`）失败并中止（fail-fast）：

```
✘ 12 tests-real\real-serial.spec.ts:451 › 基础表与自定义功能码（真实端口）：FC01/FC02/FC04/FC0F + FC65/FC66
    TimeoutError: locator.evaluate: Timeout 30000ms exceeded.
    waiting for getByRole('button', { name: 'Custom FC 65H/66H (example plugin)', exact: true })
✘ 13 tests-real\real-serial.spec.ts:537 › 断开连接 → Offline，可重连 → Online（稳定性）
    TimeoutError: locator.click: Timeout 30000ms exceeded.
    waiting for getByRole('button', { name: /Disconnect/i })
```

页面快照（第一个失败）显示：侧边栏只有核心分组（`Coils (01H/0FH)` / `Discrete Inputs (02H)` / `Input Registers (04H)`），**没有**自定义功能码分组；聚合 25 passed / 2 failed。

## 根因分析

- **主因**：`tests/e2e-electron/tests-real/real-serial.spec.ts` 仍按 ADR-045 时代的假设编写——「自定义功能码」侧边栏分组来自 `plugins/custom-function-code` 的 `tableType` 贡献，而该插件当年是**随包一次性安装**（`seeded`）。ADR-054（2026-09-12）删除随包机制，并把插件存储 schema 3→4、**对 v1/v2/v3 一律清空 `plugins`** → 首次启动后本地已无该插件，分组自然不存在（该 spec 未做手动安装）。
- **次因（级联，非独立缺陷）**：Playwright 在一个用例失败后会**重启 worker**，`test.beforeAll` 因此重跑（重新 `_electron.launch` + 清工作区 + `page.reload()`）→ 应用回到「未连接、仅 Sheet 1」的初始态，而随后的「断开连接 → 重连」用例假定前一用例已把连接恢复到 Sheet 1（该用例本身只是**继承了前一用例留下的连接态**）。故失败 2 是失败 1 的级联表现：修好失败 1（用例不再失败 → 不重启 worker → 连接态被正确继承）即消失。
- 附带隐患：`tests/e2e-electron` 的 `pretest` / `pretest:real` 只跑 `build:electron`，**未构建插件产物**（`release/plugins/**` 已 gitignore）；`plugin-host-execution.spec.ts` 依赖 `release/plugins/builtin-address-adjust/*.mjs`，在干净环境单独跑会失败（本次 `test:all` 中因前序步骤 `test:e2e:web` 已构建而掩盖）。

## 复现测试（强制）

- 测试文件：`tests/e2e-electron/tests-real/real-serial.spec.ts`（`MAMEP_REAL=1`，由 `scripts/e2e-real.mjs` 编排 com0com + 从站）。
- 预期失败（红）：`pnpm test:e2e:electron:real` → 上述 2 个用例失败（25 passed / 2 failed）。
- 修复后（绿）：同一命令 **28 passed**（新增「安装 custom-function-code 插件」用例后总数 27→28）。

## 修复方案

- 方案（测试侧适配 ADR-054，不改产品代码）：
  1. 新用例「安装 custom-function-code 插件（ADR-054：手动安装 + 同进程执行）」：先断言侧边栏**无**自定义功能码分组（无插件基线）→ 经 Settings → Plugins 安装 `pnpm build:plugins` 产物（生产构建走主进程 `open-text-file` → `dialog.showOpenDialog`，系统对话框无法自动化，沿用 `plugin-host-execution.spec.ts` 的 `app.evaluate` 桩替换对话框）→ 在确认框中选 **Same process**（codec / dataType 属同步注册面）→ 断言分组出现。
  2. `beforeAll` 清理 `userData/plugins.json(.bak)`，保证每次从「未安装任何插件」基线开始（与既有 `clearWorkspaceFile` 同理；否则上次运行残留的插件会让分组已存在、重复安装注册失败）。
  3. 基础表/自定义功能码用例改用共享常量 `CUSTOM_FC_GROUP_LABEL` 定位分组。
  4. `tests/e2e-electron/package.json` 的 `pretest` / `pretest:real` 前置 `pnpm -w build:plugins`（与 `test:e2e:web` / `test:e2e:vscode` 一致，插件 e2e 依赖 `release/plugins/` 产物）。
- 影响文件：
  - `tests/e2e-electron/tests-real/real-serial.spec.ts`（新增安装 helper + 新用例 + 基线清理 + 常量）
  - `tests/e2e-electron/package.json`（`pretest` / `pretest:real` 增 `build:plugins`）
- 兼容处理：无产品代码改动；无能力矩阵 / HostMessage v1 / 工作区 schema / 协议层变更。

## 影响范围与回归

- 受影响模块：仅 Electron 真实端口 e2e 套件（测试基建）；产品行为无变化。
- 回归测试（已执行，2026-09-12）：
  - `pnpm test:e2e:electron:real` **28 passed**（定向验证修复）。
  - **`pnpm test:all` 全量 11 步全绿**（run `run-20260912-235452-854`，status `passed`）：
    - 真实端口 e2e：web 14 / electron 28 / vscode 3
    - 单测（turbo，34 包）：全绿（含 ui 399、plugin-api 76）
    - acceptance 5
    - mock e2e：web **156**（含新增 `plugin-panel.spec.ts` 2 例）/ electron 34 / vscode 全绿
    - serial-virtual 126
    - lint EXIT=0、typecheck 32/32
- 执行时机：**由用户决定**（docs/AGENTS.md §27）。
- 经验：**ADR 改变插件分发/安装模型后，须逐个套件检查其对「插件是否已安装」的隐含假设**（尤其真实端口套件：仅 mock 套件在 ADR-054 时被同步改写）；Playwright 用例失败会重启 worker 并重跑 `beforeAll`，**依赖前一用例遗留状态的用例会级联失败**，定位时应先修主因再看级联是否自愈。
