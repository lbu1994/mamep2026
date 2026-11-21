/**
 * 工作区迁移与 Schema 校验 Worker。
 *
 * Worker 只接收结构化克隆后的持久化数据，返回已校验的普通数据；主线程随后仅重建
 * Value Object，不在这里接触 Transport、Store 或平台 API。
 */
import type { Result } from "@mamep2026/domain";
import { parseWorkspaceData, type WorkspaceData } from "@mamep2026/workspace";

interface ParseRequest {
  input: unknown;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: Result<WorkspaceData>): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  workerScope.postMessage(parseWorkspaceData(event.data.input));
};
