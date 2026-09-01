/**
 * FileWorkspaceRepository 单测（ADR-036，2026-08-30）：
 * Renderer 薄桥 → preload 桥（workspace-load/save/clear），parse/serialize 在本层完成。
 */
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import type { Result, Workspace } from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import type { WorkspaceLoadResponse } from "@mamep2026/platform-api";
import { FileWorkspaceRepository } from "./file-workspace-repository";

interface BridgeWorkspaceLike {
  workspaceLoad(): Promise<Result<WorkspaceLoadResponse>>;
  workspaceSave(content: string): Promise<Result<null>>;
  workspaceClear(): Promise<Result<null>>;
}

function makeBridge(overrides: Partial<BridgeWorkspaceLike> = {}): {
  bridge: BridgeWorkspaceLike;
  saveCalls: string[];
  clearCalls: number;
} {
  const saveCalls: string[] = [];
  let clearCalls = 0;
  const bridge: BridgeWorkspaceLike = {
    workspaceLoad: vi.fn(
      async (): Promise<Result<WorkspaceLoadResponse>> => ({
        ok: true,
        value: { content: serializeWorkspace(createEmptyWorkspace()) },
      }),
    ),
    workspaceSave: vi.fn(async (content: string): Promise<Result<null>> => {
      saveCalls.push(content);
      return { ok: true, value: null };
    }),
    workspaceClear: vi.fn(async (): Promise<Result<null>> => {
      clearCalls += 1;
      return { ok: true, value: null };
    }),
    ...overrides,
  };
  return { bridge, saveCalls, clearCalls };
}

describe("FileWorkspaceRepository", () => {
  it("load 经桥拿 content 并 parseWorkspace 重建领域对象", async () => {
    const { bridge } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // createEmptyWorkspace 含 Date.now()/随机 id（非确定性），做结构化断言。
      expect(result.value.schemaVersion).toBe(7);
      expect(result.value.name).toBe("Workspace");
      expect(result.value.sheets).toHaveLength(1);
    }
  });

  it("load 桥失败时原样透传错误", async () => {
    const { bridge } = makeBridge({
      workspaceLoad: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "PERSISTENCE_LOAD_FAILED",
          category: "persistence" as const,
          severity: "error" as const,
          retryable: false,
          userMessageKey: "errors.persistenceError",
          technicalMessage: "boom",
        },
      })),
    });
    const repo = new FileWorkspaceRepository(bridge);
    const result = await repo.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PERSISTENCE_LOAD_FAILED");
    }
  });

  it("save 先 serializeWorkspace 再过桥（roundtrip 可读回）", async () => {
    const { bridge, saveCalls } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const workspace: Workspace = {
      ...createEmptyWorkspace(),
      name: "FileRepo",
    };
    const saved = await repo.save(workspace);
    expect(saved.ok).toBe(true);
    expect(saveCalls).toEqual([serializeWorkspace(workspace)]);
  });

  it("clear 调用桥 workspaceClear", async () => {
    const { bridge } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const cleared = await repo.clear();
    expect(cleared.ok).toBe(true);
    expect(bridge.workspaceClear).toHaveBeenCalledTimes(1);
  });
});
