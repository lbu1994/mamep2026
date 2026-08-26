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

describe("migrations v1→v2（写后回读配置下放到每表）", () => {
  it("迁移链只包含 v1→v2 一条，且版本连续", () => {
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.fromVersion).toBe(1);
    expect(migrations[0]?.toVersion).toBe(2);
  });

  it("v1 数据：把全局 readVerifySettings 迁移到各表并删除全局字段、版本升 2", () => {
    const migrated = migrateData(
      toV1Data({ globalReadVerify: { mode: "delayed", delayMs: 500 } }),
      migrations,
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const value = migrated.value;
    expect(value.schemaVersion).toBe(2);
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

  it("经 parseWorkspace 完整走通：v1 全局 off → 各表 off（方案 B，旧工作区保持 off）", () => {
    const parsed = parseWorkspace(
      toV1Data({ globalReadVerify: { mode: "off", delayMs: null } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(2);
    expect(parsed.value.sheets[0]?.writeVerify).toEqual({
      mode: "off",
      delayMs: null,
    });
  });

  it("v2 数据：不迁移，保留每表 writeVerify", () => {
    const data = JSON.parse(
      serializeWorkspace(createEmptyWorkspace()),
    ) as Record<string, unknown>;
    const migrated = migrateData(data, migrations);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(2);
  });
});
