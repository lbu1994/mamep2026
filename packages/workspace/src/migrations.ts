/**
 * 迁移框架（docs/AGENTS.md §19.6）。
 * 迁移单向、按版本顺序执行、不直接覆盖原始数据。
 *
 * v1→v2（2026-08-26，写后回读配置下放到每表）：
 * - 把 workspace 全局 readVerifySettings 迁移到各 sheet.writeVerify（旧全局值优先；
 *   无全局值时补默认立即回读）；
 * - 删除全局 readVerifySettings 字段；
 * - schemaVersion 升为 2。
 *
 * v2→v3（2026-08-27，多寄存器范围行 ADR-030）：
 * - 各 row 的 lastKnownRawValue（单值）迁移为 registerValues（数组，长度=registerCount）；
 * - 补 registerCount=1（老数据即单寄存器）；
 * - 删除 lastKnownRawValue 字段；
 * - schemaVersion 升为 3。
 *
 * v3→v4（2026-08-27，范围行子行可编辑化）：
 * - 范围行（registerCount>1）各 row 补齐 registers 数组（长度=registerCount，每项
 *   {name:"", comment:"", dataType: 父行 dataType}，保证迁移后展示与迁移前一致）；
 * - 单寄存器行 registers=null；
 * - schemaVersion 升为 4。
 *
 * v4→v5（2026-08-31，表类型 ADR-041）：
 * - 各 sheet 补齐 type="holding-register"（老数据即核心表；已有 type 保留）；
 * - schemaVersion 升为 5。
 *
 * v5→v6（2026-09-01，表级 Address Adjust + 主题主色 ADR-042）：
 * - 全局 profile.addressAdjust（RTU，off/on）复制到各 sheet.addressTransform
 *   （{transformId:"builtin.address-adjust", enabled: 全局===on}；已有值保留）；
 * - 删除各 profile 的 addressAdjust 字段（全局选项移出核心）；
 * - preferences 补 themePrimary=null 缺省（无数据转换，仅版本）；
 * - schemaVersion 升为 6。
 *
 * v6→v7（2026-09-01，dataType 开放 ADR-043 E-3）：
 * - 无数据转换（dataType 字符串透传），仅升版本；
 * - schemaVersion 升为 7。
 *
 * v7→v8（2026-09-02，主题色预设 ID ADR-047，逆转 ADR-042 任意取色）：
 * - 旧 preferences.themePrimary 的 {light,dark} 任意 HEX 无可映射预设 → 一律置 null（内置默认蓝）；
 * - schemaVersion 升为 8。
 *
 * v8→v9（2026-09-11，位级注释 ADR-052）：
 * - 各 row 补 bitComments=null（老数据无位注释；无数据转换）；
 * - schemaVersion 升为 9。
 *
 * v9→v10（2026-09-11，位级名称 ADR-052 需求追加）：
 * - 各 row 补 bitNames=null（v9 数据仅有位注释，名称缺省为空；bitComments 原值保留）；
 * - schemaVersion 升为 10。
 */
import { createMamepError, BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID, type Result } from "@mamep2026/domain";
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

const migrationV2ToV3: Migration = {
  fromVersion: 2,
  toVersion: 3,
  migrate(data) {
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    const next = {
      ...data,
      schemaVersion: 3,
      sheets: sheets.map((sheet) => ({
        ...sheet,
        rows: Array.isArray(sheet.rows)
          ? (sheet.rows as Record<string, unknown>[]).map((row) => {
              const lastKnown = (row as { lastKnownRawValue?: unknown })
                .lastKnownRawValue;
              const nextRow: Record<string, unknown> = {
                ...row,
                registerCount: 1,
                registerValues:
                  typeof lastKnown === "number" ? [lastKnown] : null,
              };
              delete nextRow.lastKnownRawValue;
              return nextRow;
            })
          : [],
      })),
    };
    return next;
  },
};

const migrationV3ToV4: Migration = {
  fromVersion: 3,
  toVersion: 4,
  migrate(data) {
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    const next = {
      ...data,
      schemaVersion: 4,
      sheets: sheets.map((sheet) => ({
        ...sheet,
        rows: Array.isArray(sheet.rows)
          ? (sheet.rows as Record<string, unknown>[]).map((row) => {
              const count =
                typeof row.registerCount === "number" ? row.registerCount : 1;
              const dataType =
                typeof row.dataType === "string" ? row.dataType : "hex";
              const registers =
                count > 1
                  ? Array.from({ length: count }, () => ({
                      name: "",
                      comment: "",
                      dataType,
                    }))
                  : null;
              return { ...row, registers };
            })
          : [],
      })),
    };
    return next;
  },
};

const migrationV4ToV5: Migration = {
  fromVersion: 4,
  toVersion: 5,
  migrate(data) {
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    const next = {
      ...data,
      schemaVersion: 5,
      sheets: sheets.map((sheet) => ({
        ...sheet,
        type:
          typeof sheet.type === "string" && sheet.type.length > 0
            ? sheet.type
            : "holding-register",
      })),
    };
    return next;
  },
};

const migrationV5ToV6: Migration = {
  fromVersion: 5,
  toVersion: 6,
  migrate(data) {
    // 全局 RTU profile 的 addressAdjust（ADR-013 全局选项，ADR-042 移出核心）。
    const profiles = Array.isArray(data.connectionProfiles)
      ? (data.connectionProfiles as Record<string, unknown>[])
      : [];
    const rtuProfile = profiles.find((p) => p.protocol === "rtu");
    const globalAdjust =
      rtuProfile !== undefined &&
      typeof rtuProfile.addressAdjust === "string"
        ? rtuProfile.addressAdjust
        : "off";
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    const next = {
      ...data,
      schemaVersion: 6,
      sheets: sheets.map((sheet) => {
        const existing =
          sheet.addressTransform !== null &&
          typeof sheet.addressTransform === "object" &&
          !Array.isArray(sheet.addressTransform)
            ? (sheet.addressTransform as Record<string, unknown>)
            : null;
        return {
          ...sheet,
          addressTransform:
            existing !== null
              ? existing
              : {
                  transformId: BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID,
                  enabled: globalAdjust === "on",
                },
        };
      }),
      // 全局 addressAdjust 移出核心：从各 profile 删除。
      connectionProfiles: profiles.map((profile) => {
        const next = { ...profile };
        delete next.addressAdjust;
        return next;
      }),
    };
    // preferences.themePrimary 缺省 null（无数据转换，仅版本）。
    const rawPreferences =
      data.preferences !== null &&
      typeof data.preferences === "object" &&
      !Array.isArray(data.preferences)
        ? (data.preferences as Record<string, unknown>)
        : {};
    return {
      ...next,
      preferences: {
        ...rawPreferences,
        themePrimary:
          "themePrimary" in rawPreferences ? rawPreferences.themePrimary : null,
      },
    };
  },
};

const migrationV6ToV7: Migration = {
  fromVersion: 6,
  toVersion: 7,
  migrate(data) {
    // ADR-043 E-3：dataType 开放（内置 + 插件字符串），无数据转换，仅升版本。
    return { ...data, schemaVersion: 7 };
  },
};

const migrationV7ToV8: Migration = {
  fromVersion: 7,
  toVersion: 8,
  migrate(data) {
    // ADR-047：任意取色移除 → 预设 ID；旧 {light,dark} 任意 HEX 无预设可映射 → 一律置 null（默认蓝）。
    const rawPreferences =
      data.preferences !== null &&
      typeof data.preferences === "object" &&
      !Array.isArray(data.preferences)
        ? (data.preferences as Record<string, unknown>)
        : {};
    return {
      ...data,
      schemaVersion: 8,
      preferences: {
        ...rawPreferences,
        themePrimary: null,
      },
    };
  },
};

const migrationV8ToV9: Migration = {
  fromVersion: 8,
  toVersion: 9,
  migrate(data) {
    // ADR-052：位级注释新增，老数据无位注释 → 各 row 补 bitComments=null（无数据转换，仅升版本）。
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    return {
      ...data,
      schemaVersion: 9,
      sheets: sheets.map((sheet) => {
        const rows = Array.isArray(sheet.rows)
          ? (sheet.rows as Record<string, unknown>[])
          : [];
        return {
          ...sheet,
          rows: rows.map((row) => ({
            ...row,
            bitComments: row.bitComments === undefined ? null : row.bitComments,
          })),
        };
      }),
    };
  },
};

const migrationV9ToV10: Migration = {
  fromVersion: 9,
  toVersion: 10,
  migrate(data) {
    // ADR-052 需求追加：位级名称新增（位 Name 列可编辑）→ 各 row 补 bitNames=null；
    // v9 的 bitComments 原值保留（不丢已有位注释）。
    const sheets = Array.isArray(data.sheets)
      ? (data.sheets as Record<string, unknown>[])
      : [];
    return {
      ...data,
      schemaVersion: 10,
      sheets: sheets.map((sheet) => {
        const rows = Array.isArray(sheet.rows)
          ? (sheet.rows as Record<string, unknown>[])
          : [];
        return {
          ...sheet,
          rows: rows.map((row) => ({
            ...row,
            bitNames: row.bitNames === undefined ? null : row.bitNames,
          })),
        };
      }),
    };
  },
};

export const migrations: readonly Migration[] = [
  migrationV1ToV2,
  migrationV2ToV3,
  migrationV3ToV4,
  migrationV4ToV5,
  migrationV5ToV6,
  migrationV6ToV7,
  migrationV7ToV8,
  migrationV8ToV9,
  migrationV9ToV10,
];

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
