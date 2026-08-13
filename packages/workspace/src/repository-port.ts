/**
 * 工作区仓储 Port（docs/TECH_DESIGN.md §19.1）。
 * UI 不直接调用 IndexedDB 或文件系统，只通过该接口。
 */
import type { Result, Workspace } from "@mamep2026/domain";

export interface WorkspaceRepositoryPort {
  load(): Promise<Result<Workspace>>;
  save(workspace: Workspace): Promise<Result<void>>;
}
