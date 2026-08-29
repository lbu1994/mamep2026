/**
 * Electron Renderer 工作区文件仓储薄桥（docs/TECH_DESIGN.md §19.4、ADR-036，2026-08-30）。
 * 实现 WorkspaceRepositoryPort：经 preload 白名单桥（window.mamepHost）调用主进程文件仓储
 * （workspace-load / workspace-save / workspace-clear，content 传序列化 JSON 字符串）。
 * 序列化/反序列化在本层完成（对齐 IndexedDBWorkspaceRepository 的 parse/serialize 位置）；
 * 文件路径、原子保存、备份恢复全部在主进程（Renderer 不直接触碰文件系统）。
 */
import type { Result, Workspace } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { parseWorkspace, serializeWorkspace } from "@mamep2026/workspace";
import type { MamepHostApi } from "@mamep2026/platform-api";

export class FileWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly bridge: Pick<
    MamepHostApi,
    "workspaceLoad" | "workspaceSave" | "workspaceClear"
  >;

  constructor(
    bridge: Pick<
      MamepHostApi,
      "workspaceLoad" | "workspaceSave" | "workspaceClear"
    >,
  ) {
    this.bridge = bridge;
  }

  async load(): Promise<Result<Workspace>> {
    const result = await this.bridge.workspaceLoad();
    if (!result.ok) return result;
    // 主进程 load 恒返回序列化 JSON 字符串（无文件 = 空工作区）；parseWorkspace 接收对象，
    // 故先 JSON.parse 再重建领域对象（含 v1→v4 迁移与断链检测）。
    return parseWorkspace(JSON.parse(result.value.content));
  }

  async save(workspace: Workspace): Promise<Result<void>> {
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
}
