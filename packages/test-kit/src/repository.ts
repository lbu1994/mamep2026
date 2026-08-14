import type { Result, Workspace } from "@mamep2026/domain";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";

/** 内存工作区仓储：acceptance / 组件测试用。 */
export class InMemoryWorkspaceRepository implements WorkspaceRepositoryPort {
  private stored: Workspace | null = null;
  saveCount = 0;

  async load(): Promise<Result<Workspace>> {
    return ok(this.stored ?? createEmptyWorkspace());
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    this.stored = workspace;
    this.saveCount += 1;
    return ok(undefined);
  }

  async clear(): Promise<Result<void>> {
    this.stored = null;
    return ok(undefined);
  }
}
