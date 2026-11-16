import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";
import {
  basicTablesProtocolId,
  coreTableTypeMeta,
  createEmptyRow,
  createEmptyWorkspace,
  createRegisterSheet,
  createRegisterSubRowMeta,
  createRegisterSubRowMetas,
  DEFAULT_SIDEBAR_WIDTH,
  isCoreSheetType,
  sheetTypeWritable,
  type RegisterRow,
} from "./workspace-model";

describe("createRegisterSheet 默认行（新建表默认填充 defaultRowCount 行）", () => {
  it("新建表默认 type=holding-register（ADR-041）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.type).toBe("holding-register");
  });

  it("createRegisterSheet 支持插件表类型（ADR-041）", () => {
    const sheet = createRegisterSheet(
      "Yaskawa",
      0,
      "yaskawa-memobus-67h-010dh-010eh:holding-register",
    );
    expect(sheet.type).toBe("yaskawa-memobus-67h-010dh-010eh:holding-register");
  });

  it("新建表默认生成 defaultRowCount 个空行", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
  });

  it("默认行等价于 createEmptyRow()：关键字段为空、无默认地址/数值/名称", () => {
    const sheet = createRegisterSheet("S", 0);
    for (const row of sheet.rows) {
      const empty = createEmptyRow();
      expect(row.name).toBe("");
      expect(row.comment).toBe("");
      expect(row.addressDraft).toBe("");
      expect(row.addressValue).toBeNull();
      expect(row.cellText).toBe("");
      expect(row.registerValues).toBeNull();
      expect(row.registerCount).toBe(1);
      expect(row.pollingEnabled).toBe(false);
      expect(row.traceEnabled).toBe(false);
      expect(row.dataType).toBe(empty.dataType);
    }
  });

  it("order 从 1 连续编号到 defaultRowCount（与 renumberRows 惯例一致）", () => {
    const sheet = createRegisterSheet("S", 0);
    const orders = sheet.rows.map((r) => r.order);
    const expected = Array.from(
      { length: defaultConfig.registerTable.defaultRowCount },
      (_, i) => i + 1,
    );
    expect(orders).toEqual(expected);
  });

  it("rowId 全部唯一", () => {
    const sheet = createRegisterSheet("S", 0);
    const ids = sheet.rows.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("columnWidths 初始为空（未拖拽过任何列，随表持久化）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.columnWidths).toEqual({});
  });

  it("columnOrder 初始为 null（未拖拽过任何列，使用默认顺序）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.columnOrder).toBeNull();
  });

  it("新建表默认处于打开状态（open=true，可从页签栏直接展示）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.open).toBe(true);
  });
});

describe("createEmptyWorkspace 初始表", () => {
  it("首启默认 Sheet 1 同样为 defaultRowCount 行", () => {
    const workspace = createEmptyWorkspace();
    expect(workspace.sheets).toHaveLength(1);
    expect(workspace.sheets[0]?.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
  });

  it("初始表行同样满足空行与连续 order 约束", () => {
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const orders = sheet.rows.map((r) => r.order);
    const expected = Array.from(
      { length: defaultConfig.registerTable.defaultRowCount },
      (_, i) => i + 1,
    );
    expect(orders).toEqual(expected);
    for (const row of sheet.rows as RegisterRow[]) {
      expect(row.addressValue).toBeNull();
      expect(row.name).toBe("");
    }
  });

  it("默认展开态侧栏宽度与底部面板高度使用设计初始值", () => {
    const workspace = createEmptyWorkspace();
    expect(workspace.panelLayout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(workspace.panelLayout.bottomPanelHeight).toBe(200);
  });
});

describe("范围行子行元数据（2026-08-27）", () => {
  it("createEmptyRow 的 registers 为 null（单寄存器行）", () => {
    const row = createEmptyRow();
    expect(row.registerCount).toBe(1);
    expect(row.registers).toBeNull();
  });

  it("createRegisterSubRowMeta 生成默认空元数据（继承父行 dataType）", () => {
    const meta = createRegisterSubRowMeta("unsigned-0.1");
    expect(meta).toEqual({ name: "", comment: "", dataType: "unsigned-0.1" });
  });

  it("createRegisterSubRowMetas 按长度生成且每项独立", () => {
    const metas = createRegisterSubRowMetas(3, "hex");
    expect(metas).toHaveLength(3);
    expect(metas.every((m) => m.name === "" && m.comment === "")).toBe(true);
    expect(metas.every((m) => m.dataType === "hex")).toBe(true);
    // 独立引用：修改一项不影响其他项。
    metas[1] = {
      ...(metas[1] ?? { name: "", comment: "", dataType: "hex" }),
      name: "x",
    };
    expect(metas[0]?.name).toBe("");
    expect(metas[1]?.name).toBe("x");
  });
});

describe("核心表类型元数据（ADR-043 E-2）", () => {
  it("基础表协议 ID：modbus-basic-tables:<tableType>", () => {
    expect(basicTablesProtocolId("coil")).toBe("modbus-basic-tables:coil");
    expect(basicTablesProtocolId("discrete-input")).toBe(
      "modbus-basic-tables:discrete-input",
    );
    expect(basicTablesProtocolId("input-register")).toBe(
      "modbus-basic-tables:input-register",
    );
  });

  it("coil 可读写、默认 bool；discrete-input/input-register 只读", () => {
    expect(coreTableTypeMeta("coil")).toMatchObject({
      writable: true,
      defaultDataType: "bool",
      bitValue: true,
    });
    expect(coreTableTypeMeta("discrete-input")).toMatchObject({
      writable: false,
      bitValue: true,
    });
    expect(coreTableTypeMeta("input-register")).toMatchObject({
      writable: false,
      bitValue: false,
    });
    expect(sheetTypeWritable("coil")).toBe(true);
    expect(sheetTypeWritable("discrete-input")).toBe(false);
    expect(sheetTypeWritable("input-register")).toBe(false);
    expect(sheetTypeWritable("holding-register")).toBe(true);
  });

  it("isCoreSheetType 识别核心类型、排除插件类型", () => {
    expect(isCoreSheetType("holding-register")).toBe(true);
    expect(isCoreSheetType("coil")).toBe(true);
    expect(isCoreSheetType("yaskawa-memobus:holding-register")).toBe(false);
    expect(coreTableTypeMeta("yaskawa-memobus:holding-register")).toBeNull();
  });
});
