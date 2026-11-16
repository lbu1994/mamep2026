import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { browserCapabilities } from "@mamep2026/domain";
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

describe("BottomPanel activeBottomTab 失效指向兜底（2026-09-17）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({ host: null, messages: [], commLog: [] });
  });

  it("指向已不存在的页签（如插件卸载后残留 plugins）→ 回退 Messages 并纠正持久化", async () => {
    useAppStore.setState({
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "plugins",
        },
      },
    });

    renderPanel();

    // 不出现空内容区：活动页签回到 Messages。
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Messages",
    );
    // 纠正写回持久化（不残留无效值）。
    await waitFor(() => {
      expect(useAppStore.getState().workspace.panelLayout.activeBottomTab).toBe(
        "messages",
      );
    });
  });

  it("指向有效页签时不改动持久化值", () => {
    useAppStore.setState({
      workspace: {
        ...useAppStore.getState().workspace,
        panelLayout: {
          ...useAppStore.getState().workspace.panelLayout,
          activeBottomTab: "properties",
        },
      },
    });

    renderPanel();

    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Comm Properties",
    );
    expect(useAppStore.getState().workspace.panelLayout.activeBottomTab).toBe(
      "properties",
    );
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
  let nextSeq = 0;
  const commEntry = (
    overrides: Partial<CommunicationLogEntry> = {},
  ): CommunicationLogEntry => ({
    seq: nextSeq++,
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
        commEntry({
          direction: "request",
          bytesHex: "01 03 00 00 00 01 84 0A",
        }),
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
        capabilities: browserCapabilities,
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

  it("clipboard capability=false does not call the clipboard port", async () => {
    const copyTextToClipboard = vi.fn();
    useAppStore.setState({
      host: {
        capabilities: { ...browserCapabilities, clipboard: false },
        copyTextToClipboard,
        getCommProperties: () => null,
      } as unknown as AppHost,
      commLog: [commEntry()],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    await waitFor(() => {
      expect(
        screen.getByText("System clipboard is not available."),
      ).toBeTruthy();
    });
    expect(copyTextToClipboard).not.toHaveBeenCalled();
  });

  it("clear button empties the comm log", () => {
    useAppStore.setState({ commLog: [commEntry()] });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(useAppStore.getState().commLog).toHaveLength(0);
  });

  it("export button is disabled when the comm log is empty", () => {
    renderPanel();
    const exportButton = screen.getByRole("button", { name: /Export/i });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("export asks for privacy confirmation and saves CSV through the host port", async () => {
    const saveTextFile = vi.fn().mockResolvedValue({
      ok: true,
      value: { saved: true, filePath: null },
    });
    useAppStore.setState({
      host: {
        saveTextFile,
        getCommProperties: () => null,
      } as unknown as AppHost,
      commLog: [commEntry({ bytesHex: "01 03 00 64 00 01 85 F2" })],
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Export/i }));
    // 隐私确认对话框出现（PRD §15.3.6）。antd v6 确认框标题同时渲染
    // .ant-modal-title 与 .ant-modal-confirm-title 两个节点，用 getAllByText 断言。
    await waitFor(() => {
      expect(
        screen.getAllByText("Export communication log?").length,
      ).toBeGreaterThan(0);
    });
    // 确认导出（antd Modal OK 按钮）。
    fireEvent.click(
      document.querySelector(".ant-modal .ant-btn-primary") as HTMLElement,
    );
    await waitFor(() => {
      expect(saveTextFile).toHaveBeenCalledTimes(1);
    });
    const call = saveTextFile.mock.calls[0]?.[0] as {
      suggestedName: string;
      content: string;
      mimeType: string;
    };
    expect(call.mimeType).toBe("text/csv");
    expect(call.suggestedName).toMatch(/^comm-log-rtu-\d{8}-\d{6}\.csv$/);
    expect(call.content).toContain("seq,timestamp,direction,protocol");
    expect(call.content).toContain("01 03 00 64 00 01 85 F2");
    // 导出成功反馈。
    await waitFor(() => {
      expect(screen.getByText("Exported")).toBeTruthy();
    });
  });

  it("export reports a failure when the host port fails", async () => {
    const saveTextFile = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "SAVE_TEXT_FILE_FAILED", technicalMessage: "denied" },
    });
    useAppStore.setState({
      host: {
        saveTextFile,
        getCommProperties: () => null,
      } as unknown as AppHost,
      commLog: [commEntry()],
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Export/i }));
    await waitFor(() => {
      expect(
        screen.getAllByText("Export communication log?").length,
      ).toBeGreaterThan(0);
    });
    fireEvent.click(
      document.querySelector(".ant-modal .ant-btn-primary") as HTMLElement,
    );
    await waitFor(() => {
      expect(screen.getByText("Export failed")).toBeTruthy();
    });
  });

  it("export reports a cancel when the user dismisses the save dialog", async () => {
    const saveTextFile = vi.fn().mockResolvedValue({
      ok: true,
      value: { saved: false, filePath: null },
    });
    useAppStore.setState({
      host: {
        saveTextFile,
        getCommProperties: () => null,
      } as unknown as AppHost,
      commLog: [commEntry()],
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Export/i }));
    await waitFor(() => {
      expect(
        screen.getAllByText("Export communication log?").length,
      ).toBeGreaterThan(0);
    });
    fireEvent.click(
      document.querySelector(".ant-modal .ant-btn-primary") as HTMLElement,
    );
    await waitFor(() => {
      expect(screen.getByText("Export cancelled")).toBeTruthy();
    });
  });
});

describe("BottomPanel properties", () => {
  const fullProperties: CommProperties = {
    protocol: "rtu",
    portLabel: "COM3",
    unitId: null,
    baudRate: 19200,
    dataBits: 8,
    stopBits: 1,
    parity: "even",
    flowControl: "rts-cts",
    timeoutMs: 500,
    retryCount: 3,
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

  it("renders all 9 communication properties with their values", () => {
    renderPanel();
    expect(screen.getByText("COM3")).toBeTruthy();
    expect(screen.getByText("19200")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("even")).toBeTruthy();
    expect(screen.getByText("RTS/CTS")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
  });

  it("lays properties out in 3 columns (9 items across 3 rows)", () => {
    const { container } = renderPanel();
    const rows = container.querySelectorAll(".ant-descriptions tbody tr");
    const items = container.querySelectorAll(".ant-descriptions-item");
    expect(items).toHaveLength(9);
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(
        row.querySelectorAll(".ant-descriptions-item").length,
      ).toBeLessThanOrEqual(3);
    });
    // 3 行均 3 项（9 = 3×3）。
    expect(rows[2]?.querySelectorAll(".ant-descriptions-item")).toHaveLength(3);
  });
});
