# Electron 平台适配

## 1. Electron 文件持久化

Electron 使用应用数据目录 `app.getPath("userData")` 下的版本化 JSON：

    workspace.json
    workspace.json.bak
    workspace.json.tmp

主进程 `WorkspaceFileRepository` 实现完整 `WorkspaceRepositoryPort`，负责路径、序列化输入
校验、原子保存和备份恢复。Renderer 的 `FileWorkspaceRepository` 只是 preload 白名单桥，
不直接访问文件系统。该平台 `filesystem` 能力为 `"full"`。

原子保存流程：

1. 序列化完整一致的工作区快照；
2. 写入同目录临时文件；
3. 完成写入并对文件句柄执行 `fsync`；
4. 删除旧备份，将当前主文件重命名为单份 `.bak`；
5. 将临时文件替换为主文件；
6. 失败时尽力清理临时文件，保留内存状态并返回结构化持久化错误。

Windows 下若目标文件已存在导致重命名失败，只允许在显式处理主文件后做兜底替换。该兜底
不是严格的跨平台原子事务，因此不得删除现有备份后才写临时文件；任何失败都必须至少保留
最近一份完整数据。

不得由 Renderer 直接写入文件。

文件权限和路径由 Main Process 控制。

加载语义：

- 主文件不存在视为首次启动，返回空工作区；
- 主文件通过 `parseWorkspace` 后正常返回；
- 主文件损坏且 `.bak` 有效时从备份恢复，并把备份内容尽力自愈写回主文件；
- 主文件与备份都不可用时返回结构化加载错误，由 UI 进入既有恢复流程；
- 主文件与备份坚持单份轮转，每次保存覆盖旧 `.bak`，无需额外定时清理；
- `reset/clear` 删除主文件和备份；显式导出或导入通过仓储端口完成，不绕开校验。

Electron 与 Renderer 使用专用工作区请求 kind：

- `workspace-load`：返回序列化工作区和可选 `recoveryInfo`；
- `workspace-save`：接收完整序列化内容，主进程先校验再原子落盘；
- `workspace-clear`：删除主文件与备份；
- `workspace-create-backup`：把当前主文件轮转为最近一份有效备份。

输入经过 HostMessage 白名单和 Zod 校验。持久化错误使用 `persistence` category、稳定的
`PERSISTENCE_LOAD_FAILED` / `PERSISTENCE_WRITE_FAILED` / `PERSISTENCE_CLEAR_FAILED` 代码，
并保留 `userMessageKey`，不得由 Preload 或 IPC 层统一覆盖。

自动化测试可通过 `MAMEP_USER_DATA_DIR` 在 app ready 前把 `userData` 指向临时目录，验证
自动保存、重启恢复、损坏恢复和清理，同时避免污染真实用户数据。该环境变量是测试隔离门控，
不是生产配置入口。


## 2. Electron IPC

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


