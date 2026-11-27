/**
 * Electron Renderer 工作区文件仓储薄桥（docs/TECH_DESIGN.md §19.4）。
 * 实现 WorkspaceRepositoryPort：经 preload 白名单桥（window.mamepHost）调用主进程文件仓储
 * （workspace-load / workspace-save / workspace-clear，content 传序列化 JSON 字符串）。
 * 序列化/反序列化在本层完成（对齐 IndexedDBWorkspaceRepository 的 parse/serialize 位置）；
 * 文件路径、原子保存、备份恢复全部在主进程（Renderer 不直接触碰文件系统）。
 */
import type {
  Result,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import { ok, fail, createMamepError } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { workspaceLoadResponseSchema } from "@mamep2026/platform-api";
import type { MamepHostApi } from "@mamep2026/platform-api";
import {
  parseWorkspaceTextOffMainThread,
  serializeWorkspaceOffMainThread,
} from "@mamep2026/platform-web";

export class FileWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly bridge: Pick<
    MamepHostApi,
    | "workspaceRecovery"
    | "workspaceLoad"
    | "workspaceSave"
    | "workspaceClear"
    | "workspaceCreateBackup"
  >;
  /** workspace-load 响应带回来的恢复元数据。 */
  private recoveryInfo: WorkspaceRecoveryInfo | null = null;

  constructor(
    bridge: Pick<
      MamepHostApi,
      | "workspaceRecovery"
      | "workspaceLoad"
      | "workspaceSave"
      | "workspaceClear"
      | "workspaceCreateBackup"
    >,
  ) {
    this.bridge = bridge;
  }

  async load(): Promise<Result<Workspace>> {
    const result = await this.bridge.workspaceLoad();
    if (!result.ok) return result;
    // 主进程 load 恒返回序列化 JSON 字符串；JSON.parse、迁移、Schema 校验和重建
    // 全部经 Worker，主线程不反序列化 1000 行快照。
    const checked = workspaceLoadResponseSchema.safeParse(result.value);
    if (!checked.success)
      return fail(
        createMamepError({
          code: "PERSISTENCE_LOAD_INVALID",
          category: "persistence",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.persistenceError",
          technicalMessage: "Invalid workspace response",
        }),
      );
    this.recoveryInfo = checked.data.recoveryInfo;
    return parseWorkspaceTextOffMainThread(result.value.content);
  }

  private async recovery(action: "restore" | "export") {
    const result = await this.bridge.workspaceRecovery?.(action);
    if (result === undefined)
      return fail(
        createMamepError({
          code: "PERSISTENCE_RECOVERY_UNAVAILABLE",
          category: "persistence",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.persistenceError",
          technicalMessage: "Recovery is unavailable",
        }),
      );
    if (!result.ok) return result;
    const parsed = workspaceLoadResponseSchema.safeParse(result.value);
    if (!parsed.success)
      return fail(
        createMamepError({
          code: "PERSISTENCE_RECOVERY_INVALID",
          category: "persistence",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.persistenceError",
          technicalMessage: "Invalid recovery response",
        }),
      );
    this.recoveryInfo = parsed.data.recoveryInfo;
    return ok(parsed.data.content);
  }

  async recover(): Promise<Result<Workspace>> {
    const result = await this.recovery("restore");
    return result.ok ? parseWorkspaceTextOffMainThread(result.value) : result;
  }

  exportRecovery(): Promise<Result<string>> {
    return this.recovery("export");
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    // Do not start serialization that could finish after Main unlocks recovery.
    if (this.recoveryInfo?.pending)
      return fail(
        createMamepError({
          code: "PERSISTENCE_RECOVERY_PENDING",
          category: "persistence",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.persistenceError",
          technicalMessage: "Confirm recovery or reset before saving",
        }),
      );
    const serialized = await serializeWorkspaceOffMainThread(workspace);
    if (!serialized.ok) return serialized;
    const result = await this.bridge.workspaceSave(serialized.value.serialized);
    // 桥返回 Result<null>，Port 契约为 Result<void>，归一化。
    if (!result.ok) return result;
    return ok(undefined);
  }

  async clear(): Promise<Result<void>> {
    const result = await this.bridge.workspaceClear();
    if (!result.ok) return result;
    this.recoveryInfo = null;
    return ok(undefined);
  }

  /** 重置为全新：清除主文件与备份（§19.1）。 */
  async reset(): Promise<Result<void>> {
    return this.clear();
  }

  /** 导出当前持久化工作区（主进程文件当前内容，§19.1）。 */
  async export(): Promise<Result<string>> {
    const result = await this.bridge.workspaceLoad();
    if (!result.ok) return result;
    return ok(result.value.content);
  }

  /** 导入工作区数据（parse + 校验后经主进程原子落盘，§19.1）。 */
  async import(serialized: string): Promise<Result<void>> {
    const parsed = await parseWorkspaceTextOffMainThread(serialized);
    if (!parsed.ok) return parsed;
    const result = await this.bridge.workspaceSave(serialized);
    if (!result.ok) return result;
    return ok(undefined);
  }

  /** 创建主进程工作区文件备份（§19.1）。 */
  async createBackup(): Promise<Result<void>> {
    const result = await this.bridge.workspaceCreateBackup();
    if (!result.ok) return result;
    return ok(undefined);
  }

  /** 最近一次加载的恢复元数据（§19.1）。 */
  getRecoveryInfo(): WorkspaceRecoveryInfo | null {
    return this.recoveryInfo;
  }
}
