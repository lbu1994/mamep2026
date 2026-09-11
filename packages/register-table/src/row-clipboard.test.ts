/**
 * 行剪贴板模型（纯函数，docs/AGENTS.md §9.2/§32-26）：
 * - 复制/剪切只携带可粘贴字段（name/addressValue/dataType/cellText/comment），运行时状态清零；
 * - 地址以内部十进制数值传递，粘贴时按目标表进制重新格式化，避免跨表进制歧义；
 * - 系统剪贴板 CSV：表头 Name,Register,Data,Type,Comment；Register 为十进制数值；
 * - 粘贴非法数据不得静默丢弃：行级 issue 汇总返回，可保留部分可恢复字段。
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyRow,
  createRegisterSheet,
  newRowId,
  type RegisterRow,
  type RegisterSheet,
} from "@mamep2026/domain";
import { renumberRows } from "./row-operations";
import {
  copyRowsToClipboard,
  cutRowsFromSheet,
  decodeClipboardCsv,
  encodeClipboardCsv,
  pasteClipboardRows,
  toClipboardData,
  type RowClipboardData,
} from "./row-clipboard";

function sheetWithRows(count: number): RegisterSheet {
  const sheet = createRegisterSheet("S", 0);
  const rows = Array.from({ length: count }, (_, i) => {
    const row = createEmptyRow();
    row.name = `R${i + 1}`;
    return row;
  });
  sheet.rows = renumberRows(rows);
  return sheet;
}

function filledRow(name: string): RegisterRow {
  const row = createEmptyRow();
  row.name = name;
  row.comment = "c";
  row.addressDraft = "0010";
  row.dataType = "unsigned";
  row.pollingEnabled = true;
  row.traceEnabled = true;
  row.cellText = "1234";
  return row;
}

describe("row clipboard data extraction", () => {
  it("toClipboardData keeps editable fields and drops runtime state", () => {
    const row = filledRow("Speed");
    const data = toClipboardData(row);
    expect(data.name).toBe("Speed");
    expect(data.comment).toBe("c");
    expect(data.dataType).toBe("unsigned");
    expect(data.cellText).toBe("1234");
    expect(data.addressValue).toBeNull(); // addressDraft 未提交
  });

  it("copyRowsToClipboard returns payload in table order and does not modify the sheet", () => {
    const sheet = sheetWithRows(3);
    const before = sheet.rows.map((r) => r.rowId);
    const payload = copyRowsToClipboard(sheet, [
      sheet.rows[2]?.rowId ?? newRowId(),
      sheet.rows[0]?.rowId ?? newRowId(),
    ]);
    expect(payload.map((p) => p.name)).toEqual(["R1", "R3"]);
    expect(sheet.rows.map((r) => r.rowId)).toEqual(before);
  });

  it("cutRowsFromSheet removes the rows and returns their payload", () => {
    const sheet = sheetWithRows(4);
    const targetId = sheet.rows[1]?.rowId ?? newRowId();
    const { sheet: updated, payload } = cutRowsFromSheet(sheet, [targetId]);
    expect(updated.rows.map((r) => r.name)).toEqual(["R1", "R3", "R4"]);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3]);
    expect(payload).toHaveLength(1);
    expect(payload[0]?.name).toBe("R2");
  });
});

describe("pasteClipboardRows", () => {
  const payload: RowClipboardData[] = [
    {
      name: "X",
      addressValue: 0x10,
      registerCount: 1,
      dataType: "hex",
      cellText: "1234",
      comment: "c1",
    },
    {
      name: "Y",
      addressValue: null,
      registerCount: 1,
      dataType: "unsigned",
      cellText: "",
      comment: "",
    },
  ];

  it("inserts rows after the target row with new ids, renumbers and formats address per radix", () => {
    const sheet = sheetWithRows(2);
    const source = sheet.rows[0];
    expect(source).toBeDefined();
    const { sheet: updated, issues } = pasteClipboardRows(
      sheet,
      (source as RegisterRow).rowId,
      payload,
      "dec",
    );
    expect(updated.rows).toHaveLength(4);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3, 4]);
    const pastedX = updated.rows[1];
    expect(pastedX).toBeDefined();
    expect(pastedX?.name).toBe("X");
    expect(pastedX?.addressValue?.value).toBe(0x10);
    expect(pastedX?.addressDraft).toBe("16");
    expect(pastedX?.dataType).toBe("hex");
    expect(pastedX?.cellText).toBe("1234");
    expect(pastedX?.comment).toBe("c1");
    expect(pastedX?.pollingEnabled).toBe(false);
    expect(pastedX?.traceEnabled).toBe(false);
    expect(pastedX?.rowId).not.toBe((source as RegisterRow).rowId);
    expect(updated.rows[2]?.name).toBe("Y");
    expect(updated.rows[2]?.addressValue).toBeNull();
    expect(issues).toEqual([]);
  });

  it("pastes before the target when requested via addRowAfter-style semantics (after target)", () => {
    // pasteClipboardRows 语义为“在目标行之后插入”；此处验证目标行不存在时追加末尾。
    const sheet = sheetWithRows(1);
    const { sheet: updated } = pasteClipboardRows(
      sheet,
      "missing",
      payload,
      "hex",
    );
    expect(updated.rows).toHaveLength(3);
    expect(updated.rows[1]?.name).toBe("X");
    expect(updated.rows[1]?.addressDraft).toBe("0010");
  });

  it("normalizes pasted cell text by row type, keeping invalid text as-is（ADR-051）", () => {
    const sheet = sheetWithRows(1);
    const normalizedPayload: RowClipboardData[] = [
      {
        name: "H",
        addressValue: null,
        registerCount: 1,
        dataType: "hex",
        cellText: "1f",
        comment: "",
      },
      {
        name: "B",
        addressValue: null,
        registerCount: 1,
        dataType: "binary",
        cellText: "101",
        comment: "",
      },
      {
        name: "U",
        addressValue: null,
        registerCount: 1,
        dataType: "unsigned",
        cellText: "0005",
        comment: "",
      },
      {
        name: "Bad",
        addressValue: null,
        registerCount: 1,
        dataType: "unsigned",
        cellText: "zz",
        comment: "",
      },
      {
        name: "R",
        addressValue: 0x10,
        registerCount: 2,
        dataType: "hex",
        cellText: "1234abcd",
        comment: "",
      },
    ];
    const { sheet: updated, issues } = pasteClipboardRows(
      sheet,
      "missing",
      normalizedPayload,
      "dec",
    );
    expect(updated.rows.slice(1).map((row) => row.cellText)).toEqual([
      "001F",
      "00000000 00000101",
      "5",
      "zz",
      "1234 ABCD",
    ]);
    // 地址按目标表进制规范化（范围行 "start-end"）。
    expect(updated.rows[5]?.addressDraft).toBe("16-17");
    expect(issues).toEqual([]);
  });
});

describe("clipboard CSV encode/decode", () => {
  it("encodes rows to CSV with header and escapes quotes, commas and newlines", () => {
    const payload: RowClipboardData[] = [
      {
        name: 'A, "quoted"',
        addressValue: 31,
        registerCount: 1,
        dataType: "hex",
        cellText: "001F",
        comment: "line1\nline2",
      },
      {
        name: "B",
        addressValue: null,
        registerCount: 1,
        dataType: "binary",
        cellText: "",
        comment: "",
      },
    ];
    const csv = encodeClipboardCsv(payload);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Name,Register,Data,Type,Comment");
    expect(csv).toContain('"A, ""quoted"""');
    expect(csv).toContain("line1\nline2");
    expect(csv).toContain("31");
  });

  it("round-trips rows through CSV", () => {
    const payload: RowClipboardData[] = [
      {
        name: "Speed",
        addressValue: 1,
        registerCount: 1,
        dataType: "unsigned-0.1",
        cellText: "12.3",
        comment: "rpm",
      },
      {
        name: "B",
        addressValue: null,
        registerCount: 1,
        dataType: "binary",
        cellText: "0000000000000001",
        comment: "",
      },
    ];
    const decoded = decodeClipboardCsv(encodeClipboardCsv(payload));
    expect(decoded.issues).toEqual([]);
    expect(decoded.rows).toEqual(payload);
  });

  it("reports issues for out-of-range address and unknown type without dropping rows", () => {
    const csv = [
      "Name,Register,Data,Type,Comment",
      "BadAddr,70000,001F,hex,",
      "BadType,1,001F,not-a-type,",
      "Ok,2,00FF,hex,",
      "",
    ].join("\n");
    const decoded = decodeClipboardCsv(csv);
    expect(decoded.rows).toHaveLength(3);
    expect(decoded.rows[0]?.addressValue).toBeNull();
    expect(decoded.rows[1]?.dataType).toBe("hex");
    expect(decoded.rows[2]?.addressValue).toBe(2);
    expect(decoded.issues.length).toBe(2);
  });

  it("treats the first line as data when it is not the header", () => {
    const csv = "A,1,00FF,hex,note\nB,2,0001,unsigned,";
    const decoded = decodeClipboardCsv(csv);
    expect(decoded.rows).toHaveLength(2);
    expect(decoded.rows[0]?.name).toBe("A");
    expect(decoded.rows[1]?.name).toBe("B");
  });

  it("encodes range rows as start-end and decodes registerCount", () => {
    const payload: RowClipboardData[] = [
      {
        name: "Range",
        addressValue: 1000,
        registerCount: 2,
        dataType: "unsigned",
        cellText: "65535,1",
        comment: "",
      },
    ];
    const csv = encodeClipboardCsv(payload);
    expect(csv).toContain("1000-1001");
    const decoded = decodeClipboardCsv(csv);
    expect(decoded.issues).toEqual([]);
    expect(decoded.rows).toEqual(payload);
  });

  it("decodes single register from CSV as registerCount 1", () => {
    const csv = "Name,Register,Data,Type,Comment\nSingle,50,00FF,hex,";
    const decoded = decodeClipboardCsv(csv);
    expect(decoded.rows[0]?.addressValue).toBe(50);
    expect(decoded.rows[0]?.registerCount).toBe(1);
  });

  it("reports INVALID_ADDRESS for reversed or non-numeric ranges", () => {
    const csv = [
      "Name,Register,Data,Type,Comment",
      "Rev,10-5,00FF,hex,",
      "Garbage,a-b,00FF,hex,",
      "Ok,5-6,00FF,hex,",
    ].join("\n");
    const decoded = decodeClipboardCsv(csv);
    expect(decoded.rows[0]?.addressValue).toBeNull();
    expect(decoded.rows[0]?.registerCount).toBe(1);
    expect(decoded.rows[1]?.addressValue).toBeNull();
    expect(decoded.rows[2]?.addressValue).toBe(5);
    expect(decoded.rows[2]?.registerCount).toBe(2);
    expect(decoded.issues.length).toBe(2);
  });

  it("toClipboardData carries registerCount and paste restores it", () => {
    const sheet = sheetWithRows(1);
    const src = sheet.rows[0];
    expect(src).toBeDefined();
    (src as RegisterRow).registerCount = 3;
    (src as RegisterRow).addressDraft = "1000-1002";
    const data = toClipboardData(src as RegisterRow);
    expect(data.registerCount).toBe(3);
    const { sheet: updated } = pasteClipboardRows(
      sheet,
      "missing",
      [data],
      "dec",
    );
    expect(updated.rows[0]?.registerCount).toBe(3);
  });
});
