# Electron 平台适配

### 19.4 Electron 文件持久化

Electron 使用应用数据目录下的版本化 JSON 文件。

原子保存流程：

1. 序列化到临时文件；
2. 完成写入；
3. 尽可能执行同步刷新；
4. 将当前文件改为备份；
5. 将临时文件原子替换为正式文件；
6. 更新保存状态；
7. 定期清理旧备份。

不得由 Renderer 直接写入文件。

文件权限和路径由 Main Process 控制。

> **实现状态（2026-08-30，ADR-036）**：已落地——主进程 `WorkspaceFileRepository`
> （`apps/electron/src/main/workspace-file-repository.ts`）实现 `WorkspaceRepositoryPort`，
> 文件布局 `userData/workspace.json` + `workspace.json.bak`（单份备份轮转，与浏览器 IndexedDB
> 单备份语义一致；「定期清理旧备份」在单份策略下退化为每次轮转覆盖）；原子保存流程 1→5 已实现
> （临时文件 → 写入 → `fsync` → 主改备份 → 临时文件原子替换，Windows `rename` 目标已存在先 `rm`
> 兜底）；损坏时从 .bak 恢复并自愈写回主文件；Renderer 经 `workspace-load/save/clear`
> HostMessage v1 kind 走薄桥 `FileWorkspaceRepository`（`apps/web/src/file-workspace-repository.ts`），
> 不直接触碰文件系统；能力矩阵 `electronCapabilities.filesystem: "full"`。


### 22.3 Electron IPC

安全要求：

- contextIsolation 开启；
- nodeIntegration 关闭；
- sandbox 在可行范围内开启；
- Renderer 无通用 IPC 访问权；
- preload 仅暴露白名单 API；
- Main Process 校验所有输入；
- 不允许 Renderer 指定任意文件路径执行读写；
- 不允许 Renderer 执行任意命令；
- 不允许 Renderer 加载任意 Node.js 模块；
- 外部链接通过受控方式打开；
- Content Security Policy 明确配置。


