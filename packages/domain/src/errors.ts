/**
 * 结构化错误模型（docs/AGENTS.md §20）。
 * UI 通过 code / category 判断类型，禁止通过错误字符串判断。
 */
export type ErrorCategory =
  | "validation"
  | "capability"
  | "permission"
  | "connection"
  | "transport"
  | "timeout"
  | "protocol"
  | "modbus-exception"
  | "cancellation"
  | "persistence"
  | "plugin"
  | "internal";

export type ErrorSeverity = "info" | "warning" | "error" | "fatal";

export interface ErrorContext {
  [key: string]: string | number | boolean | undefined;
}

export interface MamepError {
  /** 稳定的大写错误代码，如 `REQUEST_TIMEOUT` */
  readonly code: string;
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  /** i18n 消息 key，UI 用它取用户文案 */
  readonly userMessageKey: string;
  readonly technicalMessage: string;
  readonly cause?: unknown;
  readonly context?: ErrorContext;
}

export interface CreateMamepErrorInput {
  code: string;
  category: ErrorCategory;
  severity?: ErrorSeverity;
  retryable?: boolean;
  userMessageKey: string;
  technicalMessage: string;
  cause?: unknown;
  context?: ErrorContext;
}

export function createMamepError(input: CreateMamepErrorInput): MamepError {
  const error: MamepError = {
    code: input.code,
    category: input.category,
    severity: input.severity ?? "error",
    retryable: input.retryable ?? false,
    userMessageKey: input.userMessageKey,
    technicalMessage: input.technicalMessage,
  };
  if (input.cause !== undefined) {
    (error as { cause?: unknown }).cause = input.cause;
  }
  if (input.context !== undefined) {
    (error as { context?: ErrorContext }).context = input.context;
  }
  return error;
}
