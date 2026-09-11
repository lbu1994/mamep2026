# ADR-053：Type/Scale 切换即时刷新显示格式（原始值不变）

- 状态：已确认并实施
- 日期：2026-09-11
- 决策来源：用户任务（ToDoList「寄存器格式（Type）选择之后，立即更新寄存器列的格式显示，但不做进制变换」），
  经澄清确认 6 项决策；本 ADR 记录该行为语义与其对 docs/AGENTS.md §17 规则的修订。

## 背景

- Data 列直接渲染持久化的 `cellText`，而该文本只在两处生成：
  - **读取成功**：`applyReadValueToRow` / `applyReadValuesToRow` 按**当时**的 `dataType` 格式化
    （`formatRawValue` / `formatRawValues` / `resolver.format`）；
  - **Data 编辑提交 / 粘贴**：按当时 `dataType` 解析后写回规范形式（ADR-051）。
- `setRowDataType`（Type 进制列 / Scale 列切换的唯一入口）只改 `dataType`，**不触碰文本**，于是切换后
  Data 列仍显示旧格式：读回 `UNSIGNED=171` 显示 `171`，切到 `HEX` 后仍显示 `171`，所见与 Type 指示不一致。
- 更严重的隐患在**写入路径**：`table-service.writeRow` 按 `row.cellText` + **当前** `dataType` 解析
  （范围行 `parseCompositeText`；单寄存器 `resolver.parse`）。切换 Type 后未编辑直接 Write：
  - `171`（原 UNSIGNED）会被按 HEX 解析为 `0x171 = 369` 写出 —— 即真正的「把值做进制重新换算」；
  - `00AB`（原 HEX）切 UNSIGNED/BINARY 则解析失败（不发送，报校验错误）。
- `docs/AGENTS.md` §17 原规则「Type 切换不改写单元格文本」与本需求冲突，需修订；
  §40.5（数据自检）「Type 切换是否保持原始值」给出不可越过的底线。
- 已实时派生的先例（无需改动）：范围行**子行**按子行自身 Type 从 `registerValues[i]` 现算
  （`packages/ui/src/tree-rows.ts`）、位明细行由 `registerValues`/`cellText` 现算（ADR-052）、
  Trace 面板按 `formatRawValue` 现算。

## 决策（用户确认）

1. **语义**：切换 Type（含 Scale）后 Data 列立即按新 Type 显示**同一数值** —— 读回 HEX `00AB` →
   切 Unsigned 显示 `171` → 切 Binary 显示 `00000000 10101011`。**原始值不变**，且**绝不按新进制
   重新解释当前文本**（`171` 切 HEX 必须得到 `00AB`，不得变成 `0171`）。
2. **落点**：重算并**写回 `cellText`**（单一当前值模型 §15.1：`cellText` 即用户可见的当前值），
   而非「仅在渲染层派生」——后者会留下写入路径仍按旧文本 + 新 Type 解析的错写隐患。
3. **兜底**：当前文本按**切换前** Type 解析失败（用户输入非法 / 未读取 / 手工文本）、或单元格为空 →
   **保留原文**（空则保持空，不写 `0`），只更新 Type 指示（§23「校验失败保留用户输入」的同源语义）。
4. **不算编辑**：刷新文本不置脏标记、不置编辑完成态、不新增独立撤销项；Type 切换 + 文本刷新仍是
   撤销栈中的**单步**。
5. **范围行「父行文本 vs 子行显示」不一致本次不做**：父行 `commitCellText` 不更新 `registerValues`，
   而子行 Data 显示取 `registerValues[i]`，故手工编辑父行组合文本后子行仍显示上次读取值 —— 另立待办
   （不在本 ADR 范围，避免扩大改动面）。
   → **已解决（2026-09-11）**：`commitCellText` 成功时同步 `registerValues`（解析出的原始值），
   恢复「原始值单一事实源」不变式；复现测试与回归见
   [../bugs/2026-09-11-范围行父行文本与子行显示不一致.md](../bugs/2026-09-11-范围行父行文本与子行显示不一致.md)。
6. **文档口径修订**：`docs/AGENTS.md` §17「Type 切换不改写单元格文本」改为「Type 切换即时刷新显示，
   但原始值不变、不得按新进制重解释文本」。

### 实现语义（`retargetRowDataType(row, dataType, resolver?)`）

| 情形 | 行为 |
| --- | --- |
| `dataType === row.dataType` | 原引用返回（零更新短路） |
| `cellText.trim() === ""` | 仅改 `dataType`（保持空文本，不生成 `0`） |
| 范围行（`registerCount > 1`） | 用**旧** Type `parseCompositeText(text, oldType, registerCount)`；成功 → `formatRawValues(values, newType)` 写回 |
| 单寄存器 | 用**旧** Type `resolver.parse(text, oldType)`；成功 → `resolver.format(raw, newType)` 写回 |
| 旧文本解析失败 | 保留原文，仅改 `dataType`（§23） |
| 新 Type 无法格式化（`bool` / 未知插件类型 + `registerCount > 1` 会抛 `unsupported data type`） | try/catch 兜底：保留原文，绝不抛出/崩溃 |

- **不改** `registerValues`（设备读回值 / 子行数据源）、**不改** `updatedAt` 语义（沿用 `Date.now()`）。
- **不新增** HostMessage v1 kind、工作区 schema 版本、能力矩阵字段、协议/调度改动。

### 撤销/重做路径（同一规则）

`cellText` 属**运行时字段**（ADR-032 / §24.4：撤销只回退编辑字段、读值不回退），故撤销/重做
应用表快照时，快照恢复的 `dataType` 可能与当前不一致（文本仍按切换后的类型格式化）。
因此 `applySheetSnapshotToWorkspace` 在应用快照后对「恢复类型 ≠ 当前类型」的行按**同一规则**
刷新文本（`retargetSnapshotRowTypes`：以「现类型解析现文本 → 恢复类型格式化」重算），否则会残留
「类型 A + 文本 B」——进而让写入按新类型解析旧文本（与 ADR-053 要消除的错写隐患同类）。

## 设计落位

- `packages/register-table/src/cell-text.ts`：新增导出 `retargetRowDataType`（与 `canonicalCellText` /
  `commitCellText` 同域：类型 ↔ 单元格文本）。
- `packages/register-table/src/index.ts`：导出该函数。
- `packages/ui/src/app-store.ts`：`setRowDataType` 改为
  `updateRow(rowId, r => retargetRowDataType(r, dataType, get().dataTypeResolver))`；
  撤销快照（`pushSheetEntry`）与「范围长度 × 类型合法集」校验（`rowTypeCountError` →`${rowId}:type`）
  逻辑保持原样；不触碰 `rowDirty` / `rowSuccess` / `cellValidationErrors`（决策 4）。
  另新增 `retargetSnapshotRowTypes`（私有）并在 `applySheetSnapshotToWorkspace` 内应用，
  保证撤销/重做路径的 Type ↔ 文本一致（见上）。
- `packages/ui/src/components/RegisterTable.tsx`：**无需改动**（Data 列仍渲染 `row.cellText`）；
  子行 Type/Scale（`setChildMeta`）**无需改动**（子行显示本就按自身 Type 实时派生）。
- `docs/AGENTS.md` §17：规则修订。

## 影响与验证

- 单测：
  - `packages/register-table/src/cell-text.test.ts`：`retargetRowDataType` 表驱动 —— 各内置类型互转、
    关键反例（`unsigned 171` → hex 必须 `00AB`、不得 `0171`）、scale 切换、`FFFF` → signed `-1`、
    范围行组合类型（count 2 / count 3 + unsigned / bool 非法组合不抛错）、空文本、非法原文保留、
    插件类型经 resolver、类型未变短路（原引用）。
  - `packages/ui/src/app-store.test.ts`：`setRowDataType` 刷新文本、`registerValues` 不变、
    撤销单步回退（text + type 一起）、不置 `rowDirty`。
- e2e-web：新增 `tests/e2e-web/tests/type-switch-refresh.spec.ts` —— 读回 `0x00AB` 后 HEX→Unsigned 显示
  `171`、**Write 后断言 mock 寄存器仍为 `0x00AB`**（原始值不变的核心证明）、Binary 显示分组且位明细可展开、
  范围行组合十进制往返、空行切换仍为空、全程无 console 错误。
- 既有含 Type/Scale 切换的用例（`row-editing` / `range-row` / `binary-grouping` / `bit-detail` /
  `custom-function-code` / `basic-tables`）经核对均为「**先切 Type 再填值**」，不受本变更影响。
- 已知影响（有意的行为变更）：切换 Type/Scale 后单元格文本会被改写为按新 Type 的规范形式，并随既有
  自动保存落盘；用户既有工作区数据无需迁移（文本刷新只发生在用户主动切换 Type 时）。
- 无工作区 schema 变更、无 HostMessage v1 变更、无能力矩阵变更、无协议/调度改动。

### 回归结果（2026-09-11）

| 项 | 结果 |
| --- | --- |
| `pnpm --filter @mamep2026/register-table test` | **214 / 214**（含新增 `retargetRowDataType` 表驱动用例与关键反例） |
| `pnpm --filter @mamep2026/ui test` | **383 / 383**（含新增 `setRowDataType` 用例与既有撤销/重做用例） |
| `pnpm typecheck` | **32 / 32** |
| `pnpm lint` | **EXIT = 0** |
| e2e-web `type-switch-refresh.spec.ts` | 已新增 4 用例；**未执行**（执行时机由用户决定） |
