import { describe, expect, it } from "vitest";
import { createEmptyWorkspace, type Workspace } from "@mamep2026/domain";
import { parseWorkspace, serializeWorkspace } from "./schema";

function mutate(w: Workspace, patch: (mutable: Workspace) => void): Workspace {
  patch(w);
  return w;
}

describe("connection profile persistence", () => {
  it("persists port parameters and non-port settings across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const profile = w.connectionProfiles[0];
      if (profile === undefined) return;
      // 端口连接参数（持久化）
      profile.baudRate = 115200;
      profile.dataBits = 7;
      profile.stopBits = 2;
      profile.parity = "even";
      profile.flowControl = "rts-cts";
      profile.recentPortHint = "COM10";
      // 非端口连接参数（持久化）
      profile.slaveAddress = 5;
      profile.requestTimeoutMs = 2000;
      profile.retryCount = 3;
      profile.interRequestDelayMs = 120;
      profile.addressAdjust = "on";
    });

    const serialized = serializeWorkspace(workspace);
    // 端口参数进入持久化形态。
    expect(serialized).toContain("baudRate");
    expect(serialized).toContain("recentPortHint");

    const parsed = parseWorkspace(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const profile = parsed.value.connectionProfiles[0];
    // 端口参数恢复。
    expect(profile?.baudRate).toBe(115200);
    expect(profile?.dataBits).toBe(7);
    expect(profile?.stopBits).toBe(2);
    expect(profile?.parity).toBe("even");
    expect(profile?.flowControl).toBe("rts-cts");
    expect(profile?.recentPortHint).toBe("COM10");
    // 非端口参数恢复。
    expect(profile?.slaveAddress).toBe(5);
    expect(profile?.requestTimeoutMs).toBe(2000);
    expect(profile?.retryCount).toBe(3);
    expect(profile?.interRequestDelayMs).toBe(120);
    expect(profile?.addressAdjust).toBe("on");
  });

  it("parses profiles written without port fields by backfilling defaults", () => {
    // 模拟「端口参数未持久化」期间写入的数据（profile 只含非端口字段）。
    const workspace = createEmptyWorkspace();
    const legacy = JSON.parse(serializeWorkspace(workspace));
    const storedProfile = legacy.connectionProfiles[0] as Record<
      string,
      unknown
    >;
    for (const key of [
      "baudRate",
      "dataBits",
      "stopBits",
      "parity",
      "flowControl",
      "recentPortHint",
    ]) {
      delete storedProfile[key];
    }

    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = parsed.value.connectionProfiles[0];
    // 端口字段回填默认值；非端口字段保留。
    expect(restored?.baudRate).toBe(9600);
    expect(restored?.dataBits).toBe(8);
    expect(restored?.stopBits).toBe(1);
    expect(restored?.parity).toBe("none");
    expect(restored?.flowControl).toBe("off");
    expect(restored?.recentPortHint).toBeNull();
    expect(restored?.slaveAddress).toBe(
      workspace.connectionProfiles[0]?.slaveAddress,
    );
  });

  it("parses legacy persisted profiles (round-trip shape unchanged)", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    // 旧数据即完整 profile（含端口字段），直接可解析。
    legacy.connectionProfiles[0] = {
      ...legacy.connectionProfiles[0],
      baudRate: 57600,
      dataBits: 7,
      stopBits: 2,
      parity: "odd",
      flowControl: "rts-cts",
      recentPortHint: "COM10",
      slaveAddress: 9,
      requestTimeoutMs: 3000,
      retryCount: 4,
      interRequestDelayMs: 200,
      addressAdjust: "on",
    };
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const profile = parsed.value.connectionProfiles[0];
    // 端口字段与非端口字段均从旧数据恢复。
    expect(profile?.baudRate).toBe(57600);
    expect(profile?.parity).toBe("odd");
    expect(profile?.recentPortHint).toBe("COM10");
    expect(profile?.slaveAddress).toBe(9);
    expect(profile?.interRequestDelayMs).toBe(200);
    expect(profile?.requestTimeoutMs).toBe(3000);
  });
});

describe("preferences language persistence", () => {
  it("persists the selected interface language across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.preferences.language = "zh-CN";
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.preferences.language).toBe("zh-CN");
  });

  it("defaults language to en-US for legacy data without the field", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    delete legacy.preferences.language;
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.preferences.language).toBe("en-US");
  });
});

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
    // 默认表预置 defaultRowCount 个空行（default-50-rows 特性），push 的行在末尾。
    const row = parsed.value.sheets[0]?.rows.at(-1);
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

  it("defaults sheet registerRadix to dec for legacy data without the field", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    // 模拟老版本数据：sheet 无 registerRadix 字段。
    for (const sheet of legacy.sheets) {
      delete sheet.registerRadix;
    }
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.registerRadix).toBe("dec");
  });

  it("preserves per-sheet registerRadix across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.registerRadix = "hex";
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.registerRadix).toBe("hex");
  });

  it("defaults sheet columnWidths to {} for legacy data without the field", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    // 模拟老版本数据：sheet 无 columnWidths 字段。
    for (const sheet of legacy.sheets) {
      delete sheet.columnWidths;
    }
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.columnWidths).toEqual({});
  });

  it("preserves per-sheet columnWidths across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.columnWidths = { name: 210, type: 90 };
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.columnWidths).toEqual({
      name: 210,
      type: 90,
    });
  });

  it("defaults sheet columnOrder to null for legacy data without the field", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    // 模拟老版本数据：sheet 无 columnOrder 字段。
    for (const sheet of legacy.sheets) {
      delete sheet.columnOrder;
    }
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.columnOrder).toBeNull();
  });

  it("preserves per-sheet columnOrder across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.columnOrder = ["data", "name", "no"];
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.columnOrder).toEqual(["data", "name", "no"]);
  });
});
