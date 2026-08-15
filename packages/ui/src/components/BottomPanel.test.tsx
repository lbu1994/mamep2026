import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import type {
  ApplicationMessage,
  CommunicationLogEntry,
} from "@mamep2026/logging";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost, CommProperties } from "../host";
import { BottomPanel } from "./BottomPanel";

// BottomPanel 使用 App.useApp()（antd message），测试渲染必须包 <AntApp>。
function renderPanel(): ReturnType<typeof render> {
  return render(
    <AntApp>
      <BottomPanel />
    </AntApp>,
  );
}

describe("BottomPanel messages", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: useAppStore.getState().workspace,
      messages: [],
      commLog: [],
    });
  });

  it("translates known message keys instead of showing the raw key", () => {
    useAppStore.setState({
      messages: [
        {
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.appStarted",
          detail: null,
        },
      ],
    });
    renderPanel();
    expect(screen.getByText("Application started (offline).")).toBeTruthy();
    expect(screen.queryByText("messages.appStarted")).toBeNull();
  });

  it("renders interpolated params for parameterized messages", () => {
    useAppStore.setState({
      messages: [
        {
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.writeSucceeded",
          params: { address: "12AB" },
          detail: null,
        },
      ],
    });
    renderPanel();
    expect(screen.getByText("Write succeeded (12AB).")).toBeTruthy();
  });

  it("falls back to the raw text for unknown plugin keys", () => {
    useAppStore.setState({
      messages: [
        {
          timestamp: Date.now(),
          level: "info",
          messageKey: "plugin.custom.event",
          detail: null,
        },
      ],
    });
    renderPanel();
    expect(screen.getByText("plugin.custom.event")).toBeTruthy();
  });
});

describe("BottomPanel unseen error dot", () => {
  const errorMessage = (): ApplicationMessage => ({
    timestamp: Date.now(),
    level: "error",
    messageKey: "messages.deviceDisconnected",
    detail: null,
  });

  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "commlog",
          bottomPanelCollapsed: false,
        },
      },
      messages: [],
      commLog: [],
    });
  });

  it("shows an antd Badge dot on the Messages tab when an unseen error arrives while on another tab", () => {
    useAppStore.setState({ messages: [errorMessage()] });
    const { container } = renderPanel();
    expect(
      container.querySelector('.ant-badge-dot[data-show="true"]'),
    ).toBeTruthy();
  });

  it("shows the dot when the panel is collapsed even if the Messages tab is active", () => {
    useAppStore.setState({
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "messages",
          bottomPanelCollapsed: true,
        },
      },
      messages: [errorMessage()],
    });
    const { container } = renderPanel();
    expect(
      container.querySelector('.ant-badge-dot[data-show="true"]'),
    ).toBeTruthy();
  });

  it("does not show the dot while the Messages tab is open", async () => {
    useAppStore.setState({
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "messages",
        },
      },
      messages: [errorMessage()],
    });
    const { container } = renderPanel();
    await waitFor(() => {
      expect(
        container.querySelector('.ant-badge-dot[data-show="true"]'),
      ).toBeNull();
    });
  });

  it("hides the dot after switching to the Messages tab", async () => {
    useAppStore.setState({ messages: [errorMessage()] });
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /Messages/i }));
    await waitFor(() => {
      expect(
        container.querySelector('.ant-badge-dot[data-show="true"]'),
      ).toBeNull();
    });
  });
});

describe("BottomPanel comm log", () => {
  const commEntry = (
    overrides: Partial<CommunicationLogEntry> = {},
  ): CommunicationLogEntry => ({
    timestamp: 1700000000000,
    direction: "request",
    bytesHex: "01 03 00 00 00 01 84 0A",
    protocol: "rtu",
    slaveAddress: 1,
    functionCode: 3,
    userAddress: 0,
    sentAddress: 0,
    quantity: 1,
    attempt: 1,
    status: "success",
    errorCode: null,
    exceptionCode: null,
    source: "row",
    durationMs: 5,
    ...overrides,
  });

  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "commlog",
        },
      },
      messages: [],
      commLog: [],
    });
  });

  it("renders time, direction and raw bytes without function-code fields", () => {
    useAppStore.setState({
      commLog: [
        commEntry({ direction: "request", bytesHex: "01 03 00 00 00 01 84 0A" }),
        commEntry({ direction: "response", bytesHex: "01 03 02 12 34 84 7B" }),
      ],
    });
    renderPanel();
    expect(screen.getByText("01 03 00 00 00 01 84 0A")).toBeTruthy();
    expect(screen.getByText("01 03 02 12 34 84 7B")).toBeTruthy();
    expect(screen.getByText("Request")).toBeTruthy();
    expect(screen.getByText("Response")).toBeTruthy();
    expect(screen.queryByText("Function")).toBeNull();
  });

  it("copy button is disabled when the comm log is empty", () => {
    renderPanel();
    const copyButton = screen.getByRole("button", { name: /Copy/i });
    expect((copyButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("copy button copies formatted bytes through the host port", async () => {
    // 测试桩：仅提供 copyTextToClipboard 的 host，其余能力用断言转为接口类型。
    const copyTextToClipboard = vi
      .fn()
      .mockResolvedValue({ ok: true, value: undefined });
    useAppStore.setState({
      host: {
        copyTextToClipboard,
        getCommProperties: () => null,
      } as unknown as AppHost,
      commLog: [commEntry()],
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await waitFor(() => {
      expect(copyTextToClipboard).toHaveBeenCalledTimes(1);
    });
    const calls = copyTextToClipboard.mock.calls;
    expect(calls).toHaveLength(1);
    const text = String(calls[0]?.[0] ?? "");
    expect(text).toContain("01 03 00 00 00 01 84 0A");
    expect(text).toContain("Request");
    // 复制成功反馈（antd message）。
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
  });

  it("clear button empties the comm log", () => {
    useAppStore.setState({ commLog: [commEntry()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(useAppStore.getState().commLog).toHaveLength(0);
  });
});

describe("BottomPanel properties", () => {
  const fullProperties: CommProperties = {
    portLabel: "COM3",
    baudRate: 19200,
    dataBits: 8,
    stopBits: 1,
    parity: "even",
    flowControl: "rts-cts",
    slaveAddress: 5,
    timeoutMs: 500,
    retryCount: 3,
    rxDelayMs: 100,
    addressAdjust: "on",
    connectionState: "connected",
  };

  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: {
        getCommProperties: () => fullProperties,
      } as unknown as AppHost,
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "properties",
        },
      },
      connectionState: "connected",
      messages: [],
      commLog: [],
    });
  });

  it("renders all 12 communication properties with their values", () => {
    renderPanel();
    expect(screen.getByText("COM3")).toBeTruthy();
    expect(screen.getByText("19200")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("even")).toBeTruthy();
    expect(screen.getByText("RTS/CTS")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("ON")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
  });

  it("lays properties out in 3 columns (12 items across 4 rows)", () => {
    const { container } = renderPanel();
    const rows = container.querySelectorAll(".ant-descriptions tbody tr");
    const items = container.querySelectorAll(".ant-descriptions-item");
    expect(items).toHaveLength(12);
    expect(rows).toHaveLength(4);
    rows.forEach((row) => {
      expect(row.querySelectorAll(".ant-descriptions-item")).toHaveLength(3);
    });
  });
});
