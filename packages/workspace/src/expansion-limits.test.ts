import { describe, expect, it, vi } from "vitest";
import {
  createEmptyRow,
  createEmptyWorkspace,
  createRegisterSheet,
  MAX_ROW_REGISTER_COUNT,
  MAX_WORKSPACE_EXPANDED_ROWS,
  validateWorkspaceExpansion,
  workspaceSchemaVersion,
} from "@mamep2026/domain";
import { migrateData, migrations } from "./migrations";
import {
  parseWorkspaceData,
  serializeWorkspaceSnapshot,
  workspaceSchema,
} from "./schema";

function fixture(counts: unknown[], version = workspaceSchemaVersion) {
  return {
    ...createEmptyWorkspace(),
    schemaVersion: version,
    sheets: [
      {
        ...createRegisterSheet("Import", 0),
        rows: counts.map((registerCount) => ({
          ...createEmptyRow(),
          registerCount,
        })),
      },
    ],
  };
}

describe("SEC-06 workspace expansion limits", () => {
  it.each([1, 2, 3, 4, workspaceSchemaVersion])(
    "rejects a small JSON with a huge count at version %s",
    (version) => {
      const text = JSON.stringify(fixture([1e12], version));
      expect(text.length).toBeLessThan(4_096);
      const input: unknown = JSON.parse(text);
      const allocate = vi.spyOn(Array, "from");
      try {
        expect(parseWorkspaceData(input)).toMatchObject({
          ok: false,
          error: { code: "WORKSPACE_SCHEMA_INVALID", category: "persistence" },
        });
        expect(allocate).not.toHaveBeenCalled();
      } finally {
        allocate.mockRestore();
      }
    },
  );

  it.each([
    NaN,
    Infinity,
    -Infinity,
    0,
    -1,
    1.5,
    "2",
    null,
    true,
    {},
    [],
    Number.MAX_SAFE_INTEGER,
    MAX_ROW_REGISTER_COUNT + 1,
  ])("rejects invalid count %s in migration and current Schema", (count) => {
    expect(parseWorkspaceData(fixture([count], 3)).ok).toBe(false);
    expect(parseWorkspaceData(fixture([count])).ok).toBe(false);
    expect(workspaceSchema.safeParse(fixture([count])).success).toBe(false);
  });

  it("rejects JSON exponent overflow without coercing it", () => {
    const text = JSON.stringify(fixture([12345], 3)).replace(
      '"registerCount":12345',
      '"registerCount":1e400',
    );
    expect(parseWorkspaceData(JSON.parse(text)).ok).toBe(false);
  });

  it("preserves omitted-count defaults and legacy single-register migration", () => {
    for (const version of [1, 2, 3, workspaceSchemaVersion]) {
      const parsed = parseWorkspaceData(fixture([undefined], version));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.error.technicalMessage);
      expect(parsed.value.sheets[0]?.rows[0]?.registerCount).toBe(1);
    }
  });

  it("accepts a full address range and preserves v3 metadata inheritance", () => {
    const input = fixture([MAX_ROW_REGISTER_COUNT], 3);
    const before = structuredClone(input);
    const parsed = parseWorkspaceData(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.technicalMessage);
    expect(parsed.value.sheets[0]?.rows[0]?.registers).toHaveLength(
      MAX_ROW_REGISTER_COUNT,
    );
    expect(parsed.value.sheets[0]?.rows[0]?.registers?.at(-1)).toEqual({
      name: "",
      comment: "",
      dataType: "hex",
    });
    expect(input).toEqual(before);
  });

  it.each([3, workspaceSchemaVersion])(
    "enforces the exact whole-workspace budget at version %s",
    (version) => {
      // Two parents plus their register children exactly fill the budget.
      const input = fixture(
        [50_000, MAX_WORKSPACE_EXPANDED_ROWS - 50_000 - 2],
        version,
      );
      expect(parseWorkspaceData(input).ok).toBe(true);
      const second = input.sheets[0]?.rows[1];
      if (second === undefined) throw new Error("missing row");
      second.registerCount = 49_999;
      const before = structuredClone(input);
      const allocate = vi.spyOn(Array, "from");
      try {
        expect(migrateData(input, migrations).ok).toBe(false);
        expect(allocate).not.toHaveBeenCalled();
      } finally {
        allocate.mockRestore();
      }
      expect(parseWorkspaceData(input).ok).toBe(false);
      expect(workspaceSchema.safeParse(input).success).toBe(false);
      expect(input).toEqual(before);
    },
  );

  it("sums separate sheets, including closed and plugin sheets", () => {
    const first = fixture([50_000]);
    const second = fixture([50_000]).sheets[0];
    if (second === undefined) throw new Error("missing sheet");
    first.sheets.push({ ...second, open: false, type: "vendor:custom" });
    expect(parseWorkspaceData(first).ok).toBe(false);
  });

  it("counts binary details using the post-migration type", () => {
    const input = fixture([6_000], 3);
    const row = input.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    row.dataType = "binary";
    row.registers = Array.from({ length: 6_000 }, () => ({
      name: "",
      comment: "",
      dataType: "hex",
    }));
    // Current format has HEX children, but v3 replaces them with binary children.
    expect(
      workspaceSchema.safeParse({
        ...input,
        schemaVersion: workspaceSchemaVersion,
      }).success,
    ).toBe(true);
    const allocate = vi.spyOn(Array, "from");
    try {
      expect(parseWorkspaceData(input).ok).toBe(false);
      expect(allocate).not.toHaveBeenCalled();
    } finally {
      allocate.mockRestore();
    }
  });

  it("counts binary children under a non-binary parent in the current format", () => {
    const input = fixture([6_000]);
    const row = input.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    row.registers = Array.from({ length: 6_000 }, () => ({
      name: "",
      comment: "",
      dataType: "binary",
    }));
    expect(parseWorkspaceData(input).ok).toBe(false);
  });

  it("counts single-register parents and bit details without constructing a tree", () => {
    const input = fixture(Array.from({ length: 5_883 }, () => 1));
    for (const row of input.sheets[0]?.rows ?? []) row.dataType = "binary";
    expect(validateWorkspaceExpansion(input).ok).toBe(false);
  });

  it("rejects invalid in-memory counts on save without changing the workspace", () => {
    const workspace = createEmptyWorkspace();
    const row = workspace.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    row.registerCount = Infinity;
    const before = structuredClone(workspace);
    expect(serializeWorkspaceSnapshot(workspace).ok).toBe(false);
    expect(workspace).toEqual(before);
  });
});
