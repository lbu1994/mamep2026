/**
 * ConnectionSettingsModal TCP 分组测试（2026-08-23 两端 TCP 接线）：
 * - 能力门控：modbusTcp=true 显示 TCP 协议选项；false（浏览器）不显示 TCP 入口；
 * - TCP 表单：切换协议后展示 host/port/unitId/超时/重试 + autoReconnect 开关（2026-08-30 启用）；
 * - CONNECT 路由：TCP 走 host.connectTcp（携带 TCP profile，含 autoReconnect），空 host 校验阻止提交。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { PluginRegistry } from "@mamep2026/plugin-api";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { ConnectionSettingsModal } from "./ConnectionSettingsModal";

function makeHost(
  caps: Partial<PlatformCapabilities>,
): { host: AppHost; connectTcp: ReturnType<typeof vi.fn> } {
  const connectTcp = vi.fn(
    async (): Promise<Result<void>> => ({ ok: true as const, value: undefined }),
  );
  const host: AppHost = {
    capabilities: {
      modbusRtu: true,
      modbusTcp: true,
      serialPorts: "enumerated",
      filesystem: "unsupported",
      nodePlugins: false,
      webPlugins: true,
      logExport: "save-dialog",
      workspaceImport: "upload",
      workspaceExport: "download",
      pluginInstall: "upload",
      executablePlugins: false,
      hostPlugins: false,
      protocolExtensions: [],
      tableTypes: ["holding-register"],
      ...caps,
    },
    isMockMode: false,
    // 真实注册表（Phase C：ConnectionSettingsModal 经 usePluginContributions 读取 tableType
    // 贡献，空对象 mock 缺 getVersion 会崩）。
    pluginRegistry: new PluginRegistry(),
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
      async () => ({ ok: true as const, value: [] as never[] }),
    ),
    selectSerialPort: vi.fn(async () => ({ ok: true as const, value: null })),
    connect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    connectTcp,
    disconnect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    dispose: vi.fn(async () => undefined),
    getConnectionState: vi.fn(() => "disconnected" as const),
    getSession: vi.fn(() => null),
    createPluginRemoteRuntime: vi.fn(),
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
    // 插件运行时桥（2026-08-31，ADR-039：Phase A 契约，测试不实际调用）。
    pluginRuntimeLoad: vi.fn(async () => ({ ok: true as const, value: null })),
    pluginRuntimeUnload: vi.fn(
      async () => ({ ok: true as const, value: null }),
    ),
    pluginRpc: vi.fn(async () => ({ ok: true as const, value: null })),
    pluginContributionQuery: vi.fn(
      async () => ({ ok: true as const, value: { points: [] } }),
    ),
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
    initI18n();
    useAppStore.setState({ host: null, connectionModalOpen: false });
  });

  it("TCP 能力开启：显示协议切换，切换到 TCP 展示 host/port/unitId 表单", async () => {
    const { host } = makeHost({});
    renderModal(host);
    // 协议 Segmented 含 RTU 与 TCP 选项。
    expect(screen.getByText("Modbus TCP")).toBeTruthy();
    // 切换到 TCP。
    fireEvent.click(screen.getByText("Modbus TCP"));
    await waitFor(() => {
      expect(screen.getByText("Host / IP")).toBeTruthy();
      expect(screen.getByText("TCP Port")).toBeTruthy();
      expect(screen.getByText("Unit ID")).toBeTruthy();
      expect(screen.getByPlaceholderText("192.168.1.10")).toBeTruthy();
    });
    // TCP 模式下 InputNumber 控件：port / unitId / timeout / retry。
    expect(screen.getAllByRole("spinbutton")).toHaveLength(4);
    // autoReconnect 开关可用（2026-08-30 落地，PRD §8.3 P1）。
    const switchEl = screen.getByRole("switch");
    expect(switchEl).toBeTruthy();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });

  it("TCP 能力关闭（浏览器）：不显示 TCP 入口，避免必然失败的入口", () => {
    const { host } = makeHost({ modbusTcp: false });
    renderModal(host);
    expect(screen.queryByText("Modbus TCP")).toBeNull();
    expect(screen.getByText("Modbus RTU")).toBeTruthy();
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
    const spinbuttons = screen.getAllByRole("spinbutton");
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
