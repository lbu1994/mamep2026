import type {
  Result,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import { serializeWorkspace, parseWorkspace } from "@mamep2026/workspace";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";

/** 内存工作区仓储：acceptance / 组件测试用。 */
export class InMemoryWorkspaceRepository implements WorkspaceRepositoryPort {
  private stored: Workspace | null = null;
  private recovery: WorkspaceRecoveryInfo | null = null;
  saveCount = 0;

  async load(): Promise<Result<Workspace>> {
    this.recovery = {
      recovered: false,
      source: "none",
      recoveredAt: Date.now(),
      backupTimestamp: null,
      errorCode: null,
    };
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

  async reset(): Promise<Result<void>> {
    return this.clear();
  }

  async export(): Promise<Result<string>> {
    return ok(serializeWorkspace(this.stored ?? createEmptyWorkspace()));
  }

  async import(serialized: string): Promise<Result<void>> {
    const parsed = parseWorkspace(JSON.parse(serialized));
    if (!parsed.ok) return parsed;
    this.stored = parsed.value;
    return ok(undefined);
  }

  async createBackup(): Promise<Result<void>> {
    return ok(undefined);
  }

  getRecoveryInfo(): WorkspaceRecoveryInfo | null {
    return this.recovery;
  }
}
