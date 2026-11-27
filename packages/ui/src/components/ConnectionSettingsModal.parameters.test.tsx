import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp } from "antd";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyWorkspace,
} from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { makeHost } from "../test/make-app-host";
import { ConnectionSettingsModal } from "./ConnectionSettingsModal";

beforeEach(() => {
  initI18n();
  useAppStore.setState({
    workspace: createEmptyWorkspace(),
    connectionModalOpen: true,
    connectionState: "disconnected",
    pluginsReady: true,
    connectError: null,
    selectedSerialHandle: { id: "USB", label: "USB" },
  });
});

function renderModal(): void {
  render(
    <AntApp>
      <ConnectionSettingsModal />
    </AntApp>,
  );
}

describe("serial parameter controls", () => {
  it.each(["browser", "electron", "vscode", "android"] as const)(
    "enables XON/XOFF only when %s supports it",
    async (platform) => {
      const user = userEvent.setup();
      const { host } = makeHost({}, { platform });
      useAppStore.setState({ host });
      renderModal();
      await user.click(screen.getByRole("combobox", { name: "Flow Control" }));
      const option = (await screen.findByText("XON/XOFF")).closest(
        ".ant-select-item-option",
      );
      expect(option).not.toBeNull();
      const supported = platform === "vscode" || platform === "android";
      expect(
        option?.classList.contains("ant-select-item-option-disabled"),
      ).toBe(!supported);
      await user.click(screen.getByText("XON/XOFF"));
      await user.click(screen.getByText("Connection Settings"));
      await user.click(screen.getByRole("button", { name: /CONNECT$/ }));
      await waitFor(() => expect(host.connect).toHaveBeenCalled());
      expect(host.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          flowControl: supported ? "xon-xoff" : "off",
        }),
        expect.anything(),
        expect.anything(),
      );
    },
  );

  it.each(["browser", "electron", "vscode", "android"] as const)(
    "shows but prevents selection of 1.5 stop bits on %s",
    async (platform) => {
      const user = userEvent.setup();
      const { host } = makeHost({}, { platform });
      useAppStore.setState({ host });
      renderModal();
      await user.click(screen.getByRole("combobox", { name: "Stop Bit" }));
      const option = await screen.findByText("1.5 BIT");
      expect(
        option
          .closest(".ant-select-item-option")
          ?.classList.contains("ant-select-item-option-disabled"),
      ).toBe(true);
      await user.click(option);
      await user.click(screen.getByText("Connection Settings"));
      await user.click(screen.getByRole("button", { name: /CONNECT$/ }));
      await waitFor(() => expect(host.connect).toHaveBeenCalled());
      expect(host.connect).toHaveBeenCalledWith(
        expect.objectContaining({ stopBits: 1 }),
        expect.anything(),
        expect.anything(),
      );
    },
  );

  it("preserves restored XON/XOFF, blocks connecting, and lets the user choose a supported value", async () => {
    const user = userEvent.setup();
    const { host } = makeHost({}, { platform: "browser" });
    const workspace = createEmptyWorkspace();
    workspace.connectionProfiles = [
      { ...createDefaultRtuProfile(), flowControl: "xon-xoff" },
    ];
    useAppStore.setState({ host, workspace });
    renderModal();
    expect(screen.getByText("XON/XOFF")).toBeTruthy();
    expect(screen.getByRole("button", { name: /CONNECT$/ })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("button", { name: /CONNECT$/ }));
    expect(host.connect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: "Flow Control" }));
    await user.click(await screen.findByText("RTS/CTS"));
    await user.click(screen.getByRole("button", { name: /CONNECT$/ }));
    await waitFor(() =>
      expect(host.connect).toHaveBeenCalledWith(
        expect.objectContaining({ flowControl: "rts-cts" }),
        expect.anything(),
        expect.anything(),
      ),
    );
  });

  it("keeps restored TCP values read-only on the browser and does not replace the profile on close", async () => {
    const user = userEvent.setup();
    const { host } = makeHost({ modbusTcp: false }, { platform: "browser" });
    const workspace = createEmptyWorkspace();
    const profile = {
      ...createDefaultTcpProfile(),
      host: "192.168.1.42",
      port: 1502,
    };
    workspace.connectionProfiles = [profile];
    useAppStore.setState({ host, workspace });
    renderModal();
    const input = screen.getByRole("textbox", { name: "Host / IP" });
    expect(input).toHaveProperty("disabled", true);
    await user.type(input, "bad-host");
    expect(input).toHaveProperty("value", "192.168.1.42");
    expect(screen.getByRole("button", { name: /CONNECT$/ })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("button", { name: /Cancel$/ }));
    await waitFor(() =>
      expect(useAppStore.getState().connectionModalOpen).toBe(false),
    );
    expect(useAppStore.getState().workspace.connectionProfiles).toEqual([
      profile,
    ]);
    expect(host.connectTcp).not.toHaveBeenCalled();
  });
});
