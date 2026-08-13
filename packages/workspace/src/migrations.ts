/**
 * 迁移框架（docs/AGENTS.md §19.6）。
 * 迁移单向、按版本顺序执行、不直接覆盖原始数据；当前 schema 版本为 v1，无历史迁移。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";

export interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

export const migrations: readonly Migration[] = [];

/** 按版本顺序应用迁移；无法迁移的数据返回结构化错误。 */
export function migrateData(
  data: Record<string, unknown>,
  migrationList: readonly Migration[],
): Result<Record<string, unknown>> {
  let current = data;
  const version =
    typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  const sorted = [...migrationList].sort(
    (a, b) => a.fromVersion - b.fromVersion,
  );
  for (const migration of sorted) {
    if (migration.fromVersion !== version) {
      return fail(
        createMamepError({
          code: "MIGRATION_CHAIN_BROKEN",
          category: "persistence",
          userMessageKey: "errors.migrationChainBroken",
          technicalMessage: `no migration from schema version ${version}`,
        }),
      );
    }
    current = migration.migrate(current);
  }
  return ok(current);
}
