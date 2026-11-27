import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App as AntApp, ConfigProvider } from "antd";
import { PluginRegistry, type PluginManifest } from "@mamep2026/plugin-api";
import type { OpenTextFileResponse } from "@mamep2026/platform-api";
import { browserCapabilities, type Result } from "@mamep2026/domain";
import type { AppHost } from "../host";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { PluginManagerSection } from "./PluginManagerSection";

// PluginManagerSection 使用 App.useApp()（antd message/modal），测试渲染必须包 <AntApp>。
// 插件管理为 Settings「Plugins」页签内的内联区块，无需开合状态。
function renderSection(): ReturnType<typeof render> {
  return render(
    <AntApp>
      <PluginManagerSection />
    </AntApp>,
  );
}

it("updates host errors reactively and reloads without reinstalling", async () => {
  await initI18n("en-US");
  const registry = new PluginRegistry();
  registry.register(manifestJson, { source: "installed" });
  const reloadHostPlugin = vi.fn(async () => {
    registry.applyHostSnapshot({
      schemaVersion: 1,
      revision: 2,
      error: null,
      plugins: [
        {
          pluginId: manifestJson.id,
          generation: 2,
          contentDigest: null,
          stage: "active",
          contributions: {
            protocolIds: [],
            dataTypeIds: [],
            addressTransformIds: [],
          },
          errors: [],
        },
      ],
    });
    return { ok: true as const, value: undefined };
  });
  setHostWithPlugin(registry, { reloadHostPlugin });
  renderSection();
  act(() =>
    registry.applyHostSnapshot({
      schemaVersion: 1,
      revision: 1,
      error: null,
      plugins: [
        {
          pluginId: manifestJson.id,
          generation: 1,
          contentDigest: null,
          stage: "failed",
          contributions: {
            protocolIds: [],
            dataTypeIds: [],
            addressTransformIds: [],
          },
          errors: [
            {
              code: "PLUGIN_LOAD_FAILED",
              technicalMessage: "Host dependency unavailable",
            },
          ],
        },
      ],
    }),
  );
  expect(screen.getByText(/Host dependency unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reload on host" }));
  await waitFor(() => expect(screen.getByText("Host: active")).toBeTruthy());
  expect(reloadHostPlugin).toHaveBeenCalledWith(manifestJson.id);
  expect(screen.queryByText(/Host dependency unavailable/)).toBeNull();
  expect(registry.isEnabled(manifestJson.id)).toBe(true);
});

const manifestJson: PluginManifest = {
  id: "installed-a",
  name: "Installed A",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "A user-installed plugin.",
  author: "Someone",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["ui-contribution"],
  contributes: { panels: [] },
};

const browserCaps = {
  ...browserCapabilities,
  executablePlugins: false,
  protocolExtensions: [],
  tableTypes: ["holding-register"],
} as const;

const desktopCaps = {
  ...browserCapabilities,
  modbusTcp: true,
  serialPorts: "enumerated",
  filesystem: "full",
  logExport: "save-dialog",
  workspaceImport: "file",
  workspaceExport: "save-dialog",
  pluginInstall: "file",
  executablePlugins: false,
  backgroundLifecycle: false,
  protocolExtensions: [],
  tableTypes: ["holding-register"],
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
      // 安装入口为「预览 + 安装」两步（host 承担 entry 加载）。
      startPlugins: vi.fn(async () => undefined),
      previewPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
      setPluginEnabled: vi.fn(async (id: string, enabled: boolean) => {
        registry.setEnabled(id, enabled);
        return { ok: true as const, value: undefined };
      }),
      installPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
      ...overrides,
    } as unknown as AppHost,
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
    expect(screen.getAllByText("Install this plugin?").length).toBeGreaterThan(
      0,
    );
  });
}

/** 触发隐藏文件选择并读取单文件 JS 插件，等待安全确认框出现。 */
async function pickPluginSourceFile(
  text: string,
  name = "plugin.mjs",
): Promise<void> {
  const input = screen.getByTestId(
    "plugin-manifest-file-input",
  ) as HTMLInputElement;
  const file = new File([text], name, { type: "text/javascript" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(screen.getAllByText("Install this plugin?").length).toBeGreaterThan(
      0,
    );
  });
}

/** 插件入口加载失败的结构化错误（默认为测试桩）。 */
function pluginEntryUnavailable() {
  return {
    ok: false as const,
    error: {
      code: "PLUGIN_LOAD_FAILED",
      category: "plugin" as const,
      severity: "error" as const,
      retryable: false,
      userMessageKey: "errors.pluginLoadFailed",
      technicalMessage: "test stub",
    },
  };
}

/** 点击确认框的 OK（antd Modal primary 按钮）。 */
function clickConfirmOk(): void {
  const ok = document.querySelector(".ant-modal .ant-btn-primary");
  expect(ok).not.toBeNull();
  fireEvent.click(ok as HTMLElement);
}

describe("PluginManagerSection", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: useAppStore.getState().workspace,
    });
  });

  it("shows the empty state when no plugins are registered", () => {
    setHostWithPlugin(new PluginRegistry());
    renderSection();
    expect(screen.getByText("No plugins installed.")).toBeTruthy();
  });

  it("renders author, platform capability and permission labels", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "example-panel",
      name: "Example Panel",
      version: "1.0.0",
      apiVersion: "2.0",
      description: "A built-in UI-safe example plugin.",
      author: "Mamep2026 Team",
      platform: { web: true, node: false },
      permissions: ["ui-contribution"],
      contributes: { panels: [] },
    });
    setHostWithPlugin(registry);
    renderSection();

    expect(screen.getByText("Author: Mamep2026 Team")).toBeTruthy();
    // 平台能力：Web/Node 双 Tag。
    expect(screen.getByText("Web", { exact: true })).toBeTruthy();
    expect(screen.getByText("Node", { exact: true })).toBeTruthy();
    // 权限：ui-contribution → 人类可读标签。
    expect(screen.getByText("UI Contribution")).toBeTruthy();
  });

  it("degrades gracefully when author and permissions are absent", () => {
    const registry = new PluginRegistry();
    registry.register({
      id: "minimal",
      name: "Minimal",
      version: "0.1.0",
      apiVersion: "2.0",
      description: "No author, no permissions.",
      platform: { web: true, node: false },
      permissions: [],
      contributes: { panels: [] },
    });
    setHostWithPlugin(registry);
    renderSection();

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
      apiVersion: "2.0",
      description: "Builtin.",
      platform: { web: true, node: false },
      permissions: [],
      contributes: { panels: [] },
    });
    registry.register(
      {
        id: "installed-x",
        name: "User Plugin",
        version: "1.0.0",
        apiVersion: "2.0",
        description: "Installed.",
        platform: { web: true, node: false },
        permissions: [],
        contributes: { panels: [] },
      },
      { source: "installed" },
    );
    setHostWithPlugin(registry);
    renderSection();

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
      renderSection();
      expect(
        screen.getByRole("button", { name: /Install Plugin/i }),
      ).toBeTruthy();
    });

    it("browser (upload): 文件选择仅按扩展名过滤（ADR-056：规避 ROM 的 MIME 过滤）", () => {
      setHostWithPlugin(new PluginRegistry());
      renderSection();

      const input = screen.getByTestId("plugin-manifest-file-input");
      // MIME 列表会让部分 ROM 的文件选择器把 .mjs 判为 octet-stream 而不可选。
      expect(input.getAttribute("accept")).toBe(".json,.mjs,.js");
    });

    it("browser (upload): file pick → security confirm → confirm registers installed plugin", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await pickManifestFile(JSON.stringify(manifestJson));

      // 安全确认展示来源/版本/权限/平台（§6.10.4）。
      expect(
        screen.getAllByText("Install this plugin?").length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("Installed A")).toBeTruthy();
      expect(screen.getByText("1.0.0")).toBeTruthy();
      expect(screen.getByText("UI Contribution")).toBeTruthy();

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
      renderSection();

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
        expect(
          screen.getByText("The plugin manifest is invalid."),
        ).toBeTruthy();
      });
      expect(registry.list()).toHaveLength(0);
    });

    it("browser (upload): schema-invalid manifest shows an error and does not register", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      const input = screen.getByTestId(
        "plugin-manifest-file-input",
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            new File([JSON.stringify({ id: "x" })], "bad-schema.json", {
              type: "application/json",
            }),
          ],
        },
      });
      await waitFor(() => {
        expect(
          screen.getByText("The plugin manifest is invalid."),
        ).toBeTruthy();
      });
      // 确认框不会出现（校验失败直接报错）。
      expect(screen.queryByText("Install this plugin?")).toBeNull();
      expect(registry.list()).toHaveLength(0);
    });

    it("browser (upload): node-only plugin rejected before confirm (platform guard)", async () => {
      const registry = new PluginRegistry();
      setHostWithPlugin(registry);
      renderSection();

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
      renderSection();

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
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await waitFor(() => {
        expect(openTextFile).toHaveBeenCalledWith({
          suggestedName: "plugin-manifest.json",
        });
      });
      await waitFor(() => {
        expect(
          screen.getAllByText("Install this plugin?").length,
        ).toBeGreaterThan(0);
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
      renderSection();

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
          clipboard: false,
          nodePlugins: false,
          webPlugins: false,
          logExport: "unsupported",
          workspaceImport: "unsupported",
          workspaceExport: "unsupported",
          pluginInstall: "unsupported",
          executablePlugins: false,
          hostPlugins: false,
          backgroundLifecycle: false,
          keepAwake: false,
          hardwareBack: false,
          protocolExtensions: [],
          tableTypes: ["holding-register"],
        },
        openTextFile,
      });
      renderSection();

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

  describe("插件卸载（2026-09-01，ADR-044 Phase F-1）", () => {
    it("installed 插件显示卸载按钮，builtin 不显示", () => {
      const registry = new PluginRegistry();
      registry.register({
        id: "builtin-x",
        name: "Builtin Plugin",
        version: "1.0.0",
        apiVersion: "2.0",
        description: "Builtin.",
        platform: { web: true, node: false },
        permissions: [],
        contributes: { panels: [] },
      });
      registry.register(
        {
          id: "installed-x",
          name: "User Plugin",
          version: "1.0.0",
          apiVersion: "2.0",
          description: "Installed.",
          platform: { web: true, node: false },
          permissions: [],
          contributes: { panels: [] },
        },
        { source: "installed" },
      );
      setHostWithPlugin(registry);
      renderSection();

      const installedRow = screen
        .getByText("User Plugin")
        .closest(".ant-listy-item");
      expect(
        installedRow?.querySelector('button[aria-label="Uninstall"]'),
      ).not.toBeNull();
      const builtinRow = screen
        .getByText("Builtin Plugin")
        .closest(".ant-listy-item");
      expect(
        builtinRow?.querySelector('button[aria-label="Uninstall"]'),
      ).toBeNull();
    });

    it("确认卸载后从列表移除并提示成功", async () => {
      const registry = new PluginRegistry();
      registry.register(
        {
          id: "installed-x",
          name: "User Plugin",
          version: "1.0.0",
          apiVersion: "2.0",
          description: "Installed.",
          platform: { web: true, node: false },
          permissions: [],
          contributes: { panels: [] },
        },
        { source: "installed" },
      );
      setHostWithPlugin(registry);
      renderSection();
      expect(registry.list()).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
      expect(
        screen.getAllByText("Uninstall this plugin?").length,
      ).toBeGreaterThan(0);
      clickConfirmOk();

      await waitFor(() => {
        expect(registry.list()).toHaveLength(0);
      });
      await waitFor(() => {
        expect(screen.getByText("Plugin uninstalled.")).toBeTruthy();
      });
    });

    it("取消确认不卸载", async () => {
      const registry = new PluginRegistry();
      registry.register(
        {
          id: "installed-x",
          name: "User Plugin",
          version: "1.0.0",
          apiVersion: "2.0",
          description: "Installed.",
          platform: { web: true, node: false },
          permissions: [],
          contributes: { panels: [] },
        },
        { source: "installed" },
      );
      setHostWithPlugin(registry);
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
      const cancel = document.querySelector(".ant-modal .ant-btn-default");
      expect(cancel).not.toBeNull();
      fireEvent.click(cancel as HTMLElement);
      await waitFor(() => {
        expect(registry.list()).toHaveLength(1);
      });
    });
  });

  describe("单文件 JS 可执行插件安装（ADR-054：预览 + 执行模式授权 + 安装）", () => {
    const executableCaps = { ...browserCaps, executablePlugins: true } as const;
    const entrySource =
      "export const manifest = {...};\nexport function activate(ctx) {}";

    it.each(["isolated", "same-process"] as const)(
      "aborts %s consent when the user cancels the confirmation",
      async (requiredExecution) => {
        let signal: AbortSignal | undefined;
        const installPluginEntry = vi.fn();
        setHostWithPlugin(new PluginRegistry(), {
          capabilities: executableCaps,
          previewPluginEntry: vi.fn<AppHost["previewPluginEntry"]>(
            async (_source, _mode, previewSignal) => {
              signal = previewSignal;
              return {
                ok: true,
                value: {
                  ...manifestJson,
                  executionRequirements: { version: 1, requiredExecution },
                },
              };
            },
          ),
          installPluginEntry,
        });
        renderSection();
        await pickPluginSourceFile(entrySource);
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(signal?.aborted).toBe(true);
        expect(installPluginEntry).not.toHaveBeenCalled();
      },
    );

    it.each(["unmount", "close"] as const)(
      "cancels pending preview on %s without showing a late confirmation",
      async (action) => {
        let signal: AbortSignal | undefined;
        let resolvePreview:
          ((result: Result<PluginManifest>) => void) | undefined;
        const previewPluginEntry = vi.fn(
          (_source: string, _mode: unknown, previewSignal?: AbortSignal) => {
            signal = previewSignal;
            return new Promise<Result<PluginManifest>>((resolve) => {
              resolvePreview = resolve;
            });
          },
        );
        const installPluginEntry = vi.fn();
        setHostWithPlugin(new PluginRegistry(), {
          capabilities: executableCaps,
          previewPluginEntry,
          installPluginEntry,
        });
        const view = renderSection();
        fireEvent.change(screen.getByTestId("plugin-manifest-file-input"), {
          target: {
            files: [
              new File([entrySource], "plugin.mjs", {
                type: "text/javascript",
              }),
            ],
          },
        });
        await waitFor(() => expect(previewPluginEntry).toHaveBeenCalledOnce());
        if (action === "unmount") view.unmount();
        else
          view.rerender(
            <AntApp>
              <PluginManagerSection active={false} />
            </AntApp>,
          );
        expect(signal?.aborted).toBe(true);
        await act(async () => {
          resolvePreview?.({ ok: true, value: manifestJson });
        });
        expect(screen.queryByText("Install this plugin?")).toBeNull();
        expect(installPluginEntry).not.toHaveBeenCalled();
      },
    );

    it("destroys an open confirmation when settings closes", async () => {
      let signal: AbortSignal | undefined;
      const installPluginEntry = vi.fn();
      setHostWithPlugin(new PluginRegistry(), {
        capabilities: executableCaps,
        previewPluginEntry: async (_source, _mode, previewSignal) => {
          signal = previewSignal;
          return { ok: true, value: manifestJson };
        },
        installPluginEntry,
      });
      // Disable CSS motion: this test checks dialog ownership, not animation timing.
      const section = (active: boolean) => (
        <ConfigProvider theme={{ token: { motion: false } }}>
          <AntApp>
            <PluginManagerSection active={active} />
          </AntApp>
        </ConfigProvider>
      );
      const view = render(section(true));
      await pickPluginSourceFile(entrySource);
      view.rerender(section(false));
      expect(signal?.aborted).toBe(true);
      await waitFor(() =>
        expect(screen.queryAllByText("Install this plugin?")).toHaveLength(0),
      );
      expect(installPluginEntry).not.toHaveBeenCalled();
    });

    it("预览（隔离）→ 确认框展示清单与执行模式 → 按默认隔离安装", async () => {
      const registry = new PluginRegistry();
      const previewPluginEntry = vi.fn(
        async (): Promise<Result<PluginManifest>> => ({
          ok: true as const,
          value: manifestJson,
        }),
      );
      const installPluginEntry = vi.fn(
        async (): Promise<Result<PluginManifest>> => ({
          ok: true as const,
          value: manifestJson,
        }),
      );
      setHostWithPlugin(registry, {
        capabilities: executableCaps,
        previewPluginEntry,
        installPluginEntry,
      });
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await pickPluginSourceFile(entrySource);

      // 预览：先用隔离模式加载 entry 提取 manifest（不注册）。
      expect(previewPluginEntry).toHaveBeenCalledWith(
        entrySource,
        "isolated",
        expect.any(AbortSignal),
      );
      expect(
        screen.getAllByText("Install this plugin?").length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("Installed A")).toBeTruthy();
      expect(screen.getByText("Isolated worker")).toBeTruthy();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByText(/full Node.js access/)).toBeNull();

      clickConfirmOk();
      await waitFor(() => {
        expect(installPluginEntry).toHaveBeenCalledWith(
          entrySource,
          "isolated",
        );
      });
    });

    it("requires explicit consent for the declared same-process runtime", async () => {
      const requiredManifest: PluginManifest = {
        ...manifestJson,
        executionRequirements: {
          version: 1,
          requiredExecution: "same-process",
          reason: "Registers a codec.",
        },
      };
      const registry = new PluginRegistry();
      const installPluginEntry = vi.fn(
        async (): Promise<Result<PluginManifest>> => ({
          ok: true as const,
          value: manifestJson,
        }),
      );
      setHostWithPlugin(registry, {
        capabilities: executableCaps,
        previewPluginEntry: vi.fn(
          async (): Promise<Result<PluginManifest>> => ({
            ok: true as const,
            value: requiredManifest,
          }),
        ),
        installPluginEntry,
      });
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      await pickPluginSourceFile(entrySource);
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.getByText(/full Node.js access/)).toBeTruthy();
      expect(
        screen.getByText("Plugin-provided reason: Registers a codec."),
      ).toBeTruthy();
      expect(installPluginEntry).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Authorize same-process execution and install",
        }),
      );

      await waitFor(() => {
        expect(installPluginEntry).toHaveBeenCalledWith(
          entrySource,
          "same-process",
        );
      });
    });

    it("预览失败 → 提示错误且不安装", async () => {
      const registry = new PluginRegistry();
      const installPluginEntry = vi.fn();
      setHostWithPlugin(registry, {
        capabilities: executableCaps,
        previewPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
        installPluginEntry,
      });
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      const input = screen.getByTestId(
        "plugin-manifest-file-input",
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            new File([entrySource], "plugin.mjs", { type: "text/javascript" }),
          ],
        },
      });

      await waitFor(() => {
        expect(
          screen.getByText("Failed to load the plugin entry."),
        ).toBeTruthy();
      });
      expect(installPluginEntry).not.toHaveBeenCalled();
    });

    it("executablePlugins 不支持 → 报错不预览不安装", async () => {
      const registry = new PluginRegistry();
      const previewPluginEntry = vi.fn();
      setHostWithPlugin(registry, {
        capabilities: browserCaps, // executablePlugins: false
        previewPluginEntry,
      });
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: /Install Plugin/i }));
      const input = screen.getByTestId(
        "plugin-manifest-file-input",
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [
            new File([entrySource], "plugin.mjs", { type: "text/javascript" }),
          ],
        },
      });
      await waitFor(() => {
        expect(
          screen.getByText(/Executable plugins are not supported/i),
        ).toBeTruthy();
      });
      expect(previewPluginEntry).not.toHaveBeenCalled();
      expect(registry.list()).toHaveLength(0);
    });
  });
});
