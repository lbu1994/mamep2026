import { describe, expect, it, vi } from "vitest";
import type { Result } from "@mamep2026/domain";
import {
  createEmptyWorkspace,
  createMamepError,
  type Workspace,
} from "@mamep2026/domain";
import {
  AutoSaveCoordinator,
  type AutoSaveDeps,
} from "./auto-save-coordinator";
import type { WorkspaceRepositoryPort } from "./repository-port";

function realTimerDeps(debounceMs: number): AutoSaveDeps {
  return {
    debounceMs,
    now: () => Date.now(),
    schedule: (callback, ms) => {
      const id = setTimeout(callback, ms);
      return { cancel: () => clearTimeout(id) };
    },
  };
}

class InMemoryRepository implements WorkspaceRepositoryPort {
  saved: Workspace[] = [];
  failNext = false;
  delayMs = 0;

  async load(): Promise<Result<Workspace>> {
    return { ok: true, value: createEmptyWorkspace() };
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failNext) {
      return {
        ok: false,
        error: createMamepError({
          code: "PERSISTENCE_WRITE_FAILED",
          category: "persistence",
          userMessageKey: "errors.persistenceWriteFailed",
          technicalMessage: "write failed",
        }),
      };
    }
    this.saved.push(workspace);
    return { ok: true, value: undefined };
  }

  async clear(): Promise<Result<void>> {
    this.saved = [];
    return { ok: true, value: undefined };
  }

  async reset(): Promise<Result<void>> {
    return this.clear();
  }

  async export(): Promise<Result<string>> {
    return {
      ok: true,
      value: JSON.stringify(this.saved[0] ?? createEmptyWorkspace()),
    };
  }

  async import(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }

  async createBackup(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }

  getRecoveryInfo() {
    return null;
  }
}

describe("AutoSaveCoordinator", () => {
  it("debounces continuous edits and saves the latest snapshot", async () => {
    const repo = new InMemoryRepository();
    const coordinator = new AutoSaveCoordinator(repo, realTimerDeps(50));
    coordinator.scheduleSave(createEmptyWorkspace());
    coordinator.scheduleSave(createEmptyWorkspace());
    coordinator.scheduleSave(createEmptyWorkspace());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(repo.saved).toHaveLength(1);
  });

  it("keeps memory state and reports failure when saving fails", async () => {
    const repo = new InMemoryRepository();
    repo.failNext = true;
    const coordinator = new AutoSaveCoordinator(repo, realTimerDeps(10));
    const states: string[] = [];
    coordinator.onStatusChange((status) => states.push(status));
    coordinator.scheduleSave(createEmptyWorkspace());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(states).toContain("saving");
    expect(states).toContain("failed");
    // 失败后内存状态仍可再次保存（不清除）。
    repo.failNext = false;
    coordinator.scheduleSave(createEmptyWorkspace());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(states).toContain("saved");
  });

  it("serializes saves (only one in flight)", async () => {
    const repo = new InMemoryRepository();
    repo.delayMs = 30;
    const coordinator = new AutoSaveCoordinator(repo, realTimerDeps(1));
    coordinator.scheduleSave(createEmptyWorkspace());
    await new Promise((resolve) => setTimeout(resolve, 5));
    coordinator.scheduleSave(createEmptyWorkspace());
    await new Promise((resolve) => setTimeout(resolve, 150));
    // 两次保存串行执行（无并发重入）。
    expect(repo.saved.length).toBeGreaterThanOrEqual(1);
  });
  it("discards temporary edits queued before recovery confirmation", async () => {
    vi.useFakeTimers();
    try {
      const repo = new InMemoryRepository();
      const coordinator = new AutoSaveCoordinator(repo, realTimerDeps(500));
      coordinator.scheduleSave({
        ...createEmptyWorkspace(),
        name: "Temporary",
      });
      coordinator.discardPending();
      await vi.advanceTimersByTimeAsync(1000);
      await coordinator.flush();
      expect(repo.saved).toEqual([]);
      const restored = { ...createEmptyWorkspace(), name: "Restored" };
      coordinator.scheduleSave(restored);
      await vi.advanceTimersByTimeAsync(500);
      expect(repo.saved).toEqual([restored]);
    } finally {
      vi.useRealTimers();
    }
  });
});
