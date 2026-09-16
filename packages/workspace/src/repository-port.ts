/**
 * 工作区仓储 Port（docs/TECH_DESIGN.md §19.1）。
 * UI 不直接调用 IndexedDB 或文件系统，只通过该接口。
 */
import type {
  Result,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";

export interface WorkspaceRepositoryPort {
  load(): Promise<Result<Workspace>>;
  save(workspace: Workspace): Promise<Result<void>>;
  /** 清除全部持久化数据（用户重置损坏工作区用，§16.5.5）。 */
  clear(): Promise<Result<void>>;
  /** 重置为全新工作区（清空持久化数据；语义等同 `clear`，§19.1）。 */
  reset(): Promise<Result<void>>;
  /** 导出当前持久化工作区为序列化 JSON 字符串（§19.1）。 */
  export(): Promise<Result<string>>;
  /** 导入工作区数据（parse + 校验 + 落盘；§19.1）。 */
  import(serialized: string): Promise<Result<void>>;
  /** 创建当前工作区备份（主 → 备份轮转；§19.1）。 */
  createBackup(): Promise<Result<void>>;
  /** 最近一次 `load()` 的恢复元数据（UI 恢复提示用；§19.1）。 */
  getRecoveryInfo(): WorkspaceRecoveryInfo | null;
}
