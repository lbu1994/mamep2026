/**
 * 在一次性 Worker 中执行工作区迁移与 Schema 校验。
 *
 * - 支持 Worker 的浏览器/WebView：Zod 校验与迁移离开主线程，结果回到主线程后只做
 *   低成本领域对象重建；
 * - 非浏览器测试环境或 Worker 创建/加载失败：回退到原同步解析路径，保持兼容和错误
 *   语义不变。
 */
import type { Result, Workspace } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { WorkspaceData } from "@mamep2026/workspace";
import { hydrateWorkspaceData } from "@mamep2026/workspace";

type ParseResult = Result<WorkspaceData>;

function workerUnavailableError(cause: unknown): Result<never> {
  return fail({
    code: "WORKSPACE_PARSE_WORKER_FAILED",
    category: "persistence",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.persistenceError",
    technicalMessage: cause instanceof Error ? cause.message : String(cause),
  });
}

export async function parseWorkspaceOffMainThread(
  input: unknown,
): Promise<Result<Workspace>> {
  if (typeof Worker === "undefined") {
    const { parseWorkspace } = await import("@mamep2026/workspace");
    return parseWorkspace(input);
  }

  let worker: Worker | null = null;
  try {
    worker = new Worker(
      new URL("./workspace-parse.worker.ts", import.meta.url),
      {
        type: "module",
        name: "mamep-workspace-parser",
      },
    );
    const parsed = await new Promise<ParseResult>((resolve, reject) => {
      worker?.addEventListener(
        "message",
        (event: MessageEvent<ParseResult>) => {
          resolve(event.data);
        },
      );
      worker?.addEventListener("error", (event) => {
        reject(new Error(event.message || "workspace parser worker failed"));
      });
      worker?.addEventListener("messageerror", () => {
        reject(new Error("workspace parser worker message failed"));
      });
      worker?.postMessage({ input });
    });
    if (!parsed.ok) return parsed;
    return ok(hydrateWorkspaceData(parsed.value));
  } catch {
    // Worker 在旧 WebView / CSP / 加载失败等环境不可用时保持原路径可恢复。
    try {
      const { parseWorkspace } = await import("@mamep2026/workspace");
      return parseWorkspace(input);
    } catch (error) {
      return workerUnavailableError(error);
    }
  } finally {
    worker?.terminate();
  }
}
