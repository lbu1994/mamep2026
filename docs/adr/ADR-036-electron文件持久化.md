# ADR-036：Electron 文件持久化（应用数据目录 JSON 存储，`filesystem` 能力翻转）

- 状态：已确认
- 日期：2026-08-30
- 决策来源：用户任务（PRD §8.3 P1「Electron 文件持久化」/ ADR-016、ADR-019 后续复审条件；
  4 项用户决策：kind 命名与文本传输形态、单份 .bak 备份、`userData/workspace.json` 文件布局、
  主进程完整实现 `WorkspaceRepositoryPort` + Renderer 薄桥）

## 背景

- **PRD §8.3 P1**：Electron 文件持久化（应用数据目录 JSON 存储，已从 MVP 移出）。
- **ADR-016 后续复审条件**：文件持久化落地时，`ElectronAppHost` 内存/浏览器仓储替换为文件仓储
  （经主进程 IPC）。
- **ADR-019 后续复审条件**：文件持久化落地后，能力矩阵 `filesystem` 翻转（VSCode 端该项
  `unsupported` 维持不变，不在本次范围）。
- **TECH_DESIGN §19.4**：Electron 使用应用数据目录下的版本化 JSON 文件；原子保存流程 =
  序列化到临时文件 → 完成写入 → 尽可能同步刷新 → 当前文件改为备份 → 临时文件原子替换为
  正式文件 → 更新保存状态 → 定期清理旧备份；不得由 Renderer 直接写入文件；文件权限和路径
  由 Main Process 控制。
- **docs/AGENTS.md §19**：工作区持久化规则（§19.1 必须持久化 / §19.2 不得持久化 /
  §19.3 串口恢复 / §19.4 启动行为 / §19.5 保存规则 / §19.6 数据迁移）；§27.6 持久化必测场景。
- **既有资产**：`packages/workspace` 已有 `WorkspaceRepositoryPort`（`load/save/clear`）+
  `serializeWorkspace` / `parseWorkspace`（Zod 校验 + v1→v4 迁移 + 断链检测）；浏览器端
  `IndexedDBWorkspaceRepository`（packages/platform-web）为 Port 的参考实现（单备份 +
  损坏从备份恢复）；HostMessage v1 已有 `save-text-file` / `open-text-file` 文本传输先例；
  Electron 主进程已有 `ipcDeps` 注入 + `handleInvoke` 分发 + `sessionResult` 错误透传模式。

## 决策

1. **主进程完整实现 `WorkspaceRepositoryPort`，Renderer 只做薄桥**：新增
   `WorkspaceFileRepository`（apps/electron/src/main）直接实现 `WorkspaceRepositoryPort`
   （`load/save/clear`），序列化/反序列化/备份恢复/原子替换全部在主进程；Renderer
   `FileWorkspaceRepository`（apps/web）仅把 Port 调用映射到 preload 桥。UI 不直接访问
   文件系统；路径与权限由 Main Process 控制（TECH_DESIGN §19.4 强制）。
2. **文件布局 = 应用数据目录下两个文件**：`<userData>/workspace.json`（主文件）+
   `<userData>/workspace.json.bak`（单份备份）。路径经 `app.getPath("userData")` 获取。
3. **备份策略 = 单份 .bak 轮转**：与浏览器 `IndexedDBWorkspaceRepository` 的单备份语义
   一致（保存前把当前主文件轮转为 .bak，再用临时文件原子替换主文件）；同目录保留
   最近一份备份。TECH_DESIGN §19.4 的「定期清理旧备份」在单份策略下退化为每次轮转覆盖，
   无需定时清理任务；未来如需多份历史可平滑扩展（在本 ADR 记录预留）。
4. **原子保存流程（对齐 TECH_DESIGN §19.4）**：`serializeWorkspace(workspace)` → 写同目录
   临时文件 `workspace.json.tmp` → 打开文件句柄写入 + `fsync` → 主文件存在则轮转
   （先删旧 .bak 再 rename 主 → .bak，规避 Windows `fs.rename` 目标已存在的失败）→
   rename 临时 → 主（Windows 下先删主再 rename 的兜底，非严格原子但可接受，记录于本 ADR）→
   完成。窗口关闭/应用退出不依赖该流程（自动保存按 §19.5 debounce 驱动）。
5. **加载与损坏恢复**：读主文件 → 不存在则返回 `createEmptyWorkspace()`（与浏览器一致）→
   `parseWorkspace` 成功返回 → 失败则读 .bak → `parseWorkspace` 成功则**自愈**（把备份内容
   写回主文件）并返回 → 两者皆失败返回主文件的原始错误（`PERSISTENCE_LOAD_FAILED`），
   UI 走既有加载失败路径，不新增交互（决策 6）。
6. **UI 零改动**：自动保存按 §19.5 静默执行，不新增保存状态展示；损坏恢复由主进程备份
   自愈透明处理，不新增「损坏恢复」UI 入口（若两者皆坏，沿用既有 `loadWorkspace` 失败
   语义）。antd 既有组件/仓库既有模式在本次无新增 UI 需求。
7. **新 HostMessage v1 request kinds（3 个，文本传输对齐 `save-text-file`/`open-text-file`）**：
   - `workspace-load`：payload `{}`，response `{ content: string }`（主进程 load 恒返回
     `serializeWorkspace` 序列化串，无文件 = 空工作区序列化结果）；
   - `workspace-save`：payload `{ content: string }`（序列化 JSON 字符串；主进程先
     `parseWorkspace` 校验再落盘），response `null`；
   - `workspace-clear`：payload `{}`，response `null`。
   Zod 校验 + `HOST_REQUEST_KINDS` 白名单 + preload 桥 + 主进程 ipc 分发，全部经
   `sessionResult` 包装（错误 `category`/`userMessageKey` 原样往返，ADR-028 不回归）。
8. **Renderer 薄桥 `FileWorkspaceRepository`（apps/web）**：实现 `WorkspaceRepositoryPort`，
   `load()` = `bridge.workspaceLoad()` → `parseWorkspace(content)`；`save(w)` =
   `serializeWorkspace(w)` → `bridge.workspaceSave(content)`；`clear()` = `bridge.workspaceClear()`。
   `ElectronAppHost` 默认仓储由 `IndexedDBWorkspaceRepository` 替换为本实现（
   `ElectronAppHostOptions.repository` 注入保留，测试可注入内存仓储）。
9. **能力翻转**：`electronCapabilities.filesystem: "limited"` → `"full"`（
   `FilesystemCapability = "limited"|"full"|"unsupported"`，`"full"` 语义 = 主进程应用数据
   目录文件持久化）。浏览器维持 `"limited"`（IndexedDB）、VSCode 维持 `"unsupported"` 如实
   声明；`nodePlugins` 等其它能力不动。
10. **e2e 隔离门控 `MAMEP_USER_DATA_DIR`**：主进程模块顶部（app ready 前）
    `if (process.env.MAMEP_USER_DATA_DIR) app.setPath("userData", ...)`，供 Playwright e2e
    注入临时目录，避免污染真实用户数据；生产不设置该变量则行为不变。命名风格对齐
    `MAMEP_FAKE_SERIAL` / `MAMEP_FAKE_TCP` / `MAMEP_FAKE_DIALOG`。
11. **错误模型**：主进程仓储错误统一 `createMamepError`（`category: "persistence"`、
    `severity: "error"`、`retryable: false`、`userMessageKey: "errors.persistenceError"`），
    code 对齐浏览器参考实现：`PERSISTENCE_LOAD_FAILED` / `PERSISTENCE_WRITE_FAILED` /
    `PERSISTENCE_CLEAR_FAILED`。
12. **依赖**：`apps/electron` 新增 workspace 依赖 `@mamep2026/workspace`（当前缺失；
    主进程需要 `WorkspaceRepositoryPort` / `serializeWorkspace` / `parseWorkspace` /
    `createEmptyWorkspace`）；零第三方新依赖。

## 实现要点

- `packages/platform-api/src/host-message.ts`：3 个 kind 入白名单 + Zod + 新
  `workspaceLoadResponseSchema`；`MamepHostApi` 加 `workspaceLoad/workspaceSave/workspaceClear`；
  `electronCapabilities.filesystem` 翻转。
- `apps/electron/src/main/workspace-file-repository.ts`：`WorkspaceFileRepository`（构造注入
  `dir`，生产传 `app.getPath("userData")`）。
- `apps/electron/src/main/ipc.ts`：`IpcDeps` 加 `workspace: WorkspaceRepositoryPort`；
  `handleRequest` 3 分支（`workspace-save` 先 `parseWorkspace` 校验）。
- `apps/electron/src/main/main.ts`：`MAMEP_USER_DATA_DIR` 门控 + 惰性装配文件仓储注入 `ipcDeps`。
- `apps/electron/src/preload/preload.ts`：3 个白名单桥方法。
- `apps/web/src/file-workspace-repository.ts`：Renderer 薄桥；`apps/web/src/electron-app-host.ts`
  默认仓储替换。
- 测试：主进程仓储单测（临时目录：roundtrip / 原子替换 / 备份恢复 / 双坏 / 空工作区 / clear /
  迁移 / 错误映射）、ipc 单测（校验/分发/错误投影）、preload 单测、Renderer 薄桥单测、
  `ElectronAppHost` 能力翻转断言、e2e-electron（临时 userData：自动保存落盘 → 重启恢复 →
  损坏+备份恢复 → 能力翻转 → 无 console 错误）。

## 复审条件

- VSCode 文件持久化（workspaceState/globalState 或工作区文件）落地后：`vscodeCapabilities`
  `filesystem` 翻转（仍属 ADR-019 后续复审条件，不在本次范围）。
- 若后续引入多份备份/定时清理，需在 `WorkspaceFileRepository` 扩展并更新本 ADR。
- 打包（asar）场景下 `app.getPath("userData")` 与写文件行为需在打包验证时复核。
