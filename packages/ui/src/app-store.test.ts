import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  createMamepError,
  defaultConfig,
  fail,
  ok,
  type RowId,
  type SheetId,
} from "@mamep2026/domain";
import { useAppStore } from "./app-store";
import { initI18n } from "./i18n";

beforeEach(() => {
  useAppStore.setState({
    workspace: createEmptyWorkspace(),
    loaded: true,
    connectionState: "disconnected",
    activeSheetId: null,
    pendingDeleteSheetId: null,
    workspaceImportDraft: null,
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
  it("关闭一张表：保留在工作区、open=false、数据不丢", () => {
    const store = useAppStore.getState();
    clearAllSheetRows();
    const target = firstSheetId();
    store.addRow(target);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    useAppStore.getState().closeSheet(target);
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(1);
    expect(after.workspace.sheets[0]?.open).toBe(false);
    expect(after.workspace.sheets[0]?.rows[0]?.rowId).toBe(row.rowId);
  });

  it("关闭当前活动表后激活下一个仍打开的表", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    const first = firstSheetId();
    // 先把活动表切到 first，再关闭它。
    useAppStore.getState().setActiveSheetId(first);
    useAppStore.getState().closeSheet(first);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.open).toBe(false);
    expect(after.activeSheetId).toBe(after.workspace.sheets[1]?.sheetId);
    expect(after.workspace.activeSheetId).toBe(
      after.workspace.sheets[1]?.sheetId,
    );
  });

  it("关闭所有表后活动表置空，表仍全部保留", () => {
    const store = useAppStore.getState();
    const first = firstSheetId();
    store.addSheet(); // Sheet 2
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second");
    useAppStore.getState().closeSheet(first);
    useAppStore.getState().closeSheet(second);
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(2);
    expect(after.workspace.sheets.every((s) => s.open === false)).toBe(true);
    expect(after.activeSheetId).toBeNull();
    expect(after.workspace.activeSheetId).toBeNull();
  });

  it("已关闭的表再次关闭无副作用（updatedAt 不变）", () => {
    const first = firstSheetId();
    useAppStore.getState().closeSheet(first);
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeSheet(first);
    expect(useAppStore.getState().workspace.updatedAt).toBe(before);
  });
});

describe("openSheet", () => {
  it("重新打开已关闭的表并设为活动表", () => {
    const first = firstSheetId();
    useAppStore.getState().closeSheet(first);
    expect(useAppStore.getState().workspace.sheets[0]?.open).toBe(false);
    useAppStore.getState().openSheet(first);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.open).toBe(true);
    expect(after.activeSheetId).toBe(first);
    expect(after.workspace.activeSheetId).toBe(first);
  });

  it("已打开的表仅切换为活动表", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    useAppStore.getState().openSheet(first);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.every((s) => s.open === true)).toBe(true);
    expect(after.activeSheetId).toBe(first);
  });

  it("无效 sheetId 无副作用", () => {
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().openSheet("missing" as SheetId);
    expect(useAppStore.getState().workspace.updatedAt).toBe(before);
  });
});

describe("deleteSheet", () => {
  it("真正删除表：从工作区移除并激活剩余表", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    useAppStore.getState().deleteSheet(first);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.name)).toEqual(["Sheet 2"]);
    expect(after.activeSheetId).toBe(after.workspace.sheets[0]?.sheetId);
  });

  it("删除唯一表后重建默认空表", () => {
    const store = useAppStore.getState();
    store.deleteSheet(firstSheetId());
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(1);
    expect(after.workspace.sheets[0]?.name).toBe("Sheet 1");
    expect(after.workspace.sheets[0]?.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
    expect(after.workspace.sheets[0]?.open).toBe(true);
    expect(after.activeSheetId).toBe(after.workspace.sheets[0]?.sheetId);
  });
});

describe("closeOtherSheets", () => {
  it("非破坏性关闭除目标外全部：其他表 open=false、目标保留并激活，order 不变", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    const sheets = useAppStore.getState().workspace.sheets;
    const target = sheets[1];
    if (target === undefined) throw new Error("missing target");
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeOtherSheets(target.sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(3);
    expect(after.workspace.sheets.map((s) => s.open)).toEqual([
      false,
      true,
      false,
    ]);
    expect(after.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.sheets.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(after.workspace.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("目标为唯一表时操作无副作用（updatedAt 不变）", () => {
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeOtherSheets(firstSheetId());
    const after = useAppStore.getState();
    expect(after.workspace.sheets).toHaveLength(1);
    expect(after.workspace.sheets[0]?.name).toBe("Sheet 1");
    expect(after.workspace.sheets[0]?.open).toBe(true);
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

  it("不影响被关闭表的数据（仍保留在工作区）", () => {
    const store = useAppStore.getState();
    clearAllSheetRows();
    const target = firstSheetId();
    store.addRow(target);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    store.addSheet(); // Sheet 2（将被关闭，自带默认行）
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second");
    // 清空新表默认行后添加一行，便于验证数据保留。
    useAppStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === second ? { ...sheet, rows: [] } : sheet,
        ),
      },
    }));
    store.addRow(second);
    useAppStore.getState().closeOtherSheets(target);
    const after = useAppStore.getState();
    const kept = after.workspace.sheets[0];
    if (kept === undefined) throw new Error("missing kept sheet");
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.rowId).toBe(row.rowId);
    // 被关闭的表仍在工作区且数据保留。
    expect(after.workspace.sheets[1]?.open).toBe(false);
    expect(after.workspace.sheets[1]?.rows).toHaveLength(1);
  });
});

describe("closeSheetsToRight", () => {
  it("非破坏性关闭目标右侧的表，左侧与目标保留且目标激活", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    const sheets = useAppStore.getState().workspace.sheets;
    const target = sheets[1];
    if (target === undefined) throw new Error("missing target");
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeSheetsToRight(target.sheetId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.open)).toEqual([
      true,
      true,
      false,
    ]);
    expect(after.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.activeSheetId).toBe(target.sheetId);
    expect(after.workspace.sheets.map((s) => s.order)).toEqual([0, 1, 2]);
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

  it("目标为首位表时右侧全部关闭且目标激活", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    useAppStore.getState().closeSheetsToRight(first);
    const after = useAppStore.getState();
    expect(after.workspace.sheets.map((s) => s.open)).toEqual([true, false]);
    expect(after.activeSheetId).toBe(first);
  });

  it("无效 sheetId 无副作用", () => {
    const before = useAppStore.getState().workspace.updatedAt;
    useAppStore.getState().closeSheetsToRight("missing" as SheetId);
    expect(useAppStore.getState().workspace.updatedAt).toBe(before);
  });

  it("不影响被关闭表的数据（仍保留在工作区）", () => {
    const store = useAppStore.getState();
    clearAllSheetRows();
    const target = firstSheetId();
    store.addRow(target);
    const row = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (row === undefined) throw new Error("missing row");
    store.addSheet(); // Sheet 2（将被关闭，自带默认行）
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second");
    // 清空新表默认行后添加一行，便于验证数据保留。
    useAppStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === second ? { ...sheet, rows: [] } : sheet,
        ),
      },
    }));
    store.addRow(second);
    useAppStore.getState().closeSheetsToRight(target);
    const after = useAppStore.getState();
    const kept = after.workspace.sheets[0];
    if (kept === undefined) throw new Error("missing kept sheet");
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0]?.rowId).toBe(row.rowId);
    expect(after.workspace.sheets[1]?.open).toBe(false);
    expect(after.workspace.sheets[1]?.rows).toHaveLength(1);
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

describe("setSheetWriteVerify（2026-08-26）", () => {
  it("默认 immediate（ON，写入后立即回读）；setSheetWriteVerify 只改目标表", () => {
    const first = firstSheetId();
    expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
      mode: "immediate",
      delayMs: null,
    });
    useAppStore.getState().addSheet(); // Sheet 2
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second sheet");

    useAppStore.getState().setSheetWriteVerify(first, {
      mode: "delayed",
      delayMs: 200,
    });
    const after = useAppStore.getState().workspace.sheets;
    expect(after.find((s) => s.sheetId === first)?.writeVerify).toEqual({
      mode: "delayed",
      delayMs: 200,
    });
    expect(after.find((s) => s.sheetId === second)?.writeVerify).toEqual({
      mode: "immediate",
      delayMs: null,
    });
  });

  it("setSheetWriteVerify 到 OFF 持久化到工作区", () => {
    const first = firstSheetId();
    useAppStore.getState().setSheetWriteVerify(first, {
      mode: "off",
      delayMs: null,
    });
    expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
      mode: "off",
      delayMs: null,
    });
  });
});

describe("setSheetAddressTransform（ADR-042）/ setThemePrimary（2026-09-02，ADR-047）", () => {
  it("默认 null；setSheetAddressTransform 只改目标表并持久化", () => {
    const first = firstSheetId();
    expect(
      useAppStore.getState().workspace.sheets[0]?.addressTransform,
    ).toBeNull();
    useAppStore.getState().addSheet(); // Sheet 2
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second sheet");

    useAppStore.getState().setSheetAddressTransform(first, {
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    const after = useAppStore.getState().workspace.sheets;
    expect(after.find((s) => s.sheetId === first)?.addressTransform).toEqual({
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    expect(after.find((s) => s.sheetId === second)?.addressTransform).toBeNull();
  });

  it("setSheetAddressTransform(null) 关闭表级调整", () => {
    const first = firstSheetId();
    useAppStore.getState().setSheetAddressTransform(first, {
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    useAppStore.getState().setSheetAddressTransform(first, null);
    expect(useAppStore.getState().workspace.sheets[0]?.addressTransform).toBeNull();
  });

  it("setThemePrimary 持久化到 workspace.preferences.themePrimary（预设 ID）；null 重置", () => {
    useAppStore.getState().setThemePrimary("example-theme:indigo");
    expect(useAppStore.getState().themePrimary).toBe("example-theme:indigo");
    expect(useAppStore.getState().workspace.preferences.themePrimary).toBe(
      "example-theme:indigo",
    );
    useAppStore.getState().setThemePrimary(null);
    expect(useAppStore.getState().themePrimary).toBeNull();
    expect(useAppStore.getState().workspace.preferences.themePrimary).toBeNull();
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

describe("commitChildCellText / setChildMeta（范围行子行可编辑化，2026-08-27）", () => {
  function rangeRowId(): RowId {
    const store = useAppStore.getState();
    const id = firstSheetId();
    store.addRow(id);
    const sheet = useAppStore
      .getState()
      .workspace.sheets.find((s) => s.sheetId === id);
    const row = sheet?.rows[0];
    if (row === undefined) throw new Error("missing row");
    store.commitRowAddress(row.rowId, "1000-1001");
    return row.rowId;
  }

  function rowOf(rowId: RowId) {
    return useAppStore
      .getState()
      .workspace.sheets.flatMap((s) => s.rows)
      .find((r) => r.rowId === rowId);
  }

  it("commitChildCellText 回写父行 registerValues[i] 并重算组合文本", () => {
    const rowId = rangeRowId();
    const result = useAppStore.getState().commitChildCellText(rowId, 0, "12");
    expect(result.ok).toBe(true);
    const row = rowOf(rowId);
    expect(row?.registerValues?.map((v) => v.value)).toEqual([0x12, 0]);
    expect(row?.cellText).toBe("0012 0000");
    expect(row?.registers).toHaveLength(2);
  });

  it("commitChildCellText 按子行自身 dataType 解析（Type 列独立生效）", () => {
    const rowId = rangeRowId();
    useAppStore.getState().setChildMeta(rowId, 0, { dataType: "unsigned" });
    const result = useAppStore.getState().commitChildCellText(rowId, 0, "300");
    expect(result.ok).toBe(true);
    const row = rowOf(rowId);
    expect(row?.registerValues?.[0]?.value).toBe(300);
    // 父行组合文本仍按父行 dataType（hex）格式化。
    expect(row?.cellText).toBe("012C 0000");
  });

  it("commitChildCellText 非法值失败且不改父行", () => {
    const rowId = rangeRowId();
    const before = rowOf(rowId);
    const result = useAppStore.getState().commitChildCellText(rowId, 0, "zz");
    expect(result.ok).toBe(false);
    const after = rowOf(rowId);
    expect(after?.registerValues).toEqual(before?.registerValues);
  });

  it("setChildMeta 更新子行元数据且不碰值", () => {
    const rowId = rangeRowId();
    useAppStore.getState().setChildMeta(rowId, 1, {
      name: "Lo",
      comment: "low",
      dataType: "signed",
    });
    const row = rowOf(rowId);
    expect(row?.registers?.[1]).toEqual({
      name: "Lo",
      comment: "low",
      dataType: "signed",
    });
    expect(row?.registers?.[0]).toEqual({
      name: "",
      comment: "",
      dataType: "hex",
    });
  });
});

describe("setSheetColumnWidths", () => {
  it("只修改目标表的 columnWidths，不影响其他表（每表独立不共享）", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second sheet");
    useAppStore.getState().setSheetColumnWidths(first, { name: 210 });
    const after = useAppStore.getState().workspace.sheets;
    expect(after[0]?.columnWidths).toEqual({ name: 210 });
    expect(after[1]?.columnWidths).toEqual({});
    expect(after.find((s) => s.sheetId === second)?.columnWidths).toEqual({});
  });

  it("可重置为 {}（回到默认列宽，仅影响本表）", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second sheet");
    useAppStore.getState().setSheetColumnWidths(first, {
      name: 210,
      data: 300,
    });
    useAppStore.getState().setSheetColumnWidths(first, {});
    const after = useAppStore.getState().workspace.sheets;
    expect(after[0]?.columnWidths).toEqual({});
    expect(after.find((s) => s.sheetId === second)?.columnWidths).toEqual({});
  });
});

describe("setSheetColumnOrder", () => {
  it("只修改目标表的 columnOrder，不影响其他表（每表独立不共享）", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    const first = firstSheetId();
    const second = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (second === undefined) throw new Error("missing second sheet");
    useAppStore.getState().setSheetColumnOrder(first, ["data", "name"]);
    const after = useAppStore.getState().workspace.sheets;
    expect(after[0]?.columnOrder).toEqual(["data", "name"]);
    expect(after[1]?.columnOrder).toBeNull();
    expect(after.find((s) => s.sheetId === second)?.columnOrder).toBeNull();
  });

  it("可重置为 null（回到默认顺序）", () => {
    const store = useAppStore.getState();
    const first = firstSheetId();
    store.setSheetColumnOrder(first, ["data", "name"]);
    store.setSheetColumnOrder(first, null);
    expect(useAppStore.getState().workspace.sheets[0]?.columnOrder).toBeNull();
  });
});

describe("duplicateSheet radix inheritance", () => {
  it("副本继承源表的 registerRadix 与 columnWidths", () => {
    const store = useAppStore.getState();
    const sourceId = firstSheetId();
    store.setSheetRegisterRadix(sourceId, "hex");
    store.setSheetColumnWidths(sourceId, { name: 210 });
    store.duplicateSheet(sourceId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.registerRadix).toBe("hex");
    expect(after.workspace.sheets[1]?.registerRadix).toBe("hex");
    expect(after.workspace.sheets[0]?.columnWidths).toEqual({ name: 210 });
    expect(after.workspace.sheets[1]?.columnWidths).toEqual({ name: 210 });
  });

  it("副本继承源表的 columnOrder", () => {
    const store = useAppStore.getState();
    const sourceId = firstSheetId();
    store.setSheetColumnOrder(sourceId, ["data", "name", "no"]);
    store.duplicateSheet(sourceId);
    const after = useAppStore.getState();
    expect(after.workspace.sheets[0]?.columnOrder).toEqual([
      "data",
      "name",
      "no",
    ]);
    expect(after.workspace.sheets[1]?.columnOrder).toEqual([
      "data",
      "name",
      "no",
    ]);
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

  it("不同类型表之间复制粘贴被拒（ADR-041 决策⑥）", async () => {
    const store = useAppStore.getState();
    const coreSheetId = firstSheetId();
    store.addRow(coreSheetId); // 空行
    const rows = useAppStore.getState().workspace.sheets[0]?.rows;
    const r1 = rows?.[0]?.rowId;
    if (r1 === undefined) throw new Error("missing rowId");
    store.setSelectedRowIds([r1]);
    store.copySelectedRows(coreSheetId); // 复制到应用内剪贴板（来源=核心表）
    // 新建安川类型表并尝试粘贴：应被拒（目标表类型 != 来源表类型）。
    store.addSheet("yaskawa-memobus-67h-010dh-010eh:holding-register");
    const yaskawaSheetId = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (yaskawaSheetId === undefined) throw new Error("missing yaskawa sheet");
    const yaskawaBeforeRows =
      useAppStore.getState().workspace.sheets[1]?.rows.length ?? 0;
    await store.pasteRows(yaskawaSheetId, null);
    const after = useAppStore.getState();
    // 新表自带默认行：粘贴被拒后行数不变。
    expect(after.workspace.sheets[1]?.rows).toHaveLength(yaskawaBeforeRows);
    expect(after.messages.at(-1)?.messageKey).toBe(
      "messages.clipboardTypeMismatch",
    );
    // 同类型表（核心→核心）不受影响：粘贴 1 行 → 默认行 +1。
    store.addSheet();
    const core2 = useAppStore.getState().workspace.sheets[2]?.sheetId;
    if (core2 === undefined) throw new Error("missing core2 sheet");
    const core2BeforeRows =
      useAppStore.getState().workspace.sheets[2]?.rows.length ?? 0;
    await store.pasteRows(core2, null);
    expect(useAppStore.getState().workspace.sheets[2]?.rows).toHaveLength(
      core2BeforeRows + 1,
    );
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
    if (row1 === undefined || row2 === undefined)
      throw new Error("missing rows");

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
    if (sheet === undefined || row === undefined)
      throw new Error("missing row");
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
    expect(useAppStore.getState().workspace.preferences.language).toBe("en-US");
    useAppStore.getState().setLanguage("zh-CN");
    expect(useAppStore.getState().workspace.preferences.language).toBe("zh-CN");
    useAppStore.getState().setLanguage("en-US");
    expect(useAppStore.getState().workspace.preferences.language).toBe("en-US");
  });
});

describe("setConnectionSettings", () => {
  it("更新活动 profile 的全部持久化设置（端口参数 + 非端口参数），id 保持不变", () => {
    const before = useAppStore.getState().workspace.connectionProfiles[0];
    if (before === undefined) throw new Error("missing profile");

    useAppStore.getState().setConnectionSettings({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      requestTimeoutMs: 80,
      retryCount: 4,
    });

    const stored = useAppStore.getState().workspace.connectionProfiles[0];
    const profile = stored !== undefined && stored.protocol === "rtu" ? stored : undefined;
    // 端口参数被更新。
    expect(profile?.baudRate).toBe(115200);
    expect(profile?.dataBits).toBe(7);
    expect(profile?.stopBits).toBe(2);
    expect(profile?.parity).toBe("even");
    expect(profile?.flowControl).toBe("rts-cts");
    // 非端口参数被更新。
    expect(profile?.requestTimeoutMs).toBe(80);
    expect(profile?.retryCount).toBe(4);
    // id 保持不变。
    expect(profile?.id).toBe(before.id);
  });

  it("越界等非法值被拒绝，不写入工作区", () => {
    useAppStore.getState().setConnectionSettings({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      requestTimeoutMs: 999999,
      retryCount: 4,
    });
    // 越界 requestTimeoutMs（>100，收窄后）使持久化 schema 校验失败，整个写入被拒绝。
    const stored = useAppStore.getState().workspace.connectionProfiles[0];
    expect(
      stored !== undefined && stored.protocol === "rtu"
        ? stored.requestTimeoutMs
        : undefined,
    ).toBe(50);
  });
});

describe("setSheetSlaveAddress", () => {
  it("sets the sheet-level slave address independently per sheet", () => {
    const firstId = useAppStore.getState().workspace.sheets[0]?.sheetId;
    if (firstId === undefined) throw new Error("missing first sheet");
    expect(useAppStore.getState().workspace.sheets[0]?.slaveAddress).toBe(1);

    useAppStore.getState().setSheetSlaveAddress(firstId, 7);
    expect(useAppStore.getState().workspace.sheets[0]?.slaveAddress).toBe(7);

    // 新建表默认 1，且每表独立互不影响。
    useAppStore.getState().addSheet();
    const secondId = useAppStore.getState().workspace.sheets[1]?.sheetId;
    if (secondId === undefined) throw new Error("missing second sheet");
    expect(useAppStore.getState().workspace.sheets[1]?.slaveAddress).toBe(1);
    useAppStore.getState().setSheetSlaveAddress(secondId, 9);
    expect(useAppStore.getState().workspace.sheets[0]?.slaveAddress).toBe(7);
    expect(useAppStore.getState().workspace.sheets[1]?.slaveAddress).toBe(9);
  });
});

describe("row 状态点 actions", () => {
  function timeoutResult() {
    return fail(
      createMamepError({
        code: "REQUEST_TIMEOUT",
        category: "timeout",
        userMessageKey: "errors.requestTimeout",
        technicalMessage: "timeout",
      }),
    );
  }

  it("recordManualResult：读取失败写失败态(detail=code)并清成功点", () => {
    const store = useAppStore.getState();
    store.recordManualResult("r1" as RowId, ok(1), "read");
    expect(useAppStore.getState().rowSuccess["r1" as RowId]).toEqual({
      kind: "read",
    });
    store.recordManualResult("r1" as RowId, timeoutResult(), "read");
    const state = useAppStore.getState();
    expect(state.rowResults["r1" as RowId]).toEqual({
      messageKey: "errors.requestTimeout",
      detail: "REQUEST_TIMEOUT",
    });
    expect(state.rowSuccess["r1" as RowId]).toBeUndefined();
  });

  it("recordManualResult：写入成功(no-verify)写成功点(kind=write)", () => {
    const store = useAppStore.getState();
    store.recordManualResult(
      "r1" as RowId,
      ok({ kind: "write-succeeded-no-verify" }),
      "write",
      { writeOutcome: { kind: "write-succeeded-no-verify" } },
    );
    expect(useAppStore.getState().rowSuccess["r1" as RowId]).toEqual({
      kind: "write",
    });
  });

  it("recordPollResult：轮询失败写失败态(detail=null)，幂等不触发状态更新", () => {
    const store = useAppStore.getState();
    store.recordPollResult("r1" as RowId, timeoutResult());
    expect(useAppStore.getState().rowResults["r1" as RowId]).toEqual({
      messageKey: "errors.requestTimeout",
      detail: null,
    });
    // 同因子失败再次写入：rowResults 引用不变（zustand 零更新）。
    const before = useAppStore.getState().rowResults;
    store.recordPollResult("r1" as RowId, timeoutResult());
    expect(useAppStore.getState().rowResults).toBe(before);
  });

  it("recordPollResult：轮询成功清除失败态与编辑完成态", () => {
    const store = useAppStore.getState();
    store.recordPollResult("r1" as RowId, timeoutResult());
    store.recordRowEdit("r1" as RowId, "100", "200");
    store.recordPollResult("r1" as RowId, ok(42));
    const state = useAppStore.getState();
    expect(state.rowResults["r1" as RowId]).toBeUndefined();
    expect(state.rowDirty["r1" as RowId]).toBeUndefined();
  });

  it("recordRowEdit：值变化置编辑完成态并覆盖成功点", () => {
    const store = useAppStore.getState();
    store.recordManualResult("r1" as RowId, ok(1), "read");
    store.recordRowEdit("r1" as RowId, "100", "200");
    const state = useAppStore.getState();
    expect(state.rowDirty["r1" as RowId]).toBe(true);
    expect(state.rowSuccess["r1" as RowId]).toBeUndefined();
  });

  it("recordRowEdit：编辑回原值清除编辑完成态", () => {
    const store = useAppStore.getState();
    store.recordRowEdit("r1" as RowId, "100", "200");
    store.recordRowEdit("r1" as RowId, "200", "200");
    expect(useAppStore.getState().rowDirty["r1" as RowId]).toBeUndefined();
  });
});

describe("commitCellText（Data 单元格提交校验）", () => {
  function resetRowStatus(): void {
    useAppStore.setState({
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
    });
  }

  function addFirstRow() {
    const id = firstSheetId();
    useAppStore.getState().addRow(id);
    const sheet = useAppStore
      .getState()
      .workspace.sheets.find((s) => s.sheetId === id);
    const row = sheet?.rows[0];
    if (row === undefined) throw new Error("missing row");
    // createEmptyRow 默认 dataType=hex；校验断言用 unsigned 的 DATA_INVALID_NUMBER。
    useAppStore
      .getState()
      .updateRow(row.rowId, (r) => ({ ...r, dataType: "unsigned" }));
    const updated = useAppStore.getState().workspace.sheets[0]?.rows[0];
    if (updated === undefined) throw new Error("missing updated row");
    return updated;
  }

  it("提交合法值：写 cellText、置编辑完成态、返回 ok", () => {
    resetRowStatus();
    const row = addFirstRow();
    const result = useAppStore.getState().commitCellText(row.rowId, "42");
    expect(result.ok).toBe(true);
    const updated = useAppStore.getState().workspace.sheets[0]?.rows[0];
    expect(updated?.cellText).toBe("42");
    expect(useAppStore.getState().rowDirty[row.rowId]).toBe(true);
    expect(
      useAppStore.getState().cellValidationErrors[`${row.rowId}:data`],
    ).toBeUndefined();
  });

  it("提交非法值：保留用户输入、记录校验错误、不置编辑完成态、返回失败", () => {
    resetRowStatus();
    const row = addFirstRow();
    const result = useAppStore.getState().commitCellText(row.rowId, "zz");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_INVALID_NUMBER");
    const updated = useAppStore.getState().workspace.sheets[0]?.rows[0];
    // §23：校验失败保留用户输入。
    expect(updated?.cellText).toBe("zz");
    expect(
      useAppStore.getState().cellValidationErrors[`${row.rowId}:data`],
    ).toEqual({
      messageKey: "errors.dataInvalidNumber",
      detail: "DATA_INVALID_NUMBER",
    });
    expect(useAppStore.getState().rowDirty[row.rowId]).toBeUndefined();
  });

  it("提交非规范写法：写回规范文本并置编辑完成态（ADR-051）", () => {
    resetRowStatus();
    const row = addFirstRow();
    const result = useAppStore.getState().commitCellText(row.rowId, "0005");
    expect(result.ok).toBe(true);
    const updated = useAppStore.getState().workspace.sheets[0]?.rows[0];
    expect(updated?.cellText).toBe("5");
    expect(useAppStore.getState().rowDirty[row.rowId]).toBe(true);
  });

  it("提交等价形式：写回规范文本但不置编辑完成态（ADR-051）", () => {
    resetRowStatus();
    const row = addFirstRow();
    // 值与显示文本已是规范形式（hex 00AB），改输入小写等价写法。
    useAppStore
      .getState()
      .updateRow(row.rowId, (r) => ({
        ...r,
        dataType: "hex",
        cellText: "00AB",
      }));
    const result = useAppStore.getState().commitCellText(row.rowId, "00ab");
    expect(result.ok).toBe(true);
    const updated = useAppStore.getState().workspace.sheets[0]?.rows[0];
    expect(updated?.cellText).toBe("00AB");
    expect(useAppStore.getState().rowDirty[row.rowId]).toBeUndefined();
  });

// ---- 撤销/重做（TECH_DESIGN §24.4，PRD §8.3 P1）----
describe("撤销/重做", () => {
  beforeEach(() => {
    useAppStore.setState({ undoStack: [], redoStack: [] });
  });

  function firstRowId(): RowId {
    const sheet = useAppStore.getState().workspace.sheets[0];
    const row = sheet?.rows[0];
    if (row === undefined) throw new Error("missing row");
    return row.rowId;
  }

  function findRowById(rowId: RowId) {
    return useAppStore
      .getState()
      .workspace.sheets.flatMap((s) => s.rows)
      .find((r) => r.rowId === rowId);
  }

  function canUndo(): boolean {
    return useAppStore.getState().undoStack.length > 0;
  }

  function canRedo(): boolean {
    return useAppStore.getState().redoStack.length > 0;
  }

  it("改名可撤销/重做", () => {
    const store = useAppStore.getState();
    const rowId = firstRowId();
    store.setRowName(rowId, "New Name");
    expect(findRowById(rowId)?.name).toBe("New Name");
    expect(canUndo()).toBe(true);
    store.undo();
    expect(findRowById(rowId)?.name).not.toBe("New Name");
    expect(canRedo()).toBe(true);
    store.redo();
    expect(findRowById(rowId)?.name).toBe("New Name");
  });

  it("删除行可撤销恢复（含行内容）与重做", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    const rowId = firstRowId();
    store.setRowName(rowId, "ToDelete");
    store.deleteRow(sheetId, rowId);
    expect(findRowById(rowId)).toBeUndefined();
    expect(canUndo()).toBe(true);
    store.undo();
    expect(findRowById(rowId)?.name).toBe("ToDelete");
    store.redo();
    expect(findRowById(rowId)).toBeUndefined();
  });

  it("新增行可撤销/重做", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    const beforeCount = store.workspace.sheets[0]?.rows.length ?? 0;
    store.addRow(sheetId);
    expect(useAppStore.getState().workspace.sheets[0]?.rows.length).toBe(
      beforeCount + 1,
    );
    store.undo();
    expect(useAppStore.getState().workspace.sheets[0]?.rows.length).toBe(
      beforeCount,
    );
    store.redo();
    expect(useAppStore.getState().workspace.sheets[0]?.rows.length).toBe(
      beforeCount + 1,
    );
  });

  it("移动行可撤销（行顺序恢复）", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    const rows = store.workspace.sheets[0]?.rows ?? [];
    const first = rows[0];
    const second = rows[1];
    if (first === undefined || second === undefined) {
      throw new Error("need at least 2 rows");
    }
    const before = rows.map((r) => r.rowId);
    store.moveRow(sheetId, second.rowId, "up");
    expect(
      useAppStore.getState().workspace.sheets[0]?.rows.map((r) => r.rowId)[0],
    ).toBe(second.rowId);
    store.undo();
    expect(
      useAppStore.getState().workspace.sheets[0]?.rows.map((r) => r.rowId),
    ).toEqual(before);
  });

  it("修改地址可撤销（含范围行 registerCount/registers 恢复）", () => {
    const store = useAppStore.getState();
    const rowId = firstRowId();
    store.commitRowAddress(rowId, "100-101");
    expect(findRowById(rowId)?.registerCount).toBe(2);
    store.undo();
    expect(findRowById(rowId)?.registerCount).toBe(1);
    store.redo();
    expect(findRowById(rowId)?.registerCount).toBe(2);
  });

  it("Data 单元格编辑不纳入撤销（§20.4 第 7 条）", () => {
    const store = useAppStore.getState();
    const rowId = firstRowId();
    store.commitCellText(rowId, "1234");
    expect(useAppStore.getState().undoStack.length).toBe(0);
    store.commitRowAddress(rowId, "100");
    expect(useAppStore.getState().undoStack.length).toBe(1);
    store.undo();
    expect(findRowById(rowId)?.cellText).toBe("1234");
  });

  it("设备读值不因撤销回退（§24.4「不撤销设备读取结果」）", () => {
    const store = useAppStore.getState();
    const rowId = firstRowId();
    store.commitRowAddress(rowId, "100");
    // 模拟轮询/读取覆盖 cellText（运行时路径，不入栈）。
    store.updateRow(rowId, (r) => ({ ...r, cellText: "9999" }));
    store.undo();
    expect(findRowById(rowId)?.cellText).toBe("9999");
  });

  it("新编辑截断重做栈", () => {
    const store = useAppStore.getState();
    const rowId = firstRowId();
    store.setRowName(rowId, "A");
    store.undo();
    expect(canRedo()).toBe(true);
    store.setRowName(rowId, "B");
    expect(canRedo()).toBe(false);
    expect(findRowById(rowId)?.name).toBe("B");
  });

  it("每表配置可撤销（radix/slaveAddress/writeVerify）", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.setSheetRegisterRadix(sheetId, "hex");
    store.setSheetSlaveAddress(sheetId, 9);
    store.setSheetWriteVerify(sheetId, { mode: "delayed", delayMs: 200 });
    expect(useAppStore.getState().workspace.sheets[0]?.registerRadix).toBe(
      "hex",
    );
    expect(useAppStore.getState().workspace.sheets[0]?.slaveAddress).toBe(9);
    expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
      mode: "delayed",
      delayMs: 200,
    });
    store.undo();
    expect(useAppStore.getState().workspace.sheets[0]?.writeVerify).toEqual({
      mode: "immediate",
      delayMs: null,
    });
    store.undo();
    expect(useAppStore.getState().workspace.sheets[0]?.slaveAddress).toBe(1);
    store.undo();
    expect(useAppStore.getState().workspace.sheets[0]?.registerRadix).toBe(
      "dec",
    );
    store.redo();
    expect(useAppStore.getState().workspace.sheets[0]?.registerRadix).toBe(
      "hex",
    );
  });

  it("新增表可撤销/重做", () => {
    const store = useAppStore.getState();
    const before = sheetNames();
    store.addSheet();
    expect(sheetNames()).toContain("Sheet 2");
    store.undo();
    expect(sheetNames()).toEqual(before);
    store.redo();
    expect(sheetNames()).toContain("Sheet 2");
  });

  it("重命名表可撤销/重做", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.renameSheet(sheetId, "Renamed");
    expect(sheetNames()).toEqual(["Renamed"]);
    store.undo();
    expect(sheetNames()).toEqual(["Sheet 1"]);
    store.redo();
    expect(sheetNames()).toEqual(["Renamed"]);
  });

  it("删除表可撤销/重做（多表场景）", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    store.addSheet();
    store.deleteSheet(sheetId);
    expect(sheetNames()).not.toContain("Sheet 1");
    store.undo();
    expect(sheetNames()).toContain("Sheet 1");
    store.redo();
    expect(sheetNames()).not.toContain("Sheet 1");
  });

  it("删除唯一表后撤销恢复原表并移除保底默认表", () => {
    const store = useAppStore.getState();
    const sheetId = firstSheetId();
    expect(sheetNames()).toEqual(["Sheet 1"]);
    store.deleteSheet(sheetId);
    // 删除唯一表后 UI 保底重建默认空表。
    expect(sheetNames()).toEqual(["Sheet 1"]);
    store.undo();
    // 撤销后应只有被恢复的原表（默认空表被移除）；原表带默认行。
    expect(sheetNames()).toEqual(["Sheet 1"]);
    expect(store.workspace.sheets[0]?.rows.length).toBeGreaterThan(0);
  });

  it("移动表顺序可撤销/重做", () => {
    const store = useAppStore.getState();
    store.addSheet(); // Sheet 2
    store.addSheet(); // Sheet 3
    store.moveSheetTo(firstSheetId(), 2);
    expect(sheetNames()).toEqual(["Sheet 2", "Sheet 3", "Sheet 1"]);
    store.undo();
    expect(sheetNames()).toEqual(["Sheet 1", "Sheet 2", "Sheet 3"]);
    store.redo();
    expect(sheetNames()).toEqual(["Sheet 2", "Sheet 3", "Sheet 1"]);
  });

  it("撤销历史为会话状态：setWorkspace 加载时清空", () => {
    // setWorkspace 内部调用 applyLanguage：需先初始化 i18n（非组件测试默认未初始化）。
    initI18n();
    const store = useAppStore.getState();
    store.setRowName(firstRowId(), "X");
    expect(canUndo()).toBe(true);
    useAppStore.getState().setWorkspace(createEmptyWorkspace());
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it("setWorkspaceRecovery 写入/清除恢复元数据（ADR-049）", () => {
    const store = useAppStore.getState();
    store.setWorkspaceRecovery(null);
    expect(useAppStore.getState().workspaceRecovery).toBeNull();
    const info = {
      recovered: true,
      source: "backup" as const,
      recoveredAt: 1000,
      backupTimestamp: 900,
      errorCode: null,
    };
    store.setWorkspaceRecovery(info);
    expect(useAppStore.getState().workspaceRecovery).toEqual(info);
  });
});

  it("非法提交后再次合法提交：清除校验错误并置编辑完成态", () => {
    resetRowStatus();
    const row = addFirstRow();
    useAppStore.getState().commitCellText(row.rowId, "zz");
    const result = useAppStore.getState().commitCellText(row.rowId, "42");
    expect(result.ok).toBe(true);
    expect(
      useAppStore.getState().cellValidationErrors[`${row.rowId}:data`],
    ).toBeUndefined();
    expect(useAppStore.getState().rowDirty[row.rowId]).toBe(true);
  });

  it("编辑清除校验错误同时清除既有设备失败态（用户已接管值）", () => {
    resetRowStatus();
    const row = addFirstRow();
    useAppStore.getState().recordManualResult(
      row.rowId,
      fail(
        createMamepError({
          code: "REQUEST_TIMEOUT",
          category: "timeout",
          userMessageKey: "errors.requestTimeout",
          technicalMessage: "timeout",
        }),
      ),
      "read",
    );
    useAppStore.getState().commitCellText(row.rowId, "zz");
    expect(useAppStore.getState().rowResults[row.rowId]).toBeUndefined();
    expect(
      useAppStore.getState().cellValidationErrors[`${row.rowId}:data`],
    ).toBeTruthy();
  });
});

describe("workspaceImportDraft（工作区导入，2026-08-29）", () => {
  function firstRowId(): RowId {
    const sheet = useAppStore.getState().workspace.sheets[0];
    const row = sheet?.rows[0];
    if (row === undefined) throw new Error("missing row");
    return row.rowId;
  }

  function canUndo(): boolean {
    return useAppStore.getState().undoStack.length > 0;
  }

  function canRedo(): boolean {
    return useAppStore.getState().redoStack.length > 0;
  }

  it("初始为 null；setWorkspaceImportDraft 写入草稿", () => {
    const store = useAppStore.getState();
    expect(store.workspaceImportDraft).toBeNull();
    const workspace = createEmptyWorkspace();
    useAppStore.getState().setWorkspaceImportDraft({
      workspace,
      preview: {
        name: "Imported",
        sheets: 1,
        rows: 0,
        connections: 1,
        schemaVersion: 4,
      },
    });
    expect(useAppStore.getState().workspaceImportDraft?.preview.name).toBe(
      "Imported",
    );
  });

  it("applyWorkspaceImport 替换工作区、清空撤销栈并清除草稿", () => {
    // setWorkspace 内部调用 applyLanguage：需先初始化 i18n。
    initI18n();
    const store = useAppStore.getState();
    store.setRowName(firstRowId(), "Draft Edit");
    expect(canUndo()).toBe(true);
    const imported = createEmptyWorkspace();
    imported.name = "Imported Workspace";
    useAppStore.getState().setWorkspaceImportDraft({
      workspace: imported,
      preview: {
        name: imported.name,
        sheets: 1,
        rows: 0,
        connections: 1,
        schemaVersion: 5,
      },
    });
    useAppStore.getState().applyWorkspaceImport();
    const state = useAppStore.getState();
    expect(state.workspace.name).toBe("Imported Workspace");
    expect(state.workspaceImportDraft).toBeNull();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it("无草稿时 applyWorkspaceImport 为 no-op", () => {
    const before = useAppStore.getState().workspace;
    useAppStore.getState().applyWorkspaceImport();
    expect(useAppStore.getState().workspace).toBe(before);
  });
});

describe("traceWindows（TM 追踪窗口）", () => {  function addFirstRowForTrace() {
    clearAllSheetRows();
    const id = firstSheetId();
    useAppStore.getState().addRow(id);
    const sheet = useAppStore
      .getState()
      .workspace.sheets.find((s) => s.sheetId === id);
    const row = sheet?.rows[0];
    if (row === undefined) throw new Error("missing row");
    return row;
  }

  it("openTraceWindow 打开窗口但初始不自动开始采样（playing=false）", () => {
    const row = addFirstRowForTrace();
    useAppStore.getState().openTraceWindow(row.rowId);
    const model = useAppStore.getState().traceWindows[row.rowId];
    expect(model).toBeDefined();
    expect(model?.playing).toBe(false);
    expect(model?.samples).toEqual([]);
  });

  it("closeTraceWindow 删除窗口并复位对应行 traceEnabled", () => {
    const row = addFirstRowForTrace();
    useAppStore.getState().updateRow(row.rowId, (r) => ({
      ...r,
      traceEnabled: true,
      updatedAt: Date.now(),
    }));
    useAppStore.getState().openTraceWindow(row.rowId);
    expect(useAppStore.getState().traceWindows[row.rowId]).toBeDefined();
    useAppStore.getState().closeTraceWindow(row.rowId);
    const after = useAppStore.getState();
    expect(after.traceWindows[row.rowId]).toBeUndefined();
    const updatedRow = after.workspace.sheets
      .flatMap((s) => s.rows)
      .find((r) => r.rowId === row.rowId);
    expect(updatedRow?.traceEnabled).toBe(false);
  });

  it("closeTraceWindow 找不到行时仅删除窗口，不重建 workspace", () => {
    const before = useAppStore.getState().workspace;
    useAppStore.getState().openTraceWindow("missing" as RowId);
    useAppStore.getState().closeTraceWindow("missing" as RowId);
    const after = useAppStore.getState();
    expect(after.traceWindows["missing"]).toBeUndefined();
    expect(after.workspace).toBe(before);
  });
});

describe("themeConfig（VSCode 完整主题注入，ADR-027）", () => {
  it("默认 null（浏览器/Electron 回退 buildTheme 两态）", () => {
    expect(useAppStore.getState().themeConfig).toBeNull();
  });

  it("setThemeConfig 写入完整主题且不触碰工作区（运行时派生，不持久化）", () => {
    const before = useAppStore.getState().workspace;
    useAppStore
      .getState()
      .setThemeConfig({ token: { colorBgContainer: "#1e1e1e" } });
    const after = useAppStore.getState();
    expect(after.themeConfig?.token?.colorBgContainer).toBe("#1e1e1e");
    expect(after.workspace).toBe(before);
  });

  it("setThemeConfig(null) 清除宿主主题（回退两态）", () => {
    useAppStore
      .getState()
      .setThemeConfig({ token: { colorBgContainer: "#1e1e1e" } });
    useAppStore.getState().setThemeConfig(null);
    expect(useAppStore.getState().themeConfig).toBeNull();
  });
});
