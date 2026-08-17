import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  defaultConfig,
  type RowId,
  type SheetId,
} from "@mamep2026/domain";
import { useAppStore } from "./app-store";

beforeEach(() => {
  useAppStore.setState({
    workspace: createEmptyWorkspace(),
    loaded: true,
    connectionState: "disconnected",
    activeSheetId: null,
    editingSheetId: null,
    pendingDeleteSheetId: null,
  });
});

function sheetNames(): string[] {
  return useAppStore.getState().workspace.sheets.map((s) => s.name);
}

function firstSheetId(): SheetId {
  const sheet = useAppStore.getState().workspace.sheets[0];
  if (sheet === undefined) throw new Error("missing sheet");
  return sheet.sheetId;
}

/** 清空所有表的行：默认表现在自带 defaultRowCount 行，行操作用例需在受控状态下验证。 */
function clearAllSheetRows(): void {
  useAppStore.setState((state) => ({
    workspace: {
      ...state.workspace,
      sheets: state.workspace.sheets.map((sheet) => ({
        ...sheet,
        rows: [],
      })),
      updatedAt: Date.now(),
    },
  }));
}

describe("moveSheetTo", () => {
  it("把表格移动到目标位置并重编号 order", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    useAppStore.getState().moveSheetTo(firstSheetId(), 2);
    expect(sheetNames()).toEqual(["Sheet 2", "Sheet 3", "Sheet 1"]);
    expect(useAppStore.getState().workspace.sheets.map((s) => s.order)).toEqual(
      [0, 1, 2],
    );
  });

  it("越界目标收敛到合法位置", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const sheets = useAppStore.getState().workspace.sheets;
    const last = sheets[sheets.length - 1];
    if (last === undefined) throw new Error("missing sheet");
    useAppStore.getState().moveSheetTo(last.sheetId, 99);
    expect(sheetNames()).toEqual(["Sheet 1", "Sheet 2"]);
    useAppStore.getState().moveSheetTo(last.sheetId, -3);
    expect(sheetNames()).toEqual(["Sheet 2", "Sheet 1"]);
  });

  it("无效 sheetId 不改变状态", () => {
    useAppStore.getState().moveSheetTo("missing" as SheetId, 0);
    expect(sheetNames()).toEqual(["Sheet 1"]);
  });
});

describe("duplicateSheet", () => {
  it("副本插入源表之后、命名带 Copy 并自动激活", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const sourceId = firstSheetId();
    useAppStore.getState().duplicateSheet(sourceId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.name)).toEqual([
      "Sheet 1",
      "Sheet 1 Copy",
      "Sheet 2",
    ]);
    expect(after.activeSheetId).toBe(after.workspace.sheets[1]?.sheetId);
    expect(after.workspace.activeSheetId).toBe(
      after.workspace.sheets[1]?.sheetId,
    );
  });

  it("副本行使用新 rowId 且关闭轮询/追踪", () => {
    const store = useAppStore.getState();
    clearAllSheetRows();
    const sourceId = firstSheetId();
    store.addRow(sourceId);
    const source = useAppStore.getState().workspace.sheets[0];
    if (source === undefined) throw new Error("missing source");
    useAppStore.getState().duplicateSheet(sourceId);
    const after = useAppStore.getState();
    const copy = after.workspace.sheets[1];
    if (copy === undefined) throw new Error("missing copy");
    expect(copy.rows).toHaveLength(1);
    expect(copy.rows[0]?.rowId).not.toBe(source.rows[0]?.rowId);
    expect(copy.rows[0]?.pollingEnabled).toBe(false);
    expect(copy.rows[0]?.traceEnabled).toBe(false);
  });
});

describe("addSheet 默认行", () => {
  it("新建表默认生成 defaultRowCount 个空行", () => {
    const store = useAppStore.getState();
    store.addSheet();
    const sheet = useAppStore.getState().workspace.sheets[1];
    if (sheet === undefined) throw new Error("missing sheet");
    expect(sheet.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
  });
});

describe("closeSheet", () => {
  it("删除最后一张表后自动新建空表", () => {
    const store = useAppStore.getState();
    store.closeSheet(firstSheetId());
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(1);
    expect(after.workspace.sheets[0]?.name).toBe("Sheet 1");
    expect(after.workspace.sheets[0]?.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
    expect(after.activeSheetId).toBe(after.workspace.sheets[0]?.sheetId);
  });
});

describe("closeOtherSheets", () => {
  it("关闭除目标外全部，目标成为活动表，order 连续", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    const sheets = useAppStore.getState().workspace.sheets;
    const target = sheets[1];
    if (target === undefined) throw new Error("missing target");
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeOtherSheets(target.sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.name)).toEqual(["Sheet 2"]);
    expect(after.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.sheets[0]?.order).toBe(0);
    expect(after.workspace.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("目标为唯一表时操作无副作用（updatedAt 不变）", () => {
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeOtherSheets(firstSheetId());
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(1);
    expect(after.workspace.sheets[0]?.name).toBe("Sheet 1");
    expect(after.activeSheetId).toBeNull();
    expect(after.workspace.updatedAt).toBe(before);
  });

  it("无效 sheetId 无副作用", () => {
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeOtherSheets("missing" as SheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(1);
    expect(after.workspace.updatedAt).toBe(before);
  });

  it("不影响被保留表的行数据", () => {
    const store = useAppStore.getState();
    clearAllSheetRows();
    const target = firstSheetId();
    store.addRow(target);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    store.addSheet(); // Sheet 2（将被关闭）
    useAppStore.getState().closeOtherSheets(target);
    const after = useAppStore.getState();
    const kept = after.workspace.sheets[0];
    if (kept === undefined) throw new Error("missing kept sheet");
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.rowId).toBe(row.rowId);
  });
});

describe("closeSheetsToRight", () => {
  it("仅关闭目标右侧的表，左侧与目标保留且目标激活", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    const sheets = useAppStore.getState().workspace.sheets;
    const target = sheets[1];
    if (target === undefined) throw new Error("missing target");
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeSheetsToRight(target.sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.name)).toEqual([
      "Sheet 1",
      "Sheet 2",
    ]);
    expect(after.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.sheets.map((s) => s.order)).toEqual([0, 1]);
    expect(after.workspace.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("目标为末位表时无副作用", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const sheets = useAppStore.getState().workspace.sheets;
    const last = sheets[sheets.length - 1];
    if (last === undefined) throw new Error("missing last");
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeSheetsToRight(last.sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.name)).toEqual([
      "Sheet 1",
      "Sheet 2",
    ]);
    expect(after.workspace.updatedAt).toBe(before);
  });

  it("目标为首位表时仅剩首位且激活", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    useAppStore.getState().closeSheetsToRight(first);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.name)).toEqual(["Sheet 1"]);
    expect(after.activeSheetId).toBe(first);
  });

  it("无效 sheetId 无副作用", () => {
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeSheetsToRight("missing" as SheetId);
    expect(useAppStore.getState().workspace.updatedAt).toBe(before);
  });

  it("不影响被保留表的行数据", () => {
    const store = useAppStore.getState();
    clearAllSheetRows();
    const target = firstSheetId();
    store.addRow(target);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    store.addSheet(); // Sheet 2（将被关闭）
    useAppStore.getState().closeSheetsToRight(target);
    const after = useAppStore.getState();
    const kept = after.workspace.sheets[0];
    if (kept === undefined) throw new Error("missing kept sheet");
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.rowId).toBe(row.rowId);
  });
});

describe("setSheetRegisterRadix", () => {
  it("只修改目标表的 registerRadix，不影响其他表", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second sheet");
    expect(useAppStore.getState().workspace.sheets[0]?.registerRadix).toBe(
      "dec",
    );
    useAppStore.getState().setSheetRegisterRadix(first, "hex");
    const after = useAppStore.getState().workspace.sheets;
    expect(after[0]?.registerRadix).toBe("hex");
    expect(after[1]?.registerRadix).toBe("dec");
    expect(after.find((s) => s.sheetId === second)?.registerRadix).toBe("dec");
  });
});

describe("commitRowAddress radix", () => {
  function rowInSheet(sheetId: SheetId) {
    const sheet = useAppStore
      .getState()
      .workspace.sheets.find((s) => s.sheetId === sheetId);
    if (sheet === undefined) throw new Error("missing sheet");
    return sheet.rows[0];
  }

  it("DEC 表把 '31' 解析为十进制 31，draft 保留 '31'", () => {
    const store = useAppStore.getState();
    const id = firstSheetId();
    store.addRow(id);
    const row = rowInSheet(id);
    if (row === undefined) throw new Error("missing row");
    const result = useAppStore.getState().commitRowAddress(row.rowId, "31");
    expect(result.ok).toBe(true);
    const updated = rowInSheet(id);
    expect(updated?.addressValue?.value).toBe(31);
    expect(updated?.addressDraft).toBe("31");
  });

  it("DEC 表拒绝十六进制字符（'1F' 报非法字符）", () => {
    const store = useAppStore.getState();
    const id = firstSheetId();
    store.addRow(id);
    const row = rowInSheet(id);
    if (row === undefined) throw new Error("missing row");
    const result = useAppStore.getState().commitRowAddress(row.rowId, "1F");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
  });

  it("HEX 表把 '1f' 解析为 0x1F 并归一化为 '001F'", () => {
    const store = useAppStore.getState();
    const id = firstSheetId();
    store.setSheetRegisterRadix(id, "hex");
    store.addRow(id);
    const row = rowInSheet(id);
    if (row === undefined) throw new Error("missing row");
    const result = useAppStore.getState().commitRowAddress(row.rowId, "1f");
    expect(result.ok).toBe(true);
    const updated = rowInSheet(id);
    expect(updated?.addressValue?.value).toBe(0x1f);
    expect(updated?.addressDraft).toBe("001F");
  });

  it("两表各自按自身 radix 解析，互不影响", () => {
    const store = useAppStore.getState();
    const decSheet = firstSheetId();
    store.addSheet(); // Sheet 2
    const hexSheet = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (hexSheet === undefined) throw new Error("missing second sheet");
    store.setSheetRegisterRadix(hexSheet, "hex");
    store.addRow(decSheet);
    store.addRow(hexSheet);
    const decRow = rowInSheet(decSheet);
    const hexRow = rowInSheet(hexSheet);
    if (decRow === undefined || hexRow === undefined)
      throw new Error("missing row");
    useAppStore.getState().commitRowAddress(decRow.rowId, "10");
    useAppStore.getState().commitRowAddress(hexRow.rowId, "10");
    const sheets = useAppStore.getState().workspace.sheets;
    const dec = sheets.find((s) => s.sheetId === decSheet);
    const hex = sheets.find((s) => s.sheetId === hexSheet);
    expect(dec?.rows[0]?.addressValue?.value).toBe(10);
    expect(dec?.rows[0]?.addressDraft).toBe("10");
    expect(hex?.rows[0]?.addressValue?.value).toBe(0x10);
    expect(hex?.rows[0]?.addressDraft).toBe("0010");
  });
});

describe("duplicateSheet radix inheritance", () => {
  it("副本继承源表的 registerRadix", () => {
    const store = useAppStore.getState();
    const sourceId = firstSheetId();
    store.setSheetRegisterRadix(sourceId, "hex");
    store.duplicateSheet(sourceId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.registerRadix).toBe("hex");
    expect(after.workspace.sheets[1]?.registerRadix).toBe("hex");
  });
});

describe("row selection actions", () => {
  it("setSelectedRowIds 保存多选集合，空数组清空选择", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addRow(sheetId);
    store.addRow(sheetId);
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 2) throw new Error("missing rows");
    const a = rows[0]?.rowId;
    const b = rows[1]?.rowId;
    if (a === undefined || b === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([a, b]);
    expect(useAppStore.getState().selectedRowIds).toEqual([a, b]);
    store.setSelectedRowIds([b]);
    expect(useAppStore.getState().selectedRowIds).toEqual([b]);
    store.setSelectedRowIds([]);
    expect(useAppStore.getState().selectedRowIds).toEqual([]);
  });
});

describe("row insert / batch actions", () => {
  beforeEach(() => {
    clearAllSheetRows();
  });

  it("insertRowAfter / insertRowBefore 插入空行并重编号", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addRow(sheetId); // R1
    store.addRow(sheetId); // R2
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 2) throw new Error("missing rows");
    const r1 = rows[0]?.rowId;
    if (r1 === undefined) throw new Error("missing rowId");
    store.insertRowAfter(sheetId, r1);
    expect(
      useAppStore.getState().workspace.sheets[0]?.rows.map((r) => r.order),
    ).toEqual([1, 2, 3]);
    store.insertRowBefore(sheetId, r1);
    expect(useAppStore.getState().workspace.sheets[0]?.rows[0]?.name).toBe("");
  });

  it("moveSelectedRows 批量上移并保持顺序", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    for (let i = 0; i < 3; i += 1) store.addRow(sheetId);
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 3) throw new Error("missing rows");
    const r1 = rows[0]?.rowId;
    const r2 = rows[1]?.rowId;
    if (r1 === undefined || r2 === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([r1, r2]);
    store.moveSelectedRows(sheetId, "up");
    // 选中块上移一位，表头无相邻非选中行时为 no-op
    expect(useAppStore.getState().workspace.sheets[0]?.rows).toHaveLength(3);
    store.moveSelectedRows(sheetId, "down");
    expect(
      useAppStore.getState().workspace.sheets[0]?.rows.map((r) => r.order),
    ).toEqual([1, 2, 3]);
  });

  it("deleteSelectedRows 删除多行、清空选中并重编号", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    for (let i = 0; i < 3; i += 1) store.addRow(sheetId);
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 3) throw new Error("missing rows");
    const r1 = rows[0]?.rowId;
    const r3 = rows[2]?.rowId;
    if (r1 === undefined || r3 === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([r1, r3]);
    store.deleteSelectedRows(sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.rows).toHaveLength(1);
    expect(after.workspace.sheets[0]?.rows[0]?.order).toBe(1);
    expect(after.selectedRowIds).toEqual([]);
  });

  it("copySelectedRows 填充应用内剪贴板但不修改原表", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addRow(sheetId);
    store.addRow(sheetId);
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 2) throw new Error("missing rows");
    const r1 = rows[0]?.rowId;
    if (r1 === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([r1]);
    store.copySelectedRows(sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.rows).toHaveLength(2);
    expect(after.clipboardPayload).toHaveLength(1);
  });

  it("cutSelectedRows 移除行并写入应用内剪贴板", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addRow(sheetId);
    store.addRow(sheetId);
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 2) throw new Error("missing rows");
    const r1 = rows[0]?.rowId;
    if (r1 === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([r1]);
    store.cutSelectedRows(sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.rows).toHaveLength(1);
    expect(after.clipboardPayload).toHaveLength(1);
    expect(after.selectedRowIds).toEqual([]);
  });

  it("pasteRows 从应用内剪贴板在目标行后插入（无 host 时）", async () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addRow(sheetId); // 空行
    store.addRow(sheetId); // 空行
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    if (rows === undefined || rows.length < 2) throw new Error("missing rows");
    const r1 = rows[0]?.rowId;
    if (r1 === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([r1]);
    store.copySelectedRows(sheetId); // 复制空行到应用内剪贴板
    await store.pasteRows(sheetId, r1);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.rows).toHaveLength(3);
    expect(after.workspace.sheets[0]?.rows.map((r) => r.order)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("updateRow 引用稳定性（性能：单行更新不重建其余表/行）", () => {
  beforeEach(() => {
    clearAllSheetRows();
  });

  it("只重建目标行所在 sheet 与目标行对象，其余 sheet/rows 引用保持不变", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addSheet(); // Sheet 2（默认行）
    store.addRow(sheetId); // Sheet1 R1
    store.addRow(sheetId); // Sheet1 R2
    const before = useAppStore.getState();
    const sheet1 = before.workspace.sheets[0];
    const sheet2 = before.workspace.sheets[1];
    if (sheet1 === undefined || sheet2 === undefined)
      throw new Error("missing sheets");
    const row1 = sheet1.rows[0];
    const row2 = sheet1.rows[1];
    if (row1 === undefined || row2 === undefined) throw new Error("missing rows");

    useAppStore.getState().updateRow(row1.rowId, (r) => ({
      ...r,
      name: "updated",
      updatedAt: Date.now(),
    }));

    const after = useAppStore.getState();
    // 未修改的表：sheet 对象与 rows 数组引用不变
    expect(after.workspace.sheets[1]).toBe(sheet2);
    // 目标行所在 sheet 是新对象，但未修改行引用不变
    expect(after.workspace.sheets[0]).not.toBe(sheet1);
    expect(after.workspace.sheets[0]?.rows[1]).toBe(row2);
    // 仅目标行对象变化且内容已更新
    expect(after.workspace.sheets[0]?.rows[0]).not.toBe(row1);
    expect(after.workspace.sheets[0]?.rows[0]?.name).toBe("updated");
    // updatedAt 推进（持久化语义不变）
    expect(after.workspace.updatedAt).toBeGreaterThanOrEqual(
      before.workspace.updatedAt,
    );
    expect(after.workspace.sheets[0]?.updatedAt).toBeGreaterThanOrEqual(
      sheet1.updatedAt,
    );
  });

  it("找不到目标行时不产生任何状态变更", () => {
    const before = useAppStore.getState();
    useAppStore.getState().updateRow("missing" as RowId, (r) => r);
    expect(useAppStore.getState().workspace).toBe(before.workspace);
  });

  it("updater 返回原行引用时不产生任何状态变更（轮询值未变短路，性能优化）", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addRow(sheetId); // 默认表 R1
    const before = useAppStore.getState();
    const sheet = before.workspace.sheets[0];
    const row = sheet?.rows[0];
    if (sheet === undefined || row === undefined) throw new Error("missing row");
    // updater 返回同一引用：整条链（rows/sheet/workspace 重建、自动保存、轮询目标重建）短路。
    useAppStore.getState().updateRow(row.rowId, (r) => r);
    expect(useAppStore.getState().workspace).toBe(before.workspace);
    // 正常更新仍生效（回归保护）。
    useAppStore.getState().updateRow(row.rowId, (r) => ({
      ...r,
      name: "updated",
      updatedAt: Date.now(),
    }));
    expect(useAppStore.getState().workspace).not.toBe(before.workspace);
    expect(useAppStore.getState().workspace.sheets[0]?.rows[0]?.name).toBe(
      "updated",
    );
  });
});

describe("setLanguage", () => {
  it("更新 workspace.preferences.language 以随自动保存持久化", () => {
    expect(
      useAppStore.getState().workspace.preferences.language,
    ).toBe("en-US");
    useAppStore.getState().setLanguage("zh-CN");
    expect(useAppStore.getState().workspace.preferences.language).toBe(
      "zh-CN",
    );
    useAppStore.getState().setLanguage("en-US");
    expect(useAppStore.getState().workspace.preferences.language).toBe(
      "en-US",
    );
  });
});

describe("setConnectionSettings", () => {
  it("更新活动 profile 的全部持久化设置（端口参数 + 非端口参数），id 保持不变", () => {
    const before = useAppStore.getState().workspace.connectionProfiles[0];
    if (before === undefined) throw new Error("missing profile");

    useAppStore.getState().setConnectionSettings({
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      slaveAddress: 6,
      requestTimeoutMs: 1800,
      retryCount: 4,
      interRequestDelayMs: 90,
      addressAdjust: "on",
    });

    const profile = useAppStore.getState().workspace.connectionProfiles[0];
    // 端口参数被更新。
    expect(profile?.baudRate).toBe(115200);
    expect(profile?.dataBits).toBe(7);
    expect(profile?.stopBits).toBe(2);
    expect(profile?.parity).toBe("even");
    expect(profile?.flowControl).toBe("rts-cts");
    // 非端口参数被更新。
    expect(profile?.slaveAddress).toBe(6);
    expect(profile?.requestTimeoutMs).toBe(1800);
    expect(profile?.retryCount).toBe(4);
    expect(profile?.interRequestDelayMs).toBe(90);
    expect(profile?.addressAdjust).toBe("on");
    // id 保持不变。
    expect(profile?.id).toBe(before.id);
  });

  it("越界等非法值被拒绝，不写入工作区", () => {
    useAppStore.getState().setConnectionSettings({
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      slaveAddress: 999,
      requestTimeoutMs: 1800,
      retryCount: 4,
      interRequestDelayMs: 90,
      addressAdjust: "on",
    });
    expect(
      useAppStore.getState().workspace.connectionProfiles[0]?.slaveAddress,
    ).toBe(1);
  });
});
