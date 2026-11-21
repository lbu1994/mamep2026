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
