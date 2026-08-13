import { describe, expect, it } from "vitest";
import { createEmptyWorkspace, type Workspace } from "@mamep2026/domain";
import { parseWorkspace, serializeWorkspace } from "./schema";

function mutate(w: Workspace, patch: (mutable: Workspace) => void): Workspace {
  patch(w);
  return w;
}

describe("workspace schema round-trip", () => {
  it("serializes and parses an empty workspace preserving key fields", () => {
    const workspace = createEmptyWorkspace();
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const value = parsed.value;
    expect(value.workspaceId).toBe(workspace.workspaceId);
    expect(value.schemaVersion).toBe(workspace.schemaVersion);
    expect(value.sheets).toHaveLength(1);
    expect(value.connectionProfiles).toHaveLength(1);
    expect(value.connectionProfiles[0]?.interRequestDelayMs).toBe(50);
    expect(value.connectionProfiles[0]?.addressAdjust).toBe("off");
    expect(value.connectionProfiles[0]?.slaveAddress).toBe(1);
  });

  it("preserves comment, polling and trace flags per row", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.rows.push({
        rowId: "row-1" as never,
        order: 0,
        name: "Speed Ref",
        comment: "unit: rpm",
        addressDraft: "0001",
        addressValue: { value: 1 } as never,
        dataType: "unsigned-0.1",
        pollingEnabled: true,
        traceEnabled: true,
        cellText: "12.3",
        lastKnownRawValue: { value: 123 } as never,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = parsed.value.sheets[0]?.rows[0];
    expect(row).toBeDefined();
    expect(row?.name).toBe("Speed Ref");
    expect(row?.comment).toBe("unit: rpm");
    expect(row?.pollingEnabled).toBe(true);
    expect(row?.traceEnabled).toBe(true);
    expect(row?.addressValue?.value).toBe(1);
    expect(row?.lastKnownRawValue?.value).toBe(123);
    expect(row?.cellText).toBe("12.3");
    expect(row?.dataType).toBe("unsigned-0.1");
  });

  it("rejects corrupted JSON data with a structured persistence error", () => {
    const result = parseWorkspace(
      JSON.parse('{"schemaVersion":"not-a-number"}'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("persistence");
      expect(result.error.code).toBe("WORKSPACE_SCHEMA_INVALID");
    }
  });

  it("rejects missing required fields", () => {
    const result = parseWorkspace({ schemaVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WORKSPACE_SCHEMA_INVALID");
  });

  it("preserves unknown plugin settings", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.pluginStates = [
        {
          pluginId: "example" as never,
          enabled: true,
          settings: { vendorKey: "vendor-value", nested: { a: 1 } },
          lastKnownVersion: "1.0.0",
          permissions: ["panel"],
        },
      ];
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pluginStates[0]?.settings.vendorKey).toBe(
      "vendor-value",
    );
  });
});
