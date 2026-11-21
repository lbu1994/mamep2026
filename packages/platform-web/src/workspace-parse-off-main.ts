/**
 * 工作区恢复、导入与保存的 Worker 客户端。
 *
 * Worker 按请求串行复用：工作区操作本身由应用层串行化，复用可避免每次恢复/保存都
 * 重新加载 Zod、迁移链和领域工厂。取消活动请求会终止当前 Worker，后续请求使用新
 * Worker；取消排队请求只移除该请求。
 */
import type { Result, Workspace } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type {
  WorkspaceData,
  WorkspaceSerialization,
} from "@mamep2026/workspace";

interface ParsedWorkspaceSnapshot {
  workspace: Workspace;
  serialized: string;
  data: WorkspaceData;
}

type WorkerRequestPayload =
  | {
      kind: "parse";
      input: unknown;
      inputKind: "object" | "json-text";
    }
  | {
      kind: "serialize";
      input: Workspace;
    }
  | {
      kind: "warm";
    };

type WorkerRequest = WorkerRequestPayload & { id: number };

type WorkerResult =
  ParsedWorkspaceSnapshot | WorkspaceSerialization | { warm: true };

interface WorkerResponse {
  id: number;
  result: Result<WorkerResult>;
}

interface PendingRequest {
  id: number;
  request: WorkerRequest;
  resolve(value: Result<WorkerResult>): void;
  reject(reason: unknown): void;
  settled: boolean;
  signal?: AbortSignal | undefined;
  abortListener?: (() => void) | undefined;
}

export interface WorkspaceParseOptions {
  /** 取消后立即终止当前 Worker；迟到消息会被忽略，调用方收到可识别的取消结果。 */
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

async function serializeInMainThread(
  workspace: Workspace,
  options: WorkspaceParseOptions,
): Promise<Result<WorkspaceSerialization>> {
  if (isAborted(options.signal)) return abortedResult();
  const { serializeWorkspaceSnapshot } = await import("@mamep2026/workspace");
  if (isAborted(options.signal)) return abortedResult();
  return serializeWorkspaceSnapshot(workspace);
}

let nextRequestId = 0;
let sharedWorker: Worker | null = null;
let activeRequest: PendingRequest | null = null;
const requestQueue: PendingRequest[] = [];

function settle(
  pending: PendingRequest,
  result: Result<WorkerResult>,
): boolean {
  if (pending.settled) return false;
  pending.settled = true;
  if (pending.abortListener !== undefined) {
    pending.signal?.removeEventListener("abort", pending.abortListener);
  }
  pending.resolve(result);
  return true;
}

function rejectRequest(pending: PendingRequest, cause: unknown): void {
  if (pending.settled) return;
  pending.settled = true;
  if (pending.abortListener !== undefined) {
    pending.signal?.removeEventListener("abort", pending.abortListener);
  }
  pending.reject(cause);
}

function removeQueued(pending: PendingRequest): void {
  const index = requestQueue.indexOf(pending);
  if (index >= 0) requestQueue.splice(index, 1);
}

function terminateWorker(): void {
  const worker = sharedWorker;
  sharedWorker = null;
  worker?.terminate();
}

function failWorker(cause: unknown): void {
  const current = activeRequest;
  activeRequest = null;
  terminateWorker();
  if (current !== null) rejectRequest(current, cause);
  const queued = requestQueue.splice(0);
  for (const pending of queued) rejectRequest(pending, cause);
}

/** 终止复用 Worker；页面卸载、宿主销毁和隔离测试使用。 */
export function disposeWorkspaceWorker(): void {
  const current = activeRequest;
  activeRequest = null;
  terminateWorker();
  if (current !== null) {
    rejectRequest(current, new Error("workspace worker disposed"));
  }
  const queued = requestQueue.splice(0);
  for (const pending of queued) {
    rejectRequest(pending, new Error("workspace worker disposed"));
  }
}

function pumpQueue(): void {
  if (activeRequest !== null || requestQueue.length === 0) return;
  const pending = requestQueue.shift();
  if (pending === undefined) return;
  if (pending.settled) {
    pumpQueue();
    return;
  }
  activeRequest = pending;
  try {
    ensureWorker().postMessage(pending.request);
  } catch (error) {
    activeRequest = null;
    terminateWorker();
    rejectRequest(pending, error);
    pumpQueue();
  }
}

function ensureWorker(): Worker {
  if (sharedWorker !== null) return sharedWorker;
  const worker = new Worker(
    new URL("./workspace-parse.worker.ts", import.meta.url),
    {
      type: "module",
      name: "mamep-workspace-parser",
    },
  );
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const pending = activeRequest;
    if (pending === null || pending.id !== event.data.id) return;
    activeRequest = null;
    settle(pending, event.data.result);
    pumpQueue();
  });
  worker.addEventListener("error", (event) => {
    failWorker(new Error(event.message || "workspace parser worker failed"));
  });
  worker.addEventListener("messageerror", () => {
    failWorker(new Error("workspace parser worker message failed"));
  });
  sharedWorker = worker;
  return worker;
}

function requestWorker(
  request: WorkerRequestPayload,
  options: WorkspaceParseOptions,
): Promise<Result<WorkerResult>> {
  return new Promise((resolve, rejectRequest) => {
    const id = ++nextRequestId;
    const pending: PendingRequest = {
      id,
      request: { ...request, id } as WorkerRequest,
      resolve,
      reject: rejectRequest,
      settled: false,
      signal: options.signal,
    };

    const abort = (): void => {
      if (pending.settled) return;
      if (activeRequest === pending) {
        activeRequest = null;
        terminateWorker();
        settle(pending, abortedResult());
        pumpQueue();
        return;
      }
      removeQueued(pending);
      settle(pending, abortedResult());
    };
    pending.abortListener = abort;
    if (isAborted(options.signal)) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    requestQueue.push(pending);
    pumpQueue();
  });
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

  try {
    const parsed = await requestWorker(
      { kind: "parse", input, inputKind },
      options,
    );
    if (isAborted(options.signal)) return abortedResult();
    if (!parsed.ok) return parsed;
    if (!("workspace" in parsed.value)) {
      return workerUnavailableError(new Error("unexpected parse response"));
    }
    return ok(parsed.value.workspace);
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

/**
 * 预热复用 Worker。调用方可与 Host/UI 模块加载并行执行；失败不改变恢复路径，
 * 真正解析时仍会按既有规则重建 Worker 或回退主线程。
 */
export async function warmWorkspaceParser(
  options: WorkspaceParseOptions = {},
): Promise<Result<void>> {
  if (typeof Worker === "undefined") return ok(undefined);
  try {
    const warmed = await requestWorker({ kind: "warm" }, options);
    if (!warmed.ok) return warmed;
    return "warm" in warmed.value
      ? ok(undefined)
      : workerUnavailableError(new Error("unexpected warm response"));
  } catch (error) {
    if (isAborted(options.signal)) return abortedResult();
    return workerUnavailableError(error);
  }
}

/**
 * 生成经完整 Schema 校验的保存快照。
 *
 * Worker 不可用时回退到同一 workspace 包函数；正常浏览器/WebView 下不占主线程。
 */
export async function serializeWorkspaceOffMainThread(
  workspace: Workspace,
  options: WorkspaceParseOptions = {},
): Promise<Result<WorkspaceSerialization>> {
  if (isAborted(options.signal)) return abortedResult();
  if (typeof Worker === "undefined") {
    return serializeInMainThread(workspace, options);
  }
  try {
    const serialized = await requestWorker(
      { kind: "serialize", input: workspace },
      options,
    );
    if (isAborted(options.signal)) return abortedResult();
    if (!serialized.ok) return serialized;
    if (!("serialized" in serialized.value) || !("data" in serialized.value)) {
      return workerUnavailableError(new Error("unexpected serialize response"));
    }
    return ok({
      serialized: serialized.value.serialized,
      data: serialized.value.data,
    });
  } catch (error) {
    if (isAborted(options.signal)) return abortedResult();
    try {
      return await serializeInMainThread(workspace, options);
    } catch (fallbackError) {
      return workerUnavailableError(fallbackError ?? error);
    }
  }
}
