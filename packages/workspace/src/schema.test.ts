import { describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  type RtuConnectionProfile,
  type Workspace,
} from "@mamep2026/domain";
import { parseWorkspace, serializeWorkspace, workspaceSchema } from "./schema";

function mutate(w: Workspace, patch: (mutable: Workspace) => void): Workspace {
  patch(w);
  return w;
}

/** 测试辅助：默认工作区首个 profile 为 RTU，收窄联合类型后返回。 */
function firstRtuProfile(
  profiles: Workspace["connectionProfiles"],
): RtuConnectionProfile {
  const profile = profiles[0];
  if (profile === undefined || profile.protocol !== "rtu") {
    throw new Error("expected first connection profile to be RTU");
  }
  return profile;
}

describe("connection profile persistence", () => {
  it("persists port parameters and non-port settings across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const profile = firstRtuProfile(w.connectionProfiles);
      // 端口连接参数（持久化）
      profile.baudRate = 115200;
      profile.dataBits = 7;
      profile.stopBits = 2;
      profile.parity = "even";
      profile.flowControl = "rts-cts";
      profile.recentPortHint = "COM10";
      // 非端口连接参数（持久化）
      profile.requestTimeoutMs = 2000;
      profile.retryCount = 3;
      // 从站地址为表级字段（持久化）
      const sheet = w.sheets[0];
      if (sheet !== undefined) sheet.slaveAddress = 5;
    });

    const serialized = serializeWorkspace(workspace);
    // 端口参数进入持久化形态。
    expect(serialized).toContain("baudRate");
    expect(serialized).toContain("recentPortHint");

    const parsed = parseWorkspace(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const profile = firstRtuProfile(parsed.value.connectionProfiles);
    // 端口参数恢复。
    expect(profile.baudRate).toBe(115200);
    expect(profile.dataBits).toBe(7);
    expect(profile.stopBits).toBe(2);
    expect(profile.parity).toBe("even");
    expect(profile.flowControl).toBe("rts-cts");
    expect(profile.recentPortHint).toBe("COM10");
    // 非端口参数恢复。
    expect(profile.requestTimeoutMs).toBe(2000);
    expect(profile.retryCount).toBe(3);
    // 每表独立从站地址恢复。
    expect(parsed.value.sheets[0]?.slaveAddress).toBe(5);
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
    const restored = firstRtuProfile(parsed.value.connectionProfiles);
    // 端口字段回填默认值；非端口字段保留。
    expect(restored.baudRate).toBe(9600);
    expect(restored.dataBits).toBe(8);
    expect(restored.stopBits).toBe(1);
    expect(restored.parity).toBe("none");
    expect(restored.flowControl).toBe("off");
    expect(restored.recentPortHint).toBeNull();
    // 从站地址已迁移为表级字段：profile 不再含该字段。
    expect("slaveAddress" in restored).toBe(false);
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
      // 旧全局 profile 中的 slaveAddress：解析时被剥离（不再持久化）。
      slaveAddress: 9,
      requestTimeoutMs: 3000,
      retryCount: 4,
      addressAdjust: "on",
    };
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const profile = firstRtuProfile(parsed.value.connectionProfiles);
    // 端口字段与非端口字段均从旧数据恢复。
    expect(profile.baudRate).toBe(57600);
    expect(profile.parity).toBe("odd");
    expect(profile.recentPortHint).toBe("COM10");
    expect(profile.requestTimeoutMs).toBe(3000);
    // 旧 profile 中的 slaveAddress 被剥离，不再进入领域对象。
    expect("slaveAddress" in profile).toBe(false);
    // 旧全局 addressAdjust 已移出核心：解析时被剥离，不再进入领域对象。
    expect("addressAdjust" in profile).toBe(false);
    // 从站地址以表级默认 1 回退（sheet 缺省补默认）。
    expect(parsed.value.sheets[0]?.slaveAddress).toBe(1);
  });

  it("persists per-sheet slave address and backfills default 1 for legacy sheets", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet !== undefined) sheet.slaveAddress = 42;
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.slaveAddress).toBe(42);

    // 老数据缺省：无 slaveAddress 字段时补默认 1，无需迁移。
    const legacy = JSON.parse(serializeWorkspace(workspace));
    delete legacy.sheets[0].slaveAddress;
    const parsedLegacy = parseWorkspace(legacy);
    expect(parsedLegacy.ok).toBe(true);
    if (!parsedLegacy.ok) return;
    expect(parsedLegacy.value.sheets[0]?.slaveAddress).toBe(1);
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
    // 表级地址变换默认 null：不调整。
    expect(value.sheets[0]?.addressTransform).toBeNull();
    // 从站地址为表级字段：默认 1。
    expect(value.sheets[0]?.slaveAddress).toBe(1);
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
        registerCount: 1,
        dataType: "unsigned-0.1",
        pollingEnabled: true,
        traceEnabled: true,
        cellText: "12.3",
        registerValues: [{ value: 123 }] as never,
        registers: null,
        bitComments: null,
        bitNames: null,
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
    expect(row?.registerValues?.[0]?.value).toBe(123);
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

  it("round-trips range-row child metadata (registers)", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.rows.push({
        rowId: "row-range" as never,
        order: 0,
        name: "R",
        comment: "",
        addressDraft: "1000-1001",
        addressValue: { value: 1000 } as never,
        registerCount: 2,
        dataType: "hex",
        pollingEnabled: false,
        traceEnabled: false,
        cellText: "12 34",
        registerValues: [{ value: 0x12 }, { value: 0x34 }] as never,
        registers: [
          { name: "Hi", comment: "high", dataType: "unsigned" },
          { name: "Lo", comment: "low", dataType: "hex" },
        ],
        bitComments: [["carry"], null],
        bitNames: [["carry flag"], null],
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = parsed.value.sheets[0]?.rows.at(-1);
    expect(row?.registerCount).toBe(2);
    expect(row?.registers).toEqual([
      { name: "Hi", comment: "high", dataType: "unsigned" },
      { name: "Lo", comment: "low", dataType: "hex" },
    ]);
    // 位级注释随工作区往返。
    expect(row?.bitComments).toEqual([["carry"], null]);
    // 位级名称随工作区往返。
    expect(row?.bitNames).toEqual([["carry flag"], null]);
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

  it("defaults sheet writeVerify to off for legacy data without the field", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    // 模拟老版本数据：sheet 无 writeVerify 字段。
    for (const sheet of legacy.sheets) {
      delete sheet.writeVerify;
    }
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.writeVerify).toEqual({
      mode: "off",
      delayMs: null,
    });
  });

  it("preserves per-sheet writeVerify across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.writeVerify = { mode: "delayed", delayMs: 200 };
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.writeVerify).toEqual({
      mode: "delayed",
      delayMs: 200,
    });
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

  it("defaults sheet open to true for legacy data without the field", () => {
    const legacy = JSON.parse(serializeWorkspace(createEmptyWorkspace()));
    // 模拟老版本数据：sheet 无 open 字段（关闭/打开状态引入）。
    for (const sheet of legacy.sheets) {
      delete sheet.open;
    }
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.open).toBe(true);
  });

  it("preserves per-sheet open across a round-trip", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.open = false;
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.open).toBe(false);
  });
});

describe("tcp connection profile persistence", () => {
  it("round-trips a TCP profile alongside the default RTU profile", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.connectionProfiles = [
        {
          id: "conn-tcp" as never,
          name: "PLC",
          protocol: "tcp",
          host: "192.168.1.10",
          port: 502,
          unitId: 0,
          connectTimeoutMs: 3000,
          requestTimeoutMs: 2000,
          retryCount: 3,
          autoReconnect: false,
        },
      ];
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const profile = parsed.value.connectionProfiles[0];
    expect(profile?.protocol).toBe("tcp");
    expect(profile).toMatchObject({
      name: "PLC",
      host: "192.168.1.10",
      port: 502,
      unitId: 0,
      connectTimeoutMs: 3000,
      requestTimeoutMs: 2000,
      retryCount: 3,
      autoReconnect: false,
    });
  });

  it("backfills TCP defaults for legacy data missing extended fields", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.connectionProfiles = [
        {
          id: "conn-tcp" as never,
          name: "TCP",
          protocol: "tcp",
          host: "127.0.0.1",
          port: 502,
          unitId: 0,
          connectTimeoutMs: 5000,
          requestTimeoutMs: 1000,
          retryCount: 1,
          autoReconnect: false,
        },
      ];
    });
    // 模拟早期写入数据：只保留核心字段。
    const legacy = JSON.parse(serializeWorkspace(workspace));
    const profile = legacy.connectionProfiles[0];
    delete profile.unitId;
    delete profile.autoReconnect;
    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.connectionProfiles[0]).toMatchObject({
      protocol: "tcp",
      unitId: 0,
      autoReconnect: false,
    });
  });
});

describe("public exchange format（工作区导入导出，2026-08-29）", () => {
  it("exports a versioned JSON that round-trips all workspace fields", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.name = "My Exchange Workspace";
      w.notes = "shared with a colleague";
      const sheet = w.sheets[0];
      if (sheet === undefined) return;
      sheet.name = "Pumps";
      sheet.registerRadix = "hex";
      sheet.slaveAddress = 7;
      sheet.writeVerify = { mode: "delayed", delayMs: 200 };
      sheet.columnWidths = { name: 160 };
      sheet.columnOrder = ["no", "name"];
      sheet.open = false;
      sheet.rows = [
        {
          rowId: "row-1" as never,
          order: 0,
          name: "Speed",
          comment: "RPM",
          addressDraft: "100",
          addressValue: { value: 100 } as never,
          registerCount: 1,
          dataType: "unsigned-0.1",
          pollingEnabled: true,
          traceEnabled: false,
          cellText: "123",
          registerValues: [{ value: 1230 }] as never,
          registers: null,
          bitComments: null,
          bitNames: null,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          rowId: "row-2" as never,
          order: 1,
          name: "Range",
          comment: "",
          addressDraft: "1000-1001",
          addressValue: { value: 1000 } as never,
          registerCount: 2,
          dataType: "hex",
          pollingEnabled: false,
          traceEnabled: true,
          cellText: "12 34",
          registerValues: [{ value: 0x12 }, { value: 0x34 }] as never,
          registers: [
            { name: "Hi", comment: "high", dataType: "unsigned" },
            { name: "Lo", comment: "low", dataType: "hex" },
          ],
          bitComments: [["carry"], null],
          bitNames: [["carry flag"], null],
          createdAt: 3,
          updatedAt: 4,
        },
      ];
      w.connectionProfiles = [
        {
          id: "conn-tcp" as never,
          name: "PLC",
          protocol: "tcp",
          host: "192.168.1.10",
          port: 502,
          unitId: 1,
          connectTimeoutMs: 3000,
          requestTimeoutMs: 2000,
          retryCount: 3,
          autoReconnect: false,
        },
      ];
    });

    const serialized = serializeWorkspace(workspace);
    // 导出文件为版本化 JSON（含 schemaVersion；TECH_DESIGN §6「版本化 JSON 更适合跨端导入导出」）。
    // 当前为 v10（行位级注释 bitComments（v9）+ 位级名称 bitNames（v10））。
    const raw = JSON.parse(serialized);
    expect(raw.schemaVersion).toBe(10);

    // 导入路径：parseWorkspace（含迁移与断链检测）后字段完整。
    const parsed = parseWorkspace(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const value = parsed.value;
    expect(value.name).toBe("My Exchange Workspace");
    expect(value.notes).toBe("shared with a colleague");
    const sheet = value.sheets[0];
    expect(sheet?.name).toBe("Pumps");
    expect(sheet?.registerRadix).toBe("hex");
    expect(sheet?.slaveAddress).toBe(7);
    expect(sheet?.writeVerify).toEqual({ mode: "delayed", delayMs: 200 });
    expect(sheet?.columnWidths).toEqual({ name: 160 });
    expect(sheet?.columnOrder).toEqual(["no", "name"]);
    expect(sheet?.open).toBe(false);
    const [single, range] = sheet?.rows ?? [];
    expect(single).toMatchObject({
      name: "Speed",
      addressDraft: "100",
      dataType: "unsigned-0.1",
      pollingEnabled: true,
      cellText: "123",
    });
    expect(single?.registerValues).toEqual([{ value: 1230 }]);
    expect(range).toMatchObject({
      registerCount: 2,
      dataType: "hex",
      traceEnabled: true,
      cellText: "12 34",
    });
    expect(range?.registers).toEqual([
      { name: "Hi", comment: "high", dataType: "unsigned" },
      { name: "Lo", comment: "low", dataType: "hex" },
    ]);
    // 位级注释/名称随公开交换格式往返。
    expect(range?.bitComments).toEqual([["carry"], null]);
    expect(range?.bitNames).toEqual([["carry flag"], null]);
    expect(value.connectionProfiles[0]).toMatchObject({
      protocol: "tcp",
      host: "192.168.1.10",
      unitId: 1,
    });
  });

  it("rejects a corrupted exchange file with structured error and no partial state", () => {
    const parsed = parseWorkspace(
      JSON.parse('{"schemaVersion":4,"name":42,"sheets":[]}'),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("WORKSPACE_SCHEMA_INVALID");
  });
});

describe("基础表类型与 bool dataType（ADR-043 E-2）", () => {
  it("round-trip 基础表类型（coil/discrete-input/input-register）", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.sheets[0]!.type = "coil";
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.type).toBe("coil");
  });

  it("round-trip bool dataType", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      const row = w.sheets[0]?.rows[0];
      if (row !== undefined) row.dataType = "bool";
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sheets[0]?.rows[0]?.dataType).toBe("bool");
  });

  it("合法插件表类型仍通过（<pluginId>:<tableTypeId>）", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.sheets[0]!.type = "yaskawa-memobus:holding-register";
    });
    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
  });

  it("非法表类型（裸字符串非核心类型）被拒绝", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.sheets[0]!.type = "not-a-valid-type";
    });
    // workspaceSchema 直接校验（serializeWorkspace 对非法数据会 throw ZodError）。
    const result = workspaceSchema.safeParse(workspace);
    expect(result.success).toBe(false);
  });
});

describe("panelLayout persistence", () => {
  it("round-trips a custom sidebarWidth", () => {
    const workspace = mutate(createEmptyWorkspace(), (w) => {
      w.panelLayout.sidebarWidth = 300;
    });

    const parsed = parseWorkspace(JSON.parse(serializeWorkspace(workspace)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.panelLayout.sidebarWidth).toBe(300);
  });

  it("backfills the default sidebarWidth for legacy data without the field", () => {
    const workspace = createEmptyWorkspace();
    const legacy = JSON.parse(serializeWorkspace(workspace)) as Record<
      string,
      unknown
    >;
    const panelLayout = legacy.panelLayout as Record<string, unknown>;
    delete panelLayout.sidebarWidth;

    const parsed = parseWorkspace(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.panelLayout.sidebarWidth).toBe(160);
  });
});
