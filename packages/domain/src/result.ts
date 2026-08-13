/**
 * Result 类型：领域层对外统一返回 ok / error。
 * 禁止抛出异常作为控制流；失败必须携带结构化 MamepError。
 */
import type { MamepError } from "./errors";

export type Result<T, E = MamepError> =
  { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail<E = MamepError>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
