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

export interface WorkspaceParseOptions {
  /** 取消后立即终止 Worker；迟到消息会被忽略，调用方收到可识别的取消结果。 */
  readonly signal?: AbortSignal | undefined;
}

export const WORKSPACE_PARSE_ABORTED = "WORKSPACE_PARSE_ABORTED";

function abortedResult(): Result<never> {
  return fail({
    code: WORKSPACE_PARSE_ABORTED,
    category: "persistence",
    severity: "info",
    retryable: false,
    userMessageKey: "workspace.importCancelled",
    technicalMessage: "workspace parse aborted",
  });
}

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

function invalidJsonResult(cause: unknown): Result<never> {
  return fail({
    code: "WORKSPACE_SCHEMA_INVALID",
    category: "validation",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.workspaceSchemaInvalid",
    technicalMessage: cause instanceof Error ? cause.message : String(cause),
  });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function parseInMainThread(
  input: unknown,
  options: WorkspaceParseOptions,
): Promise<Result<Workspace>> {
  if (isAborted(options.signal)) return abortedResult();
  const { parseWorkspace } = await import("@mamep2026/workspace");
  if (isAborted(options.signal)) return abortedResult();
  return parseWorkspace(input);
}

async function parseTextInMainThread(
  text: string,
  options: WorkspaceParseOptions,
): Promise<Result<Workspace>> {
  if (isAborted(options.signal)) return abortedResult();
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return invalidJsonResult(error);
  }
  if (isAborted(options.signal)) return abortedResult();
  return parseInMainThread(input, options);
}

async function parseOffMainThread(
  input: unknown,
  options: WorkspaceParseOptions,
  inputKind: "object" | "json-text",
): Promise<Result<Workspace>> {
  if (isAborted(options.signal)) return abortedResult();
  if (typeof Worker === "undefined") {
    return inputKind === "json-text"
      ? parseTextInMainThread(String(input), options)
      : parseInMainThread(input, options);
  }

  let worker: Worker | null = null;
  let abortListener: (() => void) | null = null;
  try {
    worker = new Worker(
      new URL("./workspace-parse.worker.ts", import.meta.url),
      {
        type: "module",
        name: "mamep-workspace-parser",
      },
    );
    const activeWorker = worker;
    const parsed = await new Promise<ParseResult>((resolve, reject) => {
      abortListener = () => {
        activeWorker.terminate();
        resolve(abortedResult());
      };
      options.signal?.addEventListener("abort", abortListener, { once: true });
      activeWorker.addEventListener(
        "message",
        (event: MessageEvent<ParseResult>) => {
          resolve(event.data);
        },
      );
      activeWorker.addEventListener("error", (event) => {
        reject(new Error(event.message || "workspace parser worker failed"));
      });
      activeWorker.addEventListener("messageerror", () => {
        reject(new Error("workspace parser worker message failed"));
      });
      activeWorker.postMessage({ input, inputKind });
    });
    if (isAborted(options.signal)) return abortedResult();
    if (!parsed.ok) return parsed;
    return ok(hydrateWorkspaceData(parsed.value));
  } catch (error) {
    if (isAborted(options.signal)) return abortedResult();
    // Worker 在旧 WebView / CSP / 加载失败等环境不可用时保持原路径可恢复。
    try {
      return inputKind === "json-text"
        ? await parseTextInMainThread(String(input), options)
        : await parseInMainThread(input, options);
    } catch (fallbackError) {
      return workerUnavailableError(fallbackError ?? error);
    }
  } finally {
    if (abortListener !== null) {
      options.signal?.removeEventListener("abort", abortListener);
    }
    worker?.terminate();
  }
}

export async function parseWorkspaceOffMainThread(
  input: unknown,
  options: WorkspaceParseOptions = {},
): Promise<Result<Workspace>> {
  return parseOffMainThread(input, options, "object");
}

/** 导入原始 JSON 文本：JSON.parse、迁移和 Schema 校验全部在 Worker 中执行。 */
export async function parseWorkspaceTextOffMainThread(
  text: string,
  options: WorkspaceParseOptions = {},
): Promise<Result<Workspace>> {
  return parseOffMainThread(text, options, "json-text");
}
