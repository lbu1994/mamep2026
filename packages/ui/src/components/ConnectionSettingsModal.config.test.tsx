/**
 * ConnectionSettingsModal 连接对象配置文件载入测试（ADR-023）：
 * - connectionConfig 能力存在时显示「Load from Config File」分组；
 * - 选择配置文件中的 RTU 连接 → 预填表单 + enumerated 端口自动匹配 + 从站地址同步。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import { createEmptyWorkspace, createMamepError, fail } from "@mamep2026/domain";
import type { ConnectionConfigFile } from "@mamep2026/connection-config";
import type { SerialDeviceHandle } from "@mamep2026/platform-api";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { ConnectionSettingsModal } from "./ConnectionSettingsModal";

function makeHost(config: ConnectionConfigFile | null): {
  host: AppHost;
  selectSerialPort: ReturnType<typeof vi.fn>;
  setSlaveAddress: ReturnType<typeof vi.fn>;
} {
  const selectSerialPort = vi.fn(
    async (): Promise<Result<SerialDeviceHandle | null>> => ({
      ok: true as const,
      value: null,
    }),
  );
  const setSlaveAddress = vi.fn();
  const host: AppHost = {
    capabilities: {
      modbusRtu: true,
      modbusTcp: true,
      serialPorts: "enumerated",
      filesystem: "unsupported",
      nodePlugins: false,
      webPlugins: true,
      connectionConfig: "file",
    } as PlatformCapabilities,
    isMockMode: false,
    pluginRegistry: {} as never,
    appVersion: "0.0.0-test",
    loadWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    resetWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    scheduleSave: vi.fn(),
    getSaveStatus: vi.fn(() => "saved" as const),
    subscribeSaveStatus: vi.fn(() => () => undefined),
    supportsWebSerial: vi.fn(() => false),
    enumerateSerialPorts: vi.fn(
      async () => ({
        ok: true as const,
        value: [{ portId: "COM4", label: "COM4" }],
      }),
    ),
    selectSerialPort,
    connect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    connectTcp: vi.fn(async () => ({ ok: true as const, value: undefined })),
    loadConnectionConfig: vi.fn(async () => ({
      ok: true as const,
      value: { config, sourcePath: config === null ? null : "config/connections.json" },
    })),
    importConnectionConfigText: vi.fn(async () =>
      fail(
        createMamepError({
          code: "CONNECTION_CONFIG_IMPORT_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.connectionConfigImportUnsupported",
          technicalMessage: "not supported",
        }),
      ),
    ),
    disconnect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    dispose: vi.fn(async () => undefined),
    getConnectionState: vi.fn(() => "disconnected" as const),
    getCommProperties: vi.fn(),
    setSlaveAddress,
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
  };
  return { host, selectSerialPort, setSlaveAddress };
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

const configWithRtu: ConnectionConfigFile = {
  schemaVersion: 1,
  activeConnectionId: "rtu-com4",
  connections: [
    {
      id: "rtu-com4",
      name: "COM4 slave",
      protocol: "rtu",
      port: "COM4",
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "off",
      slaveAddress: 3,
      requestTimeoutMs: 1000,
      retryCount: 1,
      interRequestDelayMs: 50,
      addressAdjust: "off",
    },
  ],
};

describe("ConnectionSettingsModal 配置载入（ADR-023）", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({ host: null, connectionModalOpen: false });
  });

  it("connectionConfig === file 时显示「Load from Config File」分组与来源", async () => {
    const { host } = makeHost(configWithRtu);
    renderModal(host);
    await waitFor(() => {
      expect(screen.getByText("Load from Config File")).toBeTruthy();
      expect(screen.getByText(/config\/connections\.json/)).toBeTruthy();
    });
  });

  it("选择配置中的 RTU 连接：自动匹配串口 + 同步从站地址", async () => {
    const { host, selectSerialPort, setSlaveAddress } = makeHost(configWithRtu);
    renderModal(host);
    // 打开「选择配置文件中的连接」下拉并选择 COM4 slave。
    const combobox = await screen.findByRole("combobox", {
      name: "Select a connection from config…",
    });
    fireEvent.mouseDown(combobox);
    const option = await screen.findByText("COM4 slave");
    fireEvent.click(option);
    await waitFor(() => {
      // enumerated 自动 selectPort("COM4")。
      expect(selectSerialPort).toHaveBeenCalledWith("COM4");
      // RTU 载入同步从站地址（配置 slaveAddress=3）。
      expect(setSlaveAddress).toHaveBeenCalledWith(3);
    });
  });

  it("配置文件为空时提示无连接，且不渲染导入按钮（file 能力）", async () => {
    const { host } = makeHost({
      schemaVersion: 1,
      activeConnectionId: null,
      connections: [],
    });
    renderModal(host);
    // 打开下拉：notFoundContent 展示「无连接」。
    const combobox = await screen.findByRole("combobox", {
      name: "Select a connection from config…",
    });
    fireEvent.mouseDown(combobox);
    await waitFor(() => {
      expect(
        screen.getByText("No connections defined in the config file"),
      ).toBeTruthy();
    });
    // file 能力：无「Import JSON…」按钮（导入仅浏览器 import 能力）。
    expect(screen.queryByText("Import JSON…")).toBeNull();
  });
});
