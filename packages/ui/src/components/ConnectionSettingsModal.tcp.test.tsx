import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App as AntApp } from "antd";
import userEvent from "@testing-library/user-event";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import { browserCapabilities, createEmptyWorkspace } from "@mamep2026/domain";
import { PluginRegistry } from "@mamep2026/plugin-api";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { ConnectionSettingsModal } from "./ConnectionSettingsModal";

function makeHost(caps: Partial<PlatformCapabilities>): {
  host: AppHost;
  connectTcp: ReturnType<typeof vi.fn>;
} {
  const connectTcp = vi.fn(async (): Promise<Result<void>> => ({
    ok: true as const,
    value: undefined,
  }));
  /** 插件入口加载失败桩（本测试不使用插件安装流程）。 */
  const pluginEntryUnavailable = async () => ({
    ok: false as const,
    error: {
      code: "PLUGIN_LOAD_FAILED",
      category: "plugin" as const,
      severity: "error" as const,
      retryable: false,
      userMessageKey: "errors.pluginLoadFailed",
      technicalMessage: "test stub",
    },
  });
  const host: AppHost = {
    capabilities: {
      ...browserCapabilities,
      modbusTcp: true,
      serialPorts: "enumerated",
      filesystem: "unsupported",
      logExport: "save-dialog",
      workspaceImport: "upload",
      workspaceExport: "download",
      executablePlugins: false,
      protocolExtensions: [],
      tableTypes: ["holding-register"],
      ...caps,
    },
    isMockMode: false,
    // 真实注册表（ConnectionSettingsModal 经 usePluginContributions 读取 tableType
    // 贡献，空对象 mock 缺 getVersion 会崩）。
    pluginRegistry: new PluginRegistry(),
    appVersion: "0.0.0-test",
    platform: "browser",
    // 安装入口为「预览 + 安装」两步。
    startPlugins: vi.fn(async () => undefined),
    previewPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
    setPluginEnabled: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    installPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
    loadWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    resetWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    scheduleSave: vi.fn(),
    flush: vi.fn(async () => ({ ok: true as const, value: undefined })),
    getWorkspaceRecoveryInfo: vi.fn(() => null),
    getSaveStatus: vi.fn(() => "saved" as const),
    subscribeSaveStatus: vi.fn(() => () => undefined),
    supportsWebSerial: vi.fn(() => false),
    browserCompatibility: null,
    enumerateSerialPorts: vi.fn(async () => ({
      ok: true as const,
      value: [] as never[],
    })),
    selectSerialPort: vi.fn(async () => ({ ok: true as const, value: null })),
    connect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    connectTcp,
    disconnect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    dispose: vi.fn(async () => undefined),
    getConnectionState: vi.fn(() => "disconnected" as const),
    getSession: vi.fn(() => null),
    getCommProperties: vi.fn(),
    setSlaveAddress: vi.fn(),
    setAddressTransform: vi.fn(),
    subscribeConnectionState: vi.fn(() => () => undefined),
    readRow: vi.fn(),
    writeRow: vi.fn(),
    readAllRows: vi.fn(),
    updatePollingTargets: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    subscribePollResult: vi.fn(() => () => undefined),
    traceStart: vi.fn(),
    traceStop: vi.fn(),
    subscribeTraceSample: vi.fn(() => () => undefined),
    subscribeCommLog: vi.fn(() => () => undefined),
    subscribeMessage: vi.fn(() => () => undefined),
    pushMessage: vi.fn(),
    copyTextToClipboard: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    readTextFromClipboard: vi.fn(async () => ({
      ok: true as const,
      value: null,
    })),
    saveTextFile: vi.fn(async () => ({
      ok: true as const,
      value: { saved: true, filePath: null },
    })),
    openTextFile: vi.fn(async () => ({
      ok: true as const,
      value: { content: null },
    })),
    // 插件运行时桥（契约，测试不实际调用）。
    pluginRuntimeLoad: vi.fn(async () => ({ ok: true as const, value: null })),
    pluginRuntimeUnload: vi.fn(async () => ({
      ok: true as const,
      value: null,
    })),
    pluginRpc: vi.fn(async () => ({ ok: true as const, value: null })),
    pluginContributionQuery: vi.fn(async () => ({
      ok: true as const,
      value: { points: [] },
    })),
  };
  return { host, connectTcp };
}

function renderModal(host: AppHost): void {
  useAppStore.setState({
    host,
    connectionModalOpen: true,
    workspace: useAppStore.getState().workspace,
  });
  render(
    <AntApp>
      <ConnectionSettingsModal />
    </AntApp>,
  );
}

describe("ConnectionSettingsModal TCP（2026-08-23）", () => {
  beforeEach(() => {
    cleanup();
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: { ...createEmptyWorkspace(), connectionProfiles: [] },
      connectionModalOpen: false,
      pluginsReady: true,
    });
  });

  it("TCP 能力开启：显示协议切换，切换到 TCP 展示 host/port/unitId 表单", async () => {
    const { host } = makeHost({});
    renderModal(host);
    // 协议 Segmented 含 RTU 与 TCP 选项。
    expect(screen.getByText("Modbus TCP")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Modbus RTU" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Modbus TCP" })).toBeNull();
    // 切换到 TCP。
    fireEvent.click(screen.getByText("Modbus TCP"));
    await waitFor(() => {
      expect(screen.getByText("Host / IP")).toBeTruthy();
      expect(screen.getByText("TCP Port")).toBeTruthy();
      expect(screen.getByText("Unit ID")).toBeTruthy();
      expect(screen.getByPlaceholderText("192.168.1.10")).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Modbus RTU" })).toBeNull();
    });
    // TCP 模式下 InputNumber 控件：port / unitId / timeout / retry。
    expect(
      within(screen.getByRole("region", { name: "Modbus TCP" })).getAllByRole(
        "spinbutton",
      ),
    ).toHaveLength(4);
    // autoReconnect 开关可用（落地，PRD §8.3 P1）。
    const switchEl = screen.getByRole("switch");
    expect(switchEl).toBeTruthy();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the unsupported TCP option disabled without rendering its parameters", () => {
    const { host } = makeHost({ modbusTcp: false });
    renderModal(host);
    expect(screen.getByText("Protocol")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Modbus TCP" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("region", { name: "Modbus TCP" })).toBeNull();
    fireEvent.click(screen.getByText("Modbus TCP"));
    expect(screen.getByRole("radio", { name: "Modbus RTU" })).toHaveProperty(
      "checked",
      true,
    );
    expect(host.connectTcp).not.toHaveBeenCalled();
  });

  it("keeps the RTU option disabled and shows only TCP parameters on a TCP-only host", () => {
    const { host } = makeHost({
      modbusRtu: false,
      modbusTcp: true,
      serialPorts: "unsupported",
    });
    renderModal(host);
    expect(screen.getByRole("radio", { name: "Modbus RTU" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("radio", { name: "Modbus TCP" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.queryByRole("region", { name: "Modbus RTU" })).toBeNull();
    expect(screen.getByPlaceholderText("192.168.1.10")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByText("CONNECT").closest("button")).toHaveProperty(
      "disabled",
      false,
    );
    expect(host.selectSerialPort).not.toHaveBeenCalled();
  });

  it.each(["rtu", "tcp"] as const)(
    "preserves edited values and serial selection across switches before connecting with %s",
    async (targetProtocol) => {
      const user = userEvent.setup();
      const { host } = makeHost({});
      const handle = { id: "USB", label: "USB" };
      useAppStore.setState({
        connectionState: "disconnected",
        selectedSerialHandle: handle,
        selectedSerialPortId: "USB",
        connectError: null,
      });
      renderModal(host);
      await user.click(screen.getByRole("combobox", { name: "Speed" }));
      await user.click(
        await screen.findByText("19200", {
          selector: ".ant-select-item-option-content",
        }),
      );
      await user.click(screen.getByRole("combobox", { name: "Timeout (ms)" }));
      await user.type(
        screen.getByRole("combobox", { name: "Timeout (ms)" }),
        "80",
      );
      await user.click(
        await screen.findByText("80 ms", {
          selector: ".ant-select-item-option-content",
        }),
      );
      fireEvent.change(screen.getByRole("spinbutton"), {
        target: { value: "3" },
      });

      await user.click(screen.getByText("Modbus TCP"));
      expect(screen.queryByRole("region", { name: "Modbus RTU" })).toBeNull();
      fireEvent.change(screen.getByRole("textbox", { name: "Host / IP" }), {
        target: { value: "192.168.1.42" },
      });
      fireEvent.change(screen.getByRole("spinbutton", { name: "TCP Port" }), {
        target: { value: "1502" },
      });
      fireEvent.change(screen.getByRole("spinbutton", { name: "Unit ID" }), {
        target: { value: "7" },
      });
      fireEvent.change(
        screen.getByRole("spinbutton", { name: "Timeout (ms)" }),
        {
          target: { value: "1500" },
        },
      );
      expect(screen.getByRole("spinbutton", { name: "" })).toHaveProperty(
        "value",
        "3",
      );
      fireEvent.change(screen.getByRole("spinbutton", { name: "" }), {
        target: { value: "4" },
      });
      await user.click(screen.getByRole("switch"));

      await user.click(screen.getByText("Modbus RTU"));
      expect(screen.queryByRole("region", { name: "Modbus TCP" })).toBeNull();
      expect(screen.getByText("19200")).toBeTruthy();
      expect(screen.getByText("80 ms")).toBeTruthy();
      expect(screen.getByRole("spinbutton")).toHaveProperty("value", "4");
      expect(useAppStore.getState().selectedSerialHandle).toEqual(handle);
      expect(useAppStore.getState().selectedSerialPortId).toBe("USB");
      expect(host.selectSerialPort).not.toHaveBeenCalled();
      expect(host.connect).not.toHaveBeenCalled();
      expect(host.connectTcp).not.toHaveBeenCalled();

      if (targetProtocol === "tcp") {
        await user.click(screen.getByText("Modbus TCP"));
        expect(
          screen.getByRole("textbox", { name: "Host / IP" }),
        ).toHaveProperty("value", "192.168.1.42");
        expect(
          screen.getByRole("spinbutton", { name: "TCP Port" }),
        ).toHaveProperty("value", "1502");
        expect(
          screen.getByRole("spinbutton", { name: "Unit ID" }),
        ).toHaveProperty("value", "7");
        expect(
          screen.getByRole("spinbutton", { name: "Timeout (ms)" }),
        ).toHaveProperty("value", "1500");
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
          "true",
        );
      }
      await user.click(screen.getByRole("button", { name: /CONNECT$/ }));
      if (targetProtocol === "tcp") {
        await waitFor(() =>
          expect(host.connectTcp).toHaveBeenCalledWith(
            expect.objectContaining({
              protocol: "tcp",
              host: "192.168.1.42",
              port: 1502,
              unitId: 7,
              requestTimeoutMs: 1500,
              retryCount: 4,
              autoReconnect: true,
            }),
          ),
        );
        expect(host.connect).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(host.connect).toHaveBeenCalledWith(
            expect.objectContaining({
              protocol: "rtu",
              baudRate: 19200,
              requestTimeoutMs: 80,
              retryCount: 4,
            }),
            handle,
            { protocol: "rtu" },
          ),
        );
        expect(host.connectTcp).not.toHaveBeenCalled();
      }
    },
  );

  it("仅 TCP 能力：CONNECT 直接走 host.connectTcp（不要求先选串口）", async () => {
    const { host, connectTcp } = makeHost({
      modbusRtu: false,
      modbusTcp: true,
      serialPorts: "unsupported",
    });
    renderModal(host);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("192.168.1.10")).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), {
      target: { value: "192.168.1.50" },
    });
    fireEvent.click(screen.getByText("CONNECT"));

    await waitFor(() => expect(connectTcp).toHaveBeenCalled());
    const profile = connectTcp.mock.calls[0]?.[0] as {
      protocol: string;
      host: string;
    };
    expect(profile.protocol).toBe("tcp");
    expect(profile.host).toBe("192.168.1.50");
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("TCP CONNECT 走 host.connectTcp 并携带 TCP profile", async () => {
    const { host, connectTcp } = makeHost({});
    renderModal(host);
    fireEvent.click(screen.getByText("Modbus TCP"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("192.168.1.10")).toBeTruthy(),
    );
    // 填写 host/port/unitId（port=spinbutton[0]，unitId=spinbutton[1]）。
    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), {
      target: { value: "192.168.1.10" },
    });
    const spinbuttons = within(
      screen.getByRole("region", { name: "Modbus TCP" }),
    ).getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[0] ?? document.body, {
      target: { value: "502" },
    });
    fireEvent.change(spinbuttons[1] ?? document.body, {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("CONNECT"));
    await waitFor(() => expect(connectTcp).toHaveBeenCalled());
    const profile = connectTcp.mock.calls[0]?.[0] as {
      protocol: string;
      host: string;
      port: number;
      unitId: number;
      autoReconnect: boolean;
    };
    expect(profile.protocol).toBe("tcp");
    expect(profile.host).toBe("192.168.1.10");
    expect(profile.port).toBe(502);
    expect(profile.unitId).toBe(1);
    // autoReconnect 默认 false 并随表单透传。
    expect(profile.autoReconnect).toBe(false);
  });

  it("开启 autoReconnect 开关：CONNECT 携带 profile.autoReconnect=true", async () => {
    const { host, connectTcp } = makeHost({});
    renderModal(host);
    fireEvent.click(screen.getByText("Modbus TCP"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("192.168.1.10")).toBeTruthy(),
    );
    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), {
      target: { value: "192.168.1.10" },
    });
    // 打开 autoReconnect 开关。
    const switchEl = screen.getByRole("switch");
    fireEvent.click(switchEl);
    await waitFor(() =>
      expect(switchEl.getAttribute("aria-checked")).toBe("true"),
    );
    fireEvent.click(screen.getByText("CONNECT"));
    await waitFor(() => expect(connectTcp).toHaveBeenCalled());
    const profile = connectTcp.mock.calls[0]?.[0] as {
      protocol: string;
      autoReconnect: boolean;
    };
    expect(profile.protocol).toBe("tcp");
    expect(profile.autoReconnect).toBe(true);
  });

  it("TCP 空 host：校验阻止提交，connectTcp 不被调用", async () => {
    const { host, connectTcp } = makeHost({});
    renderModal(host);
    fireEvent.click(screen.getByText("Modbus TCP"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("192.168.1.10")).toBeTruthy(),
    );
    // host 保持为空，直接 CONNECT。
    fireEvent.click(screen.getByText("CONNECT"));
    await waitFor(() => expect(connectTcp).not.toHaveBeenCalled());
  });
});
