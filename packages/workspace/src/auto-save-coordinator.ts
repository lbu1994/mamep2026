/**
 * 自动保存协调器（docs/TECH_DESIGN.md §19.2）。
 * - 连续编辑 debounce 合并；
 * - 保存串行执行，保存中发生新修改时完成后保存最新快照；
 * - 保存失败不丢内存状态，UI 可观察 saved/saving/failed。
 */
import type { Result, Workspace } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "./repository-port";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export interface AutoSaveDeps {
  debounceMs: number;
  now(): number;
  schedule(callback: () => void, ms: number): { cancel(): void };
}

export class AutoSaveCoordinator {
  private pending: Workspace | null = null;
  private timerHandle: { cancel(): void } | null = null;
  private saving = false;
  private status: SaveStatus = "idle";
  private readonly listeners = new Set<(status: SaveStatus) => void>();
  private readonly repository: WorkspaceRepositoryPort;
  private readonly deps: AutoSaveDeps;

  constructor(repository: WorkspaceRepositoryPort, deps: AutoSaveDeps) {
    this.repository = repository;
    this.deps = deps;
  }

  getStatus(): SaveStatus {
    return this.status;
  }

  /** Discard temporary edits before replacing the workspace with a confirmed backup. */
  discardPending(): void {
    this.timerHandle?.cancel();
    this.timerHandle = null;
    this.pending = null;
  }

  onStatusChange(listener: (status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  scheduleSave(workspace: Workspace): void {
    this.pending = workspace;
    this.timerHandle?.cancel();
    this.timerHandle = this.deps.schedule(() => {
      this.timerHandle = null;
      void this.flush();
    }, this.deps.debounceMs);
  }

  /** 立即保存当前快照（应用关闭前调用）。 */
  async flush(): Promise<Result<void>> {
    this.timerHandle?.cancel();
    this.timerHandle = null;
    if (this.saving) return ok(undefined);
    if (this.pending === null) return ok(undefined);

    this.saving = true;
    const snapshot = this.pending;
    this.pending = null;
    this.emit("saving");

    const result = await this.repository.save(snapshot);
    this.saving = false;
    if (!result.ok) {
      this.emit("failed");
      return result;
    }
    // 保存期间产生的新修改：继续保存最新快照（合并中间状态）。
    if (this.pending !== null) {
      return this.flush();
    }
    this.emit("saved");
    return ok(undefined);
  }

  private emit(status: SaveStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
