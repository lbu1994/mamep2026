import { makeHost } from "../test/make-app-host";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConnectionState } from "@mamep2026/communication";
import { createEmptyWorkspace, RegisterAddress } from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { TraceWindow } from "./TraceWindow";

describe("TraceWindow 离线通信门控", () => {
  beforeEach(() => {
    initI18n();
  });

  it("三种离线态禁用 Play 并共享原因，恢复连接后可启动采样", async () => {
    const workspace = createEmptyWorkspace();
    const firstSheet = workspace.sheets[0];
    const firstRow = firstSheet?.rows[0];
    const address = RegisterAddress.create(0);
    if (firstSheet !== undefined && firstRow !== undefined) {
      firstSheet.rows[0] = {
        ...firstRow,
        addressDraft: "0",
        addressValue: address.ok ? address.value : null,
      };
    }
    const rowId = firstRow?.rowId;
    if (rowId === undefined) throw new Error("missing row");
    const traceStart = vi.fn();
    const host = {
      traceStart,
      traceStop: vi.fn(),
      getCommProperties: vi.fn(() => ({
        protocol: "rtu" as const,
        portLabel: null,
        unitId: null,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs: 1000,
        retryCount: 1,
        connectionState: "disconnected",
      })),
    } as unknown as AppHost;
    useAppStore.setState({
      host,
      workspace,
      connectionState: "disconnected",
      traceWindows: {},
    });
    useAppStore.getState().openTraceWindow(rowId);

    render(<TraceWindow rowId={rowId} />);
    const offlineStates: ConnectionState[] = [
      "disconnected",
      "failed",
      "interrupted",
    ];
    for (const state of offlineStates) {
      useAppStore.setState({ connectionState: state });
      await waitFor(() => {
        const play = screen.getByRole("button", { name: /Play/ });
        expect((play as HTMLButtonElement).disabled).toBe(true);
        const describedBy = play.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
          "Connect the device before reading, writing, or polling.",
        );
      });
      fireEvent.click(screen.getByRole("button", { name: /Play/ }));
      expect(useAppStore.getState().traceWindows[rowId]?.playing).toBe(false);
    }
    expect(traceStart).not.toHaveBeenCalled();

    useAppStore.setState({ connectionState: "connected" });
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /Play/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => {
      expect(traceStart).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Trace controls", () => {
  it("pauses without clearing, resumes with a new generation, and clears while playing or paused", async () => {
    initI18n();
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    const row = sheet?.rows[0];
    const address = RegisterAddress.create(1);
    if (row === undefined || !address.ok) throw new Error("missing row");
    row.addressValue = address.value;
    const { host } = makeHost();
    useAppStore.setState({
      host,
      workspace,
      connectionState: "connected",
      traceWindows: {},
    });
    useAppStore.getState().openTraceWindow(row.rowId);
    render(<TraceWindow rowId={row.rowId} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(host.traceStart).toHaveBeenCalledTimes(1));
    const binding = useAppStore.getState().traceWindows[row.rowId]?.binding;
    if (binding == null) throw new Error("missing binding");
    const sample = {
      ...binding,
      key: row.rowId,
      connectionId: "connection-1",
      requestId: "request-1",
      no: 1,
      sequence: 1,
      rawValue: 123,
      value: "123",
      timestamp: 456,
    };
    useAppStore.getState().appendTraceSample(row.rowId, sample);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    useAppStore.getState().appendTraceSample(row.rowId, sample);
    expect(useAppStore.getState().traceWindows[row.rowId]?.buffer.length).toBe(
      1,
    );
    expect(useAppStore.getState().traceWindows[row.rowId]?.average).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(host.traceStart).toHaveBeenCalledTimes(2));
    const resumed = useAppStore.getState().traceWindows[row.rowId]?.binding;
    expect(resumed?.generation).toBeGreaterThan(binding.generation);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(host.traceStart).toHaveBeenCalledTimes(3));
    expect(useAppStore.getState().traceWindows[row.rowId]?.playing).toBe(true);
    expect(useAppStore.getState().traceWindows[row.rowId]?.buffer.length).toBe(
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(useAppStore.getState().traceWindows[row.rowId]?.playing).toBe(false);
    expect(host.traceStart).toHaveBeenCalledTimes(3);
  });
});
