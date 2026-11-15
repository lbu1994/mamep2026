import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { migrations, migrateData } from "./migrations";
import { parseWorkspace, serializeWorkspace } from "./schema";

/** 把 v2 序列化数据降级为 v1 形态：去掉每表 writeVerify、加回全局 readVerifySettings、版本设为 1。 */
function toV1Data(
  options: { globalReadVerify?: unknown } = {},
): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
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
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
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
function toV3Data(
  options: { rangeCount?: number } = {},
): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
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

/** 把 v5 序列化数据降级为 v4 形态：sheet 去掉 type、版本设为 4。 */
function toV4Data(): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
    sheets: Array<Record<string, unknown>>;
  };
  for (const sheet of data.sheets) {
    delete sheet.type;
  }
  data.schemaVersion = 4;
  return data;
}

/** 把 v6 序列化数据降级为 v5 形态：sheet 去掉 addressTransform、preferences 去掉 themePrimary、RTU profile 加回全局 addressAdjust、版本设为 5。 */
function toV5Data(
  options: { addressAdjust?: string } = {},
): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
    sheets: Array<Record<string, unknown>>;
    connectionProfiles: Array<Record<string, unknown>>;
    preferences: Record<string, unknown>;
  };
  for (const sheet of data.sheets) {
    delete sheet.addressTransform;
  }
  delete data.preferences.themePrimary;
  const rtu = data.connectionProfiles.find((p) => p.protocol === "rtu");
  if (rtu !== undefined) rtu.addressAdjust = options.addressAdjust ?? "off";
  data.schemaVersion = 5;
  return data;
}

describe("migrations v1→v2（写后回读配置下放到每表）", () => {
  it("迁移链为 v1→v2→v3→v4→v5→v6→v7→v8→v9→v10 且版本连续", () => {
    expect(migrations).toHaveLength(9);
    expect(migrations[0]?.fromVersion).toBe(1);
    expect(migrations[0]?.toVersion).toBe(2);
    expect(migrations[1]?.fromVersion).toBe(2);
    expect(migrations[1]?.toVersion).toBe(3);
    expect(migrations[2]?.fromVersion).toBe(3);
    expect(migrations[2]?.toVersion).toBe(4);
    expect(migrations[3]?.fromVersion).toBe(4);
    expect(migrations[3]?.toVersion).toBe(5);
    expect(migrations[4]?.fromVersion).toBe(5);
    expect(migrations[4]?.toVersion).toBe(6);
    expect(migrations[5]?.fromVersion).toBe(6);
    expect(migrations[5]?.toVersion).toBe(7);
    expect(migrations[6]?.fromVersion).toBe(7);
    expect(migrations[6]?.toVersion).toBe(8);
    expect(migrations[7]?.fromVersion).toBe(8);
    expect(migrations[7]?.toVersion).toBe(9);
    expect(migrations[8]?.fromVersion).toBe(9);
    expect(migrations[8]?.toVersion).toBe(10);
  });

  it("v1 数据：把全局 readVerifySettings 迁移到各表并删除全局字段、版本升至 10（经 v2→v3→v4→v5→v6→v7→v8→v9→v10）", () => {
    const migrated = migrateData(
      toV1Data({ globalReadVerify: { mode: "delayed", delayMs: 500 } }),
      migrations,
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const value = migrated.value;
    expect(value.schemaVersion).toBe(10);
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

  it("经 parseWorkspace 完整走通：v1 全局 off → 各表 off（方案 B，旧工作区保持 off），版本升 10", () => {
    const parsed = parseWorkspace(
      toV1Data({ globalReadVerify: { mode: "off", delayMs: null } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.sheets[0]?.writeVerify).toEqual({
      mode: "off",
      delayMs: null,
    });
  });

  it("v2 数据：走 v2→v3→v4→v5→v6→v7→v8→v9→v10（补 registerCount、lastKnownRawValue → registerValues），版本升 10", () => {
    const migrated = migrateData(
      toV2Data({ lastKnownRawValue: 123 }),
      migrations,
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const value = migrated.value;
    expect(value.schemaVersion).toBe(10);
    const rows =
      (value.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    const row = rows[0];
    expect(row?.registerCount).toBe(1);
    expect(row?.registerValues).toEqual([123]);
    expect("lastKnownRawValue" in (row ?? {})).toBe(false);
  });

  it("经 parseWorkspace 走通 v2→v3→v4→v5→v6→v7→v8→v9→v10：旧 lastKnownRawValue 恢复为 registerValues", () => {
    const parsed = parseWorkspace(toV2Data({ lastKnownRawValue: 0x04d2 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.sheets[0]?.rows[0]?.registerValues?.[0]?.value).toBe(
      0x04d2,
    );
  });

  it("v3 数据：迁移到 v4，单寄存器行 registers=null", () => {
    const data = JSON.parse(
      serializeWorkspace(createEmptyWorkspace()),
    ) as Record<string, unknown>;
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    const rows =
      (
        migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>
      )[0]?.rows ?? [];
    expect(rows[0]?.registers).toBeNull();
  });

  it("v3 范围行数据：迁移到 v4 补齐 registers（继承父行 dataType，展示与迁移前一致）", () => {
    const data = toV3Data({ rangeCount: 2 });
    // 构造一个非 hex 类型范围行：验证补齐继承父行 dataType。
    const sheet = (
      data.sheets as Array<{ rows: Array<Record<string, unknown>> }>
    )[0];
    const rows = sheet?.rows ?? [];
    if (rows[0] !== undefined) rows[0].dataType = "unsigned";
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const migratedRows =
      (
        migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>
      )[0]?.rows ?? [];
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
    expect(parsed.value.schemaVersion).toBe(10);
    const row = parsed.value.sheets[0]?.rows[0];
    expect(row?.registerCount).toBe(2);
    expect(row?.registers).toHaveLength(2);
    expect(row?.registers?.[0]).toEqual({
      name: "",
      comment: "",
      dataType: "hex",
    });
  });

  it("v4 数据：sheet 补齐 type=holding-register，版本升至 10（经 v5→v6→v7→v8→v9→v10，ADR-041/042/043/047/052）", () => {
    const migrated = migrateData(toV4Data(), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    const sheets = migrated.value.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]?.type).toBe("holding-register");
  });

  it("v5 数据（含插件表类型）round-trip 保留 type（ADR-041）", () => {
    const data = JSON.parse(
      serializeWorkspace(createEmptyWorkspace()),
    ) as Record<string, unknown> & { sheets: Array<Record<string, unknown>> };
    data.sheets[0] = {
      ...data.sheets[0],
      type: "yaskawa-memobus-67h-010dh-010eh:holding-register",
    };
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    const sheets = migrated.value.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]?.type).toBe(
      "yaskawa-memobus-67h-010dh-010eh:holding-register",
    );
  });
});

describe("migrations v5→v6（表级 Address Adjust + 主题主色，ADR-042）", () => {
  it("v5 数据：全局 profile.addressAdjust=on 复制到各表 addressTransform.enabled，并删除 profile 字段", () => {
    const migrated = migrateData(toV5Data({ addressAdjust: "on" }), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const value = migrated.value;
    expect(value.schemaVersion).toBe(10);
    const sheets = value.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]?.addressTransform).toEqual({
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    const profiles = value.connectionProfiles as Array<Record<string, unknown>>;
    expect("addressAdjust" in (profiles[0] ?? {})).toBe(false);
  });

  it("v5 数据：全局 off → 各表 addressTransform.enabled=false（旧工作区保持关闭）", () => {
    const migrated = migrateData(
      toV5Data({ addressAdjust: "off" }),
      migrations,
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const sheets = migrated.value.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]?.addressTransform).toEqual({
      transformId: "builtin.address-adjust",
      enabled: false,
    });
  });

  it("v5 数据：preferences.themePrimary 缺省 null", () => {
    const migrated = migrateData(toV5Data(), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const preferences = migrated.value.preferences as Record<string, unknown>;
    expect(preferences.themePrimary).toBeNull();
  });

  it("经 parseWorkspace 走通 v5→v6：全局 on 的表在新工作区可 round-trip", () => {
    const parsed = parseWorkspace(toV5Data({ addressAdjust: "on" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.sheets[0]?.addressTransform).toEqual({
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    expect(parsed.value.preferences.themePrimary).toBeNull();
    const profile = parsed.value.connectionProfiles[0];
    if (profile === undefined) throw new Error("missing profile");
    expect("addressAdjust" in profile).toBe(false);
  });
});

describe("migrations v6→v7（dataType 开放，ADR-043 E-3）", () => {
  it("v6 数据：仅升版本，无数据转换（dataType 字符串透传）", () => {
    const migrated = migrateData(toV5Data({ addressAdjust: "on" }), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    // 字段原样保留（v6 数据来自 toV5Data 走 v5→v6→v7）。
    const sheets = migrated.value.sheets as Array<Record<string, unknown>>;
    expect(sheets[0]?.addressTransform).toEqual({
      transformId: "builtin.address-adjust",
      enabled: true,
    });
  });

  it("v6 数据含插件 dataType：parseWorkspace round-trip 保留（E-3 开放字符串）", () => {
    const data = JSON.parse(
      serializeWorkspace(createEmptyWorkspace()),
    ) as Record<string, unknown> & {
      sheets: Array<{ rows: Array<Record<string, unknown>> }>;
    };
    // 把 dataType 改成插件类型字符串。
    const rows = data.sheets[0]?.rows ?? [];
    if (rows[0] !== undefined) rows[0].dataType = "my-plugin:speed";
    const parsed = parseWorkspace(data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.sheets[0]?.rows[0]?.dataType).toBe("my-plugin:speed");
  });
});

/** 把 v8 序列化数据降级为 v7 形态：preferences.themePrimary 恢复为 {light,dark} 对象、版本设为 7。 */
function toV7Data(): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & { preferences: Record<string, unknown> };
  data.preferences.themePrimary = { light: "#1a7f37", dark: "#2ea043" };
  data.schemaVersion = 7;
  return data;
}

describe("migrations v7→v8（主题色预设 ID，ADR-047）", () => {
  it("v7 数据：旧 {light,dark} 任意 HEX 一律置 null（默认蓝），版本升 10", () => {
    const migrated = migrateData(toV7Data(), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    const preferences = migrated.value.preferences as Record<string, unknown>;
    expect(preferences.themePrimary).toBeNull();
  });

  it("经 parseWorkspace 走通 v7→v8：旧自定义色回退默认且 round-trip", () => {
    const parsed = parseWorkspace(toV7Data());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.preferences.themePrimary).toBeNull();
  });
});

/** 把 v10 序列化数据降级为 v8 形态：行去掉 bitComments/bitNames、版本设为 8。 */
function toV8Data(): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
    sheets: Array<{ rows: Array<Record<string, unknown>> }>;
  };
  for (const sheet of data.sheets) {
    for (const row of sheet.rows) {
      delete row.bitComments;
      delete row.bitNames;
    }
  }
  data.schemaVersion = 8;
  return data;
}

/** 把 v10 序列化数据降级为 v9 形态：行去掉 bitNames、版本设为 9（保留 bitComments）。 */
function toV9Data(): Record<string, unknown> {
  const data = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
    string,
    unknown
  > & {
    sheets: Array<{ rows: Array<Record<string, unknown>> }>;
  };
  for (const sheet of data.sheets) {
    for (const row of sheet.rows) {
      delete row.bitNames;
    }
  }
  data.schemaVersion = 9;
  return data;
}

describe("migrations v8→v9（位级注释，ADR-052）", () => {
  it("v8 数据：各 row 补 bitComments=null，版本升至 10（经 v9→v10）", () => {
    const migrated = migrateData(toV8Data(), migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    const rows =
      (
        migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>
      )[0]?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.bitComments === null)).toBe(true);
  });

  it("v8 数据已有 bitComments 时保留原值（不覆盖）", () => {
    const data = toV8Data();
    const rows =
      (data.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    if (rows[0] !== undefined) rows[0].bitComments = [["carry"]];
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const migratedRows =
      (
        migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>
      )[0]?.rows ?? [];
    expect(migratedRows[0]?.bitComments).toEqual([["carry"]]);
  });

  it("经 parseWorkspace 走通 v8→v9：旧工作区可加载且位注释缺省 null", () => {
    const parsed = parseWorkspace(toV8Data());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.sheets[0]?.rows[0]?.bitComments).toBeNull();
  });
});

describe("migrations v9→v10（位级名称，ADR-052 需求追加）", () => {
  it("v9 数据：各 row 补 bitNames=null，版本升 10，bitComments 保留原值", () => {
    const data = toV9Data();
    const rows =
      (data.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    if (rows[0] !== undefined) rows[0].bitComments = [["carry"]];
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(10);
    const migratedRows =
      (
        migrated.value.sheets as Array<{ rows: Array<Record<string, unknown>> }>
      )[0]?.rows ?? [];
    expect(migratedRows.every((row) => row.bitNames === null)).toBe(true);
    // v9 已有位注释不丢。
    expect(migratedRows[0]?.bitComments).toEqual([["carry"]]);
  });

  it("经 parseWorkspace 走通 v9→v10：位名称缺省 null、位注释保留", () => {
    const data = toV9Data();
    const rows =
      (data.sheets as Array<{ rows: Array<Record<string, unknown>> }>)[0]
        ?.rows ?? [];
    if (rows[0] !== undefined) rows[0].bitComments = [["carry"]];
    const parsed = parseWorkspace(data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(10);
    expect(parsed.value.sheets[0]?.rows[0]?.bitNames).toBeNull();
    expect(parsed.value.sheets[0]?.rows[0]?.bitComments?.[0]?.[0]).toBe(
      "carry",
    );
  });
});
