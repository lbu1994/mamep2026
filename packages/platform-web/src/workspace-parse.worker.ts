/**
 * 工作区恢复、导入和保存 Worker。
 *
 * - 恢复/导入：JSON.parse、迁移、Schema 校验和值对象重建都在 Worker 完成；
 * - 保存：从完整领域快照生成 WorkspaceData，再执行与同步路径相同的 Schema 校验；
 * - 主线程只接收结构化克隆结果，不接触 Transport、Store 或平台 API。
 */
import type { Result, Workspace } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  hydrateWorkspaceData,
  parseWorkspaceData,
  serializeWorkspaceSnapshot,
  type WorkspaceData,
  type WorkspaceSerialization,
} from "@mamep2026/workspace";

type WorkerRequest =
  | {
      id: number;
      kind: "parse";
      input: unknown;
      inputKind: "object" | "json-text";
    }
  | {
      id: number;
      kind: "serialize";
      input: Workspace;
    }
  | {
      id: number;
      kind: "warm";
    };

type WorkerResult =
  | { workspace: Workspace; serialized: string; data: WorkspaceData }
  | WorkspaceSerialization
  | { warm: true };

interface WorkerResponse {
  id: number;
  result: Result<WorkerResult>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;

function invalidJson(error: unknown): Result<never> {
  return fail({
    code: "WORKSPACE_SCHEMA_INVALID",
    category: "validation",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.workspaceSchemaInvalid",
    technicalMessage: error instanceof Error ? error.message : String(error),
  });
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "warm") {
    workerScope.postMessage({ id: request.id, result: ok({ warm: true }) });
    return;
  }
  if (request.kind === "serialize") {
    workerScope.postMessage({
      id: request.id,
      result: serializeWorkspaceSnapshot(request.input),
    });
    return;
  }

  const { input, inputKind } = request;
  let data: unknown = input;
  if (inputKind === "json-text") {
    try {
      data = JSON.parse(String(input));
    } catch (error) {
      workerScope.postMessage({ id: request.id, result: invalidJson(error) });
      return;
    }
  }
  const parsed = parseWorkspaceData(data);
  if (!parsed.ok) {
    workerScope.postMessage({ id: request.id, result: parsed });
    return;
  }
  const workspace = hydrateWorkspaceData(parsed.value);
  workerScope.postMessage({
    id: request.id,
    result: ok({
      workspace,
      // parsed.value 已通过当前 Schema；直接 stringify 不触发第二次校验。
      serialized: JSON.stringify(parsed.value),
      data: parsed.value,
    }),
  });
};
