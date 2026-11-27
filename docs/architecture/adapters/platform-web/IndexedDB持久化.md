# IndexedDB 工作区适配

## 1. 浏览器 IndexedDB

浏览器使用 IndexedDB 保存：

- 当前工作区；
- 备份；
- 插件元数据；
- 有上限的消息和日志；
- Schema 版本。

建议使用成熟的轻量 IndexedDB 封装库，避免直接维护大量事件式 API。

浏览器存储异常处理：

- 隐私模式或存储不可用；
- 配额不足；
- 数据库升级失败；
- 事务中断；
- 数据验证失败；
- 用户清理站点数据。

## 2. 损坏原文归档与恢复

**Base behavior**：主记录损坏后直接载入备份，随后自动保存可能把损坏主记录轮转到备份。

**Current behavior**：[IndexedDBWorkspaceRepository](../../../../packages/platform-web/src/indexeddb-repository.ts)
在 `workspace` 无法通过工作区解析时设置恢复保护，将原记录和来源写入
`workspace-recovery-<SHA-256>` 独立键，再校验 `workspace-backup`。
主记录不存在但备份仍存在时，也进入预览；两者均不存在才按首次启动处理。
同一原记录复用归档，恢复或重置均不删除归档。

`load()` 返回临时默认工作区，`getRecoveryInfo()` 返回 `pending`、归档引用和有效备份摘要。
用户确认前拒绝保存、导入和备份轮转。恢复时再次检查来源、归档和备份内容，再写入主记录，
不把损坏记录覆盖到有效备份。归档写入失败时也拒绝重置；配额或访问问题解决后可以重试。

导出保留原 JSON 值，不执行工作区 Schema 迁移；版本 1 归档包含 `source`、`capturedAt`、
`encoding`、`missing` 和 `data`。无法用 JSON 无损表达的值（如循环对象、非有限数值）
不静默转换，保留原记录并报告恢复准备失败。文件导出遵循各平台现有能力。
此实现也用于 VSCode Webview 和 Android，不增加它们的文件访问权限。
