import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { migrations, migrateData } from "./migrations";
import { parseWorkspace, serializeWorkspace } from "./schema";

/** 把 v2 序列化数据降级为 v1 形态：去掉每表 writeVerify、加回全局 readVerifySettings、版本设为 1。 */
function toV1Data(
  options: { globalReadVerify?: unknown } = {},
): Record<string, unknown> {
  const data = JSON.parse(
    serializeWorkspace(createEmptyWorkspace()),
  ) as Record<string, unknown> & {
    sheets: Array<Record<string, unknown>>;
  };
  for (const sheet of data.sheets) {
    delete sheet.writeVerify;
  }
  delete data.readVerifySettings;
  if (options.globalReadVerify !== undefined) {
    data.readVerifySettings = options.globalReadVerify;
  }
  data.schemaVersion = 1;
  return data;
}

/** 把 v3 序列化数据降级为 v2 形态：行去掉 registerCount/registerValues、加回 lastKnownRawValue、版本设为 2。 */
function toV2Data(
  options: { lastKnownRawValue?: number | null } = {},
): Record<string, unknown> {
  const data = JSON.parse(
    serializeWorkspace(createEmptyWorkspace()),
  ) as Record<string, unknown> & {
    sheets: Array<{ rows: Array<Record<string, unknown>> }>;
  };
  for (const sheet of data.sheets) {
    for (const row of sheet.rows) {
      delete row.registerCount;
      delete row.registerValues;
      delete row.registers;
      row.lastKnownRawValue = options.lastKnownRawValue ?? null;
    }
  }
  data.schemaVersion = 2;
  return data;
}

/** 把 v4 序列化数据降级为 v3 形态：行去掉 registers、可指定范围行 registerCount、版本设为 3。 */
function toV3Data(options: { rangeCount?: number } = {}): Record<string, unknown> {
  const data = JSON.parse(
    serializeWorkspace(createEmptyWorkspace()),
  ) as Record<string, unknown> & {
    sheets: Array<{ rows: Array<Record<string, unknown>> }>;
  };
  for (const sheet of data.sheets) {
    for (const row of sheet.rows) {
      delete row.registers;
      if (options.rangeCount !== undefined) {
        row.registerCount = options.rangeCount;
      }
    }
  }
  data.schemaVersion = 3;
  return data;
}

describe("migrations v1→v2（写后回读配置下放到每表）", () => {
  it("迁移链为 v1→v2→v3→v4 且版本连续", () => {
    expect(migrations).toHaveLength(3);
    expect(migrations[0]?.fromVersion).toBe(1);
    expect(migrations[0]?.toVersion).toBe(2);
    expect(migrations[1]?.fromVersion).toBe(2);
    expect(migrations[1]?.toVersion).toBe(3);
    expect(migrations[2]?.fromVersion).toBe(3);
    expect(migrations[2]?.toVersion).toBe(4);
  });

  it("v1 数据：把全局 readVerifySettings 迁移到各表并删除全局字段、版本升至 4（经 v2→v3→v4）", () => {
    const migrated = migrateData(
      toV1Data({ globalReadVerify: { mode: "delayed", delayMs: 500 } }),
      migrations,
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const value = migrated.value;
    expect(value.schemaVersion).toBe(4);
    expect("readVerifySettings" in value).toBe(false);
    const sheets = value.sheets as Array<Record<string, unknown>>;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.writeVerify).toEqual({ mode: "delayed", delayMs: 500 });
  });

  it("v1 数据：无全局 readVerifySettings 时各表补默认立即回读", () => {
    const migrated = migrateData(toV1Data(), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const sheets = migrated.value.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]?.writeVerify).toEqual({
      mode: "immediate",
      delayMs: null,
    });
  });

  it("经 parseWorkspace 完整走通：v1 全局 off → 各表 off（方案 B，旧工作区保持 off），版本升 4", () => {
    const parsed = parseWorkspace(
      toV1Data({ globalReadVerify: { mode: "off", delayMs: null } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(4);
    expect(parsed.value.sheets[0]?.writeVerify).toEqual({
      mode: "off",
      delayMs: null,
    });
  });

  it("v2 数据：走 v2→v3→v4（补 registerCount、lastKnownRawValue → registerValues），版本升 4", () => {
    const migrated = migrateData(
      toV2Data({ lastKnownRawValue: 123 }),
      migrations,
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const value = migrated.value;
    expect(value.schemaVersion).toBe(4);
    const rows =
      (value.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    const row = rows[0];
    expect(row?.registerCount).toBe(1);
    expect(row?.registerValues).toEqual([123]);
    expect("lastKnownRawValue" in (row ?? {})).toBe(false);
  });

  it("经 parseWorkspace 走通 v2→v3→v4：旧 lastKnownRawValue 恢复为 registerValues", () => {
    const parsed = parseWorkspace(toV2Data({ lastKnownRawValue: 0x04d2 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(4);
    expect(
      parsed.value.sheets[0]?.rows[0]?.registerValues?.[0]?.value,
    ).toBe(0x04d2);
  });

  it("v3 数据：迁移到 v4，单寄存器行 registers=null", () => {
    const data = JSON.parse(
      serializeWorkspace(createEmptyWorkspace()),
    ) as Record<string, unknown>;
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(4);
    const rows =
      (migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    expect(rows[0]?.registers).toBeNull();
  });

  it("v3 范围行数据：迁移到 v4 补齐 registers（继承父行 dataType，展示与迁移前一致）", () => {
    const data = toV3Data({ rangeCount: 2 });
    // 构造一个非 hex 类型范围行：验证补齐继承父行 dataType。
    const sheet = (data.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0];
    const rows = sheet?.rows ?? [];
    if (rows[0] !== undefined) rows[0].dataType = "unsigned";
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const migratedRows =
      (migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    const row = migratedRows[0];
    expect(row?.registerCount).toBe(2);
    expect(row?.registers).toEqual([
      { name: "", comment: "", dataType: "unsigned" },
      { name: "", comment: "", dataType: "unsigned" },
    ]);
  });

  it("经 parseWorkspace 走通 v3→v4：范围行 registers 补齐且可 round-trip", () => {
    const parsed = parseWorkspace(toV3Data({ rangeCount: 2 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(4);
    const row = parsed.value.sheets[0]?.rows[0];
    expect(row?.registerCount).toBe(2);
    expect(row?.registers).toHaveLength(2);
    expect(row?.registers?.[0]).toEqual({
      name: "",
      comment: "",
      dataType: "hex",
    });
  });
});
