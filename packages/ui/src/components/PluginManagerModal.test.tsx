import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { PluginRegistry } from "@mamep2026/plugin-api";
import type { OpenTextFileResponse } from "@mamep2026/platform-api";
import type { Result } from "@mamep2026/domain";
import type { AppHost } from "../host";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { PluginManagerModal } from "./PluginManagerModal";

// PluginManagerModal 使用 App.useApp()（antd message/modal），测试渲染必须包 <AntApp>。
function renderModal(): ReturnType<typeof render> {
  return render(
    <AntApp>
      <PluginManagerModal />
    </AntApp>,
  );
}

const manifestJson = {
  id: "installed-a",
  name: "Installed A",
  version: "1.0.0",
  description: "A user-installed plugin.",
  author: "Someone",
  platform: { web: true, node: false },
  permissions: ["ui.panel"],
  contributions: { panels: [] },
};

const browserCaps = {
  modbusRtu: true,
  modbusTcp: false,
  serialPorts: "browser-picker",
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
  logExport: "download",
  workspaceImport: "upload",
  workspaceExport: "download",
  pluginInstall: "upload",
} as const;

const desktopCaps = {
  modbusRtu: true,
  modbusTcp: true,
  serialPorts: "enumerated",
  filesystem: "full",
  nodePlugins: false,
  webPlugins: true,
  logExport: "save-dialog",
  workspaceImport: "file",
  workspaceExport: "save-dialog",
  pluginInstall: "file",
} as const;

/** 注入 host 桩：pluginRegistry + 能力矩阵 + 可选 openTextFile。 */
function setHostWithPlugin(
  registry: PluginRegistry,
  overrides: Partial<AppHost> = {},
): void {
  useAppStore.setState({
    host: {
      pluginRegistry: registry,
      capabilities: browserCaps,
      openTextFile: vi.fn(),
      ...overrides,
    } as unknown as AppHost,
    pluginModalOpen: true,
  });
}

/** 触发隐藏文件选择并读取 manifest 文本，等待安全确认框出现。 */
async function pickManifestFile(text: string): Promise<void> {
  const input = screen.getByTestId(
    "plugin-manifest-file-input",
  ) as HTMLInputElement;
  const file = new File([text], "plugin.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(screen.getAllByText("Install this plugin?").length).toBeGreaterThan(0);
  });
}

/** 点击确认框的 OK（antd Modal primary 按钮）。 */
function clickConfirmOk(): void {
  const ok = document.querySelector(".ant-modal .ant-btn-primary");
  expect(ok).not.toBeNull();
  fireEvent.click(ok as HTMLElement);
}

describe("PluginManagerModal", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: useAppStore.getState().workspace,
      pluginModalOpen: false,
    });
  });

  it("shows the empty state when no plugins are registered", () => {
    setHostWithPlugin(new PluginRegistry());
    renderModal();
    expect(screen.getByText("No built-in plugins registered.")).toBeTruthy();
  });

  it("renders author, platform capability and permission labels", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "example-panel",
      name: "Example Panel",
      version: "1.0.0",
      description: "A built-in UI-safe example plugin.",
      author: "Mamep2026 Team",
      platform: { web: true, node: false },
      permissions: ["ui.panel"],
      contributions: { panels: [] },
    });
    setHostWithPlugin(registry);
    renderModal();

    expect(screen.getByText("Author: Mamep2026 Team")).toBeTruthy();
    // 平台能力：Web/Node 双 Tag。
    expect(screen.getByText("Web", { exact: true })).toBeTruthy();
    expect(screen.getByText("Node", { exact: true })).toBeTruthy();
    // 权限：ui.panel → 人类可读标签。
    expect(screen.getByText("UI Panel")).toBeTruthy();
  });

  it("degrades gracefully when author and permissions are absent", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "minimal",
      name: "Minimal",
      version: "0.1.0",
      description: "No author, no permissions.",
      platform: { web: true, node: false },
      permissions: [],
      contributions: { panels: [] },
    });
    setHostWithPlugin(registry);
    renderModal();

    // 作者缺失 → 占位符「—」。
    expect(screen.getByText("Author: —")).toBeTruthy();
    // 权限为空 → 不渲染权限区。
    expect(screen.queryByText(/Permissions/)).toBeNull();
    // 平台 Tag 仍渲染。
    expect(screen.getByText("Web", { exact: true })).toBeTruthy();
  });

  it("marks user-installed plugins with an Installed tag (builtin without)", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "builtin-x",
      name: "Builtin Plugin",
      version: "1.0.0",
      description: "Builtin.",
      platform: { web: true, node: false },
      permissions: [],
      contributions: { panels: [] },
    });
    registry.register(
      {
        id: "installed-x",
        name: "User Plugin",
        version: "1.0.0",
        description: "Installed.",
        platform: { web: true, node: false },
        permissions: [],
        contributions: { panels: [] },
      },
      { source: "installed" },
    );
    setHostWithPlugin(registry);
    renderModal();

    // 用户安装插件行包含「Installed」标签；内置插件行不含。
    const installedRow = screen
      .getByText("User Plugin")
      .closest(".ant-listy-item");
    expect(installedRow?.textContent).toContain("Installed");
    const builtinRow = screen
      .getByText("Builtin Plugin")
      .closest(".ant-listy-item");
    expect(builtinRow?.textContent).not.toContain("Installed");
  });

  describe("安装入口（2026-08-30，PRD §8.3 P1，ADR-038）", () => {
    it("shows the Install Plugin button in the footer", () => {
      setHostWithPlugin(new PluginRegistry());
      renderModal();
      expect(
        screen.getByRole("button", { name: /Install Plugin/i }),
      ).toBeTruthy();
    });

    it("browser (upload): file pick → security confirm → confirm registers installed plugin", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await pickManifestFile(JSON.stringify(manifestJson));

      // 安全确认展示来源/版本/权限/平台（§6.10.4）。
      expect(screen.getAllByText("Install this plugin?").length).toBeGreaterThan(
        0,
      );
      expect(screen.getByText("Installed A")).toBeTruthy();
      expect(screen.getByText("1.0.0")).toBeTruthy();
      expect(screen.getByText("UI Panel")).toBeTruthy();

      clickConfirmOk();

      await waitFor(() => {
        expect(registry.list()).toHaveLength(1);
        expect(registry.getSource("installed-a")).toBe("installed");
      });
      // 安装成功提示。
      await waitFor(() => {
        expect(screen.getByText("Plugin installed.")).toBeTruthy();
      });
    });

    it("browser (upload): invalid JSON shows an error and does not register", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      const input = screen.getByTestId(
        "plugin-manifest-file-input",
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            new File(["{ not-json"], "bad.json", { type: "application/json" }),
          ],
        },
      });

      await waitFor(() => {
        expect(screen.getByText("The plugin manifest is invalid.")).toBeTruthy();
      });
      expect(registry.list()).toHaveLength(0);
    });

    it("browser (upload): schema-invalid manifest shows an error and does not register", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      const input = screen.getByTestId(
        "plugin-manifest-file-input",
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            new File(
              [JSON.stringify({ id: "x" })],
              "bad-schema.json",
              { type: "application/json" },
            ),
          ],
        },
      });
      await waitFor(() => {
        expect(screen.getByText("The plugin manifest is invalid.")).toBeTruthy();
      });
      // 确认框不会出现（校验失败直接报错）。
      expect(screen.queryByText("Install this plugin?")).toBeNull();
      expect(registry.list()).toHaveLength(0);
    });

    it("browser (upload): node-only plugin rejected before confirm (platform guard)", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      const input = screen.getByTestId(
        "plugin-manifest-file-input",
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            new File(
              [
                JSON.stringify({
                  ...manifestJson,
                  platform: { web: false, node: true },
                }),
              ],
              "node-only.json",
              { type: "application/json" },
            ),
          ],
        },
      });

      await waitFor(() => {
        expect(
          screen.getByText(/requires a platform not supported/i),
        ).toBeTruthy();
      });
      expect(registry.list()).toHaveLength(0);
    });

    it("cancel on security confirm does not register", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await pickManifestFile(JSON.stringify(manifestJson));
      // 点击确认框的取消按钮（.ant-btn-default）。
      const cancel = document.querySelector(".ant-modal .ant-btn-default");
      expect(cancel).not.toBeNull();
      fireEvent.click(cancel as HTMLElement);
      await waitFor(() => {
        expect(registry.list()).toHaveLength(0);
      });
    });

    it("desktop (file): openTextFile content → security confirm → register", async () => {
      const registry = new PluginRegistry();
      const openTextFile = vi.fn(
        async (): Promise<Result<OpenTextFileResponse>> => ({
          ok: true,
          value: { content: JSON.stringify(manifestJson) },
        }),
      );
      setHostWithPlugin(registry, {
        capabilities: desktopCaps,
        openTextFile,
      });
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await waitFor(() => {
        expect(openTextFile).toHaveBeenCalledWith({
          suggestedName: "plugin-manifest.json",
        });
      });
      await waitFor(() => {
        expect(screen.getAllByText("Install this plugin?").length).toBeGreaterThan(
          0,
        );
      });
      clickConfirmOk();
      await waitFor(() => {
        expect(registry.getSource("installed-a")).toBe("installed");
      });
    });

    it("desktop (file): user cancel (content null) is a no-op", async () => {
      const registry = new PluginRegistry();
      const openTextFile = vi.fn(
        async (): Promise<Result<OpenTextFileResponse>> => ({
          ok: true,
          value: { content: null },
        }),
      );
      setHostWithPlugin(registry, { capabilities: desktopCaps, openTextFile });
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await waitFor(() => {
        expect(openTextFile).toHaveBeenCalled();
      });
      expect(registry.list()).toHaveLength(0);
    });

    it("unsupported capability shows an error and does nothing", async () => {
      const registry = new PluginRegistry();
      const openTextFile = vi.fn();
      setHostWithPlugin(registry, {
        capabilities: {
          modbusRtu: false,
          modbusTcp: false,
          serialPorts: "unsupported",
          filesystem: "unsupported",
          nodePlugins: false,
          webPlugins: false,
          logExport: "unsupported",
          workspaceImport: "unsupported",
          workspaceExport: "unsupported",
          pluginInstall: "unsupported",
        },
        openTextFile,
      });
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await waitFor(() => {
        expect(
          screen.getByText(/Plugin installation is not supported/i),
        ).toBeTruthy();
      });
      expect(openTextFile).not.toHaveBeenCalled();
      expect(registry.list()).toHaveLength(0);
    });
  });
});

