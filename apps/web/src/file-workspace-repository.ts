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
import { ok } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import type { MamepHostApi } from "@mamep2026/platform-api";
import { parseWorkspaceOffMainThread } from "@mamep2026/platform-web";

export class FileWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly bridge: Pick<
    MamepHostApi,
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
    // 主进程 load 恒返回序列化 JSON 字符串（无文件 = 空工作区）；parseWorkspace 接收对象，
    // 故先 JSON.parse 再重建领域对象（含 v1→v4 迁移与断链检测）。
    this.recoveryInfo = result.value.recoveryInfo ?? null;
    return parseWorkspaceOffMainThread(JSON.parse(result.value.content));
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    const { serializeWorkspace } = await import("@mamep2026/workspace");
    const result = await this.bridge.workspaceSave(
      serializeWorkspace(workspace),
    );
    // 桥返回 Result<null>，Port 契约为 Result<void>，归一化。
    if (!result.ok) return result;
    return ok(undefined);
  }

  async clear(): Promise<Result<void>> {
    const result = await this.bridge.workspaceClear();
    if (!result.ok) return result;
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
    const { parseWorkspace } = await import("@mamep2026/workspace");
    const parsed = parseWorkspace(JSON.parse(serialized));
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
