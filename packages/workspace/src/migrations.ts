/**
 * 迁移框架（docs/AGENTS.md §19.6）。
 * 迁移单向、按版本顺序执行、不直接覆盖原始数据。
 *
 * v1→v2（2026-08-26，写后回读配置下放到每表）：
 * - 把 workspace 全局 readVerifySettings 迁移到各 sheet.writeVerify（旧全局值优先；
 *   无全局值时补默认立即回读）；
 * - 删除全局 readVerifySettings 字段；
 * - schemaVersion 升为 2。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";

export interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

const DEFAULT_WRITE_VERIFY = { mode: "immediate", delayMs: null };

const migrationV1ToV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  migrate(data) {
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    const globalReadVerify = (data as { readVerifySettings?: unknown })
      .readVerifySettings;
    const writeVerify =
      globalReadVerify !== null &&
      typeof globalReadVerify === "object" &&
      !Array.isArray(globalReadVerify)
        ? { ...(globalReadVerify as Record<string, unknown>) }
        : { ...DEFAULT_WRITE_VERIFY };
    const next = {
      ...data,
      schemaVersion: 2,
      sheets: sheets.map((sheet) => ({ ...sheet, writeVerify })),
    };
    delete (next as Record<string, unknown>).readVerifySettings;
    return next;
  },
};

export const migrations: readonly Migration[] = [migrationV1ToV2];

/** 按版本顺序应用迁移；无法迁移的数据返回结构化错误。 */
export function migrateData(
  data: Record<string, unknown>,
  migrationList: readonly Migration[],
): Result<Record<string, unknown>> {
  let current = data;
  let version =
    typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  const sorted = [...migrationList].sort(
    (a, b) => a.fromVersion - b.fromVersion,
  );
  for (const migration of sorted) {
    if (migration.fromVersion < version) {
      // 已应用的迁移：跳过（迁移列表为全量历史，当前数据版本之后的无需再跑）。
      continue;
    }
    if (migration.fromVersion !== version) {
      // 迁移链断裂：存在比当前版本更高但缺中间环节的迁移。
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
    version = migration.toVersion;
  }
  return ok(current);
}
