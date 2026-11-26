import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyRow,
  createEmptyWorkspace,
  createMamepError,
  createRegisterSheet,
  fail,
  ok,
  RawRegisterValue,
  RegisterAddress,
  type Result,
  type SheetId,
} from "@mamep2026/domain";
import { useAppStore } from "./app-store";
import { makeHost } from "./test/make-app-host";

const staleCsv = "Name,Address,Data,Type,Comment\nOld,99,0001,hex,Stale";
const denied = fail(
  createMamepError({
    code: "CLIPBOARD_UNAVAILABLE",
    category: "permission",
    userMessageKey: "errors.clipboardUnavailable",
    technicalMessage: "Clipboard access denied",
  }),
);

function sheet(sheetId: SheetId) {
  const found = useAppStore
    .getState()
    .workspace.sheets.find((value) => value.sheetId === sheetId);
  if (found === undefined) throw new Error("Missing test sheet");
  return found;
}

function deferredWrite() {
  let complete: ((result: Result<void>) => void) | undefined;
  const promise = new Promise<Result<void>>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(result: Result<void>) {
      if (complete === undefined) throw new Error("Missing promise resolver");
      complete(result);
    },
  };
}

function prepare() {
  const source = createRegisterSheet("Source", 0);
  source.rows = Array.from({ length: 3 }, (_, index) => {
    const address = RegisterAddress.create(16 + index * 2);
    if (!address.ok) throw new Error("Invalid test address");
    return {
      ...createEmptyRow(),
      order: index + 1,
      name: `Row ${index}, "quoted"`,
      comment: `Line ${index}\nSecond line`,
      addressValue: address.value,
      addressDraft: String(address.value.value),
      registerCount: index === 1 ? 2 : 1,
      cellText: index === 1 ? "1234 ABCD" : "0001",
      pollingEnabled: true,
      traceEnabled: true,
      registerValues: (index === 1 ? [0x1234, 0xabcd] : [1]).map((value) => {
        const raw = RawRegisterValue.create(value);
        if (!raw.ok) throw new Error("Invalid test register value");
        return raw.value;
      }),
    };
  });
  const target = createRegisterSheet("Target", 1);
  target.rows = [createEmptyRow()];
  target.registerRadix = "hex";
  const { host } = makeHost({ clipboard: true });
  vi.mocked(host.readTextFromClipboard).mockResolvedValue(ok(staleCsv));
  useAppStore.setState({
    host,
    workspace: {
      ...createEmptyWorkspace(),
      sheets: [source, target],
      activeSheetId: source.sheetId,
    },
    activeSheetId: source.sheetId,
    selectedRowIds: source.rows.map((row) => row.rowId).reverse(),
    clipboardPayload: null,
    clipboardWriteStatus: null,
    clipboardSourceSheetType: null,
    undoStack: [],
    redoStack: [],
    messages: [],
  });
  return { host, source, target };
}

describe("cross-table clipboard sources", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const action of ["copySelectedRows", "cutSelectedRows"] as const) {
    it(`${action} retains the whole block when system write fails`, async () => {
      const { host, source, target } = prepare();
      vi.mocked(host.copyTextToClipboard).mockResolvedValue(denied);
      useAppStore.getState()[action](source.sheetId);
      await Promise.resolve();
      expect(useAppStore.getState().clipboardWriteStatus).toBe("failed");
      useAppStore.getState().setActiveSheetId(target.sheetId);
      await useAppStore.getState().pasteRows(target.sheetId, null);
      expect(host.readTextFromClipboard).not.toHaveBeenCalled();
      const pasted = sheet(target.sheetId).rows.slice(1);
      expect(pasted.map((row) => row.name)).toEqual(
        source.rows.map((row) => row.name),
      );
      expect(pasted.map((row) => row.comment)).toEqual(
        source.rows.map((row) => row.comment),
      );
      expect(pasted.map((row) => row.cellText)).toEqual([
        "0001",
        "1234 ABCD",
        "0001",
      ]);
      expect(pasted.map((row) => row.addressDraft)).toEqual([
        "0010",
        "0012-0013",
        "0014",
      ]);
      expect(pasted.map((row) => row.registerCount)).toEqual([1, 2, 1]);
      expect(
        new Set([...source.rows, ...pasted].map((row) => row.rowId)).size,
      ).toBe(6);
      for (const row of pasted) {
        expect(row.dataType).toBe("hex");
        expect(row.pollingEnabled).toBe(false);
        expect(row.traceEnabled).toBe(false);
        expect(row.registerValues).toBeNull();
      }
      expect(useAppStore.getState().messages.at(-1)?.messageKey).toBe(
        "messages.clipboardWriteFailed",
      );
    });
  }

  it("pastes the current block while the system write is pending", async () => {
    const { host, source, target } = prepare();
    const write = deferredWrite();
    vi.mocked(host.copyTextToClipboard).mockReturnValue(write.promise);
    useAppStore.getState().copySelectedRows(source.sheetId);
    expect(useAppStore.getState().clipboardWriteStatus).toBe("pending");
    await useAppStore.getState().pasteRows(target.sheetId, null);
    expect(sheet(target.sheetId).rows).toHaveLength(4);
    expect(host.readTextFromClipboard).not.toHaveBeenCalled();
    write.resolve(ok(undefined));
    await write.promise;
    expect(useAppStore.getState().clipboardWriteStatus).toBe("succeeded");
  });

  it("ignores completion of an older clipboard write", async () => {
    const { host, source, target } = prepare();
    const olderWrite = deferredWrite();
    vi.mocked(host.copyTextToClipboard)
      .mockReturnValueOnce(olderWrite.promise)
      .mockResolvedValueOnce(denied);
    useAppStore
      .getState()
      .setSelectedRowIds(source.rows.slice(0, 1).map((row) => row.rowId));
    useAppStore.getState().copySelectedRows(source.sheetId);
    useAppStore
      .getState()
      .setSelectedRowIds(source.rows.map((row) => row.rowId));
    useAppStore.getState().copySelectedRows(source.sheetId);
    await Promise.resolve();
    olderWrite.resolve(ok(undefined));
    await olderWrite.promise;
    expect(useAppStore.getState().clipboardWriteStatus).toBe("failed");
    await useAppStore.getState().pasteRows(target.sheetId, null);
    expect(sheet(target.sheetId).rows).toHaveLength(4);
  });

  it("round-trips multi-line CSV after a successful write", async () => {
    const { host, source, target } = prepare();
    let csv = "";
    vi.mocked(host.copyTextToClipboard).mockImplementation(async (text) => {
      csv = text;
      return ok(undefined);
    });
    vi.mocked(host.readTextFromClipboard).mockImplementation(async () =>
      ok(csv),
    );
    useAppStore.getState().copySelectedRows(source.sheetId);
    await Promise.resolve();
    await useAppStore.getState().pasteRows(target.sheetId, null);
    expect(host.readTextFromClipboard).toHaveBeenCalledOnce();
    expect(
      sheet(target.sheetId)
        .rows.slice(1)
        .map((row) => [row.name, row.comment, row.registerCount]),
    ).toEqual(
      source.rows.map((row) => [row.name, row.comment, row.registerCount]),
    );
  });

  it("keeps external clipboard priority after a successful write", async () => {
    const { host, source, target } = prepare();
    useAppStore.getState().copySelectedRows(source.sheetId);
    await Promise.resolve();
    expect(useAppStore.getState().clipboardWriteStatus).toBe("succeeded");
    await useAppStore.getState().pasteRows(target.sheetId, null);
    expect(host.readTextFromClipboard).toHaveBeenCalledOnce();
    expect(
      sheet(target.sheetId)
        .rows.slice(1)
        .map((row) => row.name),
    ).toEqual(["Old"]);
  });

  it("falls back to the entire application block when system read fails", async () => {
    const { host, source, target } = prepare();
    vi.mocked(host.readTextFromClipboard).mockResolvedValue(denied);
    useAppStore.getState().copySelectedRows(source.sheetId);
    await Promise.resolve();
    await useAppStore.getState().pasteRows(target.sheetId, null);
    expect(sheet(target.sheetId).rows).toHaveLength(4);
  });
});
