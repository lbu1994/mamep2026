/**
 * FileWorkspaceRepository 单测：
 * Renderer 薄桥 → preload 桥（workspace-load/save/clear），parse/serialize 在本层完成。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createEmptyWorkspace,
  workspaceSchemaVersion,
} from "@mamep2026/domain";
import type { Result, Workspace } from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import type { WorkspaceLoadResponse } from "@mamep2026/platform-api";
import { FileWorkspaceRepository } from "./file-workspace-repository";

interface BridgeWorkspaceLike {
  workspaceLoad(): Promise<Result<WorkspaceLoadResponse>>;
  workspaceSave(content: string): Promise<Result<null>>;
  workspaceClear(): Promise<Result<null>>;
  workspaceCreateBackup(): Promise<Result<null>>;
}

function makeBridge(overrides: Partial<BridgeWorkspaceLike> = {}): {
  bridge: BridgeWorkspaceLike;
  saveCalls: string[];
  clearCalls: number;
  createBackupCalls: number;
} {
  const saveCalls: string[] = [];
  let clearCalls = 0;
  let createBackupCalls = 0;
  const bridge: BridgeWorkspaceLike = {
    workspaceLoad: vi.fn(async (): Promise<Result<WorkspaceLoadResponse>> => ({
      ok: true,
      value: {
        content: serializeWorkspace(createEmptyWorkspace()),
        recoveryInfo: null,
      },
    })),
    workspaceSave: vi.fn(async (content: string): Promise<Result<null>> => {
      saveCalls.push(content);
      return { ok: true, value: null };
    }),
    workspaceClear: vi.fn(async (): Promise<Result<null>> => {
      clearCalls += 1;
      return { ok: true, value: null };
    }),
    workspaceCreateBackup: vi.fn(async (): Promise<Result<null>> => {
      createBackupCalls += 1;
      return { ok: true, value: null };
    }),
    ...overrides,
  };
  return { bridge, saveCalls, clearCalls, createBackupCalls };
}

describe("FileWorkspaceRepository", () => {
  it("load 经桥拿 content 并 parseWorkspace 重建领域对象", async () => {
    const { bridge } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // createEmptyWorkspace 含 Date.now()/随机 id（非确定性），做结构化断言。
      expect(result.value.schemaVersion).toBe(workspaceSchemaVersion);
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

  it("reset 等同 clear（调用桥 workspaceClear）", async () => {
    const { bridge } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const reset = await repo.reset();
    expect(reset.ok).toBe(true);
    expect(bridge.workspaceClear).toHaveBeenCalledTimes(1);
  });

  it("export 返回桥 workspaceLoad 的 content（§19.1）", async () => {
    const { bridge } = makeBridge({
      workspaceLoad: vi.fn(async () => ({
        ok: true as const,
        value: { content: "fixed-content", recoveryInfo: null },
      })),
    });
    const repo = new FileWorkspaceRepository(bridge);
    const exported = await repo.export();
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(exported.value).toBe("fixed-content");
    }
  });

  it("import 校验后经桥 workspaceSave 落盘（§19.1）", async () => {
    const { bridge, saveCalls } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const serialized = serializeWorkspace({
      ...createEmptyWorkspace(),
      name: "Imported",
    });
    const imported = await repo.import(serialized);
    expect(imported.ok).toBe(true);
    expect(saveCalls).toEqual([serialized]);
  });

  it("import 非法数据被 parseWorkspace 拒绝，不落盘（§19.1）", async () => {
    const { bridge, saveCalls } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const imported = await repo.import('{"schemaVersion":999}');
    expect(imported.ok).toBe(false);
    expect(saveCalls).toHaveLength(0);
  });

  it("createBackup 调用桥 workspaceCreateBackup（§19.1）", async () => {
    const { bridge } = makeBridge();
    const repo = new FileWorkspaceRepository(bridge);
    const backup = await repo.createBackup();
    expect(backup.ok).toBe(true);
    expect(bridge.workspaceCreateBackup).toHaveBeenCalledTimes(1);
  });

  it("load 记录桥返回的 recoveryInfo 并可由 getRecoveryInfo 读取（ADR-049）", async () => {
    const { bridge } = makeBridge({
      workspaceLoad: vi.fn(async () => ({
        ok: true as const,
        value: {
          content: serializeWorkspace(createEmptyWorkspace()),
          recoveryInfo: {
            recovered: true,
            source: "backup" as const,
            recoveredAt: 123,
            backupTimestamp: 100,
            errorCode: null,
          },
        },
      })),
    });
    const repo = new FileWorkspaceRepository(bridge);
    await repo.load();
    expect(repo.getRecoveryInfo()).toEqual({
      recovered: true,
      source: "backup",
      recoveredAt: 123,
      backupTimestamp: 100,
      errorCode: null,
    });
  });
  it("rejects temporary saves in Renderer before serialization can outlive recovery", async () => {
    const workspace = createEmptyWorkspace();
    const { bridge, saveCalls } = makeBridge({
      workspaceLoad: async () => ({
        ok: true,
        value: {
          content: serializeWorkspace(workspace),
          recoveryInfo: {
            recovered: true,
            source: "fresh",
            pending: true,
            recoveredAt: 1,
            backupTimestamp: null,
            errorCode: null,
          },
        },
      }),
    });
    const repo = new FileWorkspaceRepository(bridge);
    await repo.load();
    const result = await repo.save(workspace);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_RECOVERY_PENDING" },
    });
    expect(saveCalls).toEqual([]);
  });
});
