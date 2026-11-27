import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyWorkspace,
  createMamepError,
  fail,
  ok,
} from "@mamep2026/domain";
import { applyPollResult } from "@mamep2026/register-table";
import { useAppStore } from "../app-store";
import { initI18n } from "../i18n";
import { makeHost } from "../test/make-app-host";
import { RegisterTable } from "./RegisterTable";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function current() {
  const sheet = useAppStore.getState().workspace.sheets[0];
  const row = sheet?.rows[0];
  if (!sheet || !row) throw new Error("Missing fixture row");
  return { sheet, row };
}

function dataCell() {
  const cell = document.querySelector<HTMLElement>(
    '[data-register-cell="data"]',
  );
  if (!cell) throw new Error("Missing Data cell");
  return cell;
}

function edit(text: string) {
  if (!(dataCell() instanceof HTMLInputElement)) fireEvent.click(dataCell());
  fireEvent.change(dataCell(), { target: { value: text } });
}

function deliverRead(value: number) {
  act(() => {
    const { sheet, row } = current();
    const updated = applyPollResult(
      [sheet],
      {
        key: row.rowId,
        sheetId: sheet.sheetId,
        address: 1,
        route: { unitAddress: sheet.slaveAddress, protocol: "rtu" },
      },
      value,
    );
    if (!updated) throw new Error("Rejected fixture read");
    useAppStore.getState().recordPollResult(row.rowId, ok(value));
    useAppStore.getState().updateRow(row.rowId, () => updated);
  });
}

const timeout = fail(
  createMamepError({
    code: "REQUEST_TIMEOUT",
    category: "timeout",
    userMessageKey: "errors.requestTimeout",
    technicalMessage: "Test response timeout",
  }),
);

describe("Data editing with completed reads", () => {
  beforeEach(() => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (!sheet) throw new Error("Missing fixture sheet");
    sheet.rows = sheet.rows.slice(0, 1);
    useAppStore.setState({
      workspace,
      host: makeHost().host,
      connectionState: "connected",
      rowResults: {},
      rowDirty: {},
      rowSuccess: {},
      cellValidationErrors: {},
      pollingOutcomes: {},
      rowReadCompletions: {},
      selectedRowIds: [],
    });
    useAppStore.getState().commitRowAddress(current().row.rowId, "1");
    useAppStore.getState().setPollingEnabled(current().row.rowId, true);
    render(<RegisterTable sheetId={current().sheet.sheetId} />);
  });

  it.each(["Enter", "blur"])(
    "commits rapid automated input on %s",
    async (trigger) => {
      edit("ab");
      if (trigger === "Enter") fireEvent.keyDown(dataCell(), { key: "Enter" });
      else fireEvent.blur(dataCell());
      await waitFor(() => expect(current().row.cellText).toBe("00AB"));
      expect(current().row.pollingEnabled).toBe(true);
    },
  );

  it.each([0x0010, 0x0020])(
    "overwrites a focused draft when read returns %i",
    async (value) => {
      deliverRead(0x0010);
      edit("abcd");
      const input = dataCell();
      expect(document.activeElement).toBe(input);
      deliverRead(value);
      expect((dataCell() as HTMLInputElement).value).toBe(
        value.toString(16).padStart(4, "0").toUpperCase(),
      );
      expect(document.activeElement).toBe(input);
      fireEvent.blur(input);
      await waitFor(() =>
        expect(current().row.cellText).toBe(value === 16 ? "0010" : "0020"),
      );
      expect(current().row.pollingEnabled).toBe(true);
    },
  );

  it.each([16, 32])(
    "does not replay a queued edit over a later read of %i",
    async (value) => {
      deliverRead(16);
      edit("ffff");
      fireEvent.keyDown(dataCell(), { key: "Enter" });
      deliverRead(value);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const expected = value === 16 ? "0010" : "0020";
      expect(current().row.cellText).toBe(expected);
      expect(dataCell().textContent).toContain(expected);
    },
  );

  it("preserves a draft on failed reads and on invalid blur", async () => {
    edit("zz");
    act(() =>
      useAppStore.getState().recordPollResult(current().row.rowId, timeout),
    );
    expect((dataCell() as HTMLInputElement).value).toBe("zz");
    fireEvent.blur(dataCell());
    await waitFor(() => expect(current().row.cellText).toBe("zz"));
    expect(
      useAppStore.getState().cellValidationErrors[
        `${current().row.rowId}:data`
      ],
    ).toBeDefined();
    expect(current().row.pollingEnabled).toBe(true);
    deliverRead(32);
    expect(current().row.cellText).toBe("0020");
    expect(
      useAppStore.getState().cellValidationErrors[
        `${current().row.rowId}:data`
      ],
    ).toBeUndefined();
  });

  it("keeps the active draft when disconnection clears the sampling timestamp", () => {
    deliverRead(16);
    edit("abcd");
    act(() => useAppStore.getState().setConnectionState("disconnected"));
    expect((dataCell() as HTMLInputElement).value).toBe("abcd");
  });

  it("replaces a range child draft after an equal-value parent read", () => {
    const { row } = current();
    act(() =>
      useAppStore.getState().updateRow(row.rowId, (value) => ({
        ...value,
        registerCount: 2,
        registerValues: [{ value: 16 }, { value: 32 }],
        cellText: "0010 0020",
      })),
    );
    const expand = document.querySelector(".ant-table-row-expand-icon");
    if (!expand) throw new Error("Missing range expander");
    fireEvent.click(expand);
    const child = document.querySelectorAll('[data-register-cell="data"]')[1];
    if (!child) throw new Error("Missing child Data");
    fireEvent.click(child);
    const input = document.querySelector<HTMLInputElement>(
      'input[data-register-cell="data"]',
    );
    if (!input) throw new Error("Missing child input");
    fireEvent.change(input, { target: { value: "ffff" } });
    act(() => useAppStore.getState().recordPollResult(row.rowId, ok([16, 32])));
    expect(input.value).toBe("0010");
    expect(current().row.registerValues?.map((value) => value.value)).toEqual([
      16, 32,
    ]);
  });

  it("keeps new input when a write completes with readback disabled", async () => {
    edit("00ab");
    fireEvent.blur(dataCell());
    await waitFor(() => expect(current().row.cellText).toBe("00AB"));
    edit("1234");
    act(() =>
      useAppStore
        .getState()
        .recordManualResult(
          current().row.rowId,
          ok({ kind: "write-succeeded-no-verify" }),
          "write",
          { writeOutcome: { kind: "write-succeeded-no-verify" } },
        ),
    );
    expect((dataCell() as HTMLInputElement).value).toBe("1234");
  });

  it("continues keyboard input after a read replaces the draft", async () => {
    const user = userEvent.setup();
    edit("ffff");
    deliverRead(16);
    await user.clear(dataCell());
    await user.type(dataCell(), "2a{Enter}");
    await waitFor(() => expect(current().row.cellText).toBe("002A"));
    expect(current().row.pollingEnabled).toBe(true);
  });

  it("interprets Type and Scale changes with the old type without writing the device", async () => {
    deliverRead(0x00ab);
    const host = useAppStore.getState().host;
    act(() =>
      useAppStore.getState().setRowDataType(current().row.rowId, "unsigned"),
    );
    expect(current().row.cellText).toBe("171");
    act(() =>
      useAppStore
        .getState()
        .setRowDataType(current().row.rowId, "unsigned-0.1"),
    );
    expect(current().row.cellText).toBe("17.1");
    expect(current().row.registerValues?.[0]?.value).toBe(171);
    deliverRead(171);
    expect(current().row.cellText).toBe("17.1");
    expect(host?.writeRow).not.toHaveBeenCalled();
    expect(current().row.pollingEnabled).toBe(true);
  });

  it("reports unknown before sampling and retains the last success after failure", () => {
    const wp = screen.getByRole("switch", { name: /^Poll row/ });
    const description = () =>
      document.getElementById(wp.getAttribute("aria-describedby") ?? "")
        ?.textContent;
    expect(description()).toContain("Last successful update: unknown");
    deliverRead(16);
    const completedAt =
      useAppStore.getState().rowReadCompletions[current().row.rowId];
    expect(description()).not.toContain("unknown");
    act(() =>
      useAppStore.getState().recordPollResult(current().row.rowId, timeout),
    );
    expect(useAppStore.getState().rowReadCompletions[current().row.rowId]).toBe(
      completedAt,
    );
    act(() => useAppStore.getState().setConnectionState("disconnected"));
    expect(
      useAppStore.getState().rowReadCompletions[current().row.rowId],
    ).toBeUndefined();
    act(() => useAppStore.getState().setConnectionState("connected"));
    expect(description()).toContain("Last successful update: unknown");
  });
});
