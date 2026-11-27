import { afterEach, describe, expect, it, vi } from "vitest";
import type * as VSCode from "vscode";

const fixture = vi.hoisted(() => {
  function event<T>() {
    const listeners = new Set<(value: T) => void>();
    return {
      listeners,
      subscribe: (listener: (value: T) => void) => {
        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          },
        };
      },
      fire: (value: T) => {
        for (const listener of [...listeners]) listener(value);
      },
    };
  }
  function panel() {
    const messages = event<unknown>();
    const closed = event<void>();
    const visibility = event<{ webviewPanel: { visible: boolean } }>();
    return {
      messages,
      closed,
      visibility,
      webview: {
        html: "",
        cspSource: "test-resource:",
        asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: messages.subscribe,
      },
      onDidDispose: closed.subscribe,
      onDidChangeViewState: visibility.subscribe,
      reveal: vi.fn(),
    };
  }
  return {
    panel,
    event,
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    panels: [] as ReturnType<typeof panel>[],
    serializer: undefined as VSCode.WebviewPanelSerializer | undefined,
    theme: event<void>(),
    sessionDispose: vi.fn(async () => {}),
    pluginDispose: vi.fn(),
    rpc: vi.fn(async () => ({ type: "response" })),
  };
});

vi.mock("vscode", () => ({
  ExtensionMode: { Production: 1 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ViewColumn: { One: 1 },
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
    }),
  },
  commands: {
    registerCommand: (
      name: string,
      callback: (...args: unknown[]) => unknown,
    ) => {
      fixture.commands.set(name, callback);
      return {
        dispose: () => {
          fixture.commands.delete(name);
        },
      };
    },
  },
  window: {
    activeColorTheme: { kind: 1 },
    onDidChangeActiveColorTheme: fixture.theme.subscribe,
    registerWebviewPanelSerializer: (
      _name: string,
      serializer: VSCode.WebviewPanelSerializer,
    ) => {
      fixture.serializer = serializer;
      return {
        dispose() {
          fixture.serializer = undefined;
        },
      };
    },
    createWebviewPanel: () => {
      const panel = fixture.panel();
      fixture.panels.push(panel);
      return panel;
    },
  },
}));
vi.mock("./ipc", () => ({
  handleVscodeInvoke: fixture.rpc,
  errorEnvelope: vi.fn(),
  extractMessageId: vi.fn(),
}));
vi.mock("./session-host", () => ({
  VscodeSessionHost: class {
    dispose = fixture.sessionDispose;
  },
}));
vi.mock("@mamep2026/platform-node/plugin", () => ({
  createHostPluginRuntime: () => ({
    getCodecRegistry: () => ({ register: vi.fn() }),
    sync: async () => {},
    dispose: fixture.pluginDispose,
  }),
}));

import { activate, deactivate } from "./extension";

let subscriptions: VSCode.Disposable[] = [];
afterEach(async () => {
  await deactivate();
  for (const subscription of subscriptions) subscription.dispose();
  subscriptions = [];
  fixture.panels.length = 0;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function start() {
  vi.stubEnv("MAMEP_DEV_URL", "http://localhost:5173");
  vi.stubEnv("MAMEP_FAKE_TCP", "0");
  activate({
    extensionMode: 2,
    extensionUri: { fsPath: "C:/fixture" },
    extension: { packageJSON: { version: "test" } },
    subscriptions,
    globalState: { get: () => undefined, update: async () => {} },
  } as unknown as VSCode.ExtensionContext);
  fixture.commands.get("mamep2026.openMainPanel")?.();
  const panel = fixture.panels[0];
  if (!panel) throw new Error("Panel was not created");
  return panel;
}

describe("VSCode panel lifecycle wiring", () => {
  it("retains the session while hidden and releases panel subscriptions on close", async () => {
    const panel = start();
    panel.visibility.fire({ webviewPanel: { visible: false } });
    expect(fixture.sessionDispose).not.toHaveBeenCalled();
    panel.visibility.fire({ webviewPanel: { visible: true } });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "color-theme-changed" }),
    );
    fixture.commands.get("mamep2026.openMainPanel")?.();
    expect(panel.reveal).toHaveBeenCalledTimes(1);
    panel.closed.fire();
    expect(fixture.sessionDispose).toHaveBeenCalledTimes(1);
    expect(panel.messages.listeners.size).toBe(0);
    expect(panel.visibility.listeners.size).toBe(0);
    expect(panel.closed.listeners.size).toBe(0);
    expect(fixture.pluginDispose).not.toHaveBeenCalled();
    fixture.commands.get("mamep2026.openMainPanel")?.();
    expect(fixture.panels).toHaveLength(2);
    expect(fixture.panels[1]?.messages.listeners.size).toBe(1);
  });

  it("drops a late RPC reply after close and wires a serializer-restored panel once", async () => {
    const panel = start();
    let finish: (value: { type: string }) => void = () => {};
    fixture.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    panel.messages.fire({ type: "request" });
    panel.closed.fire();
    const restored = fixture.panel();
    await fixture.serializer?.deserializeWebviewPanel(
      restored as unknown as VSCode.WebviewPanel,
      {},
    );
    finish({ type: "response" });
    await Promise.resolve();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    expect(restored.messages.listeners.size).toBe(1);
    expect(restored.webview.html).toContain("localhost:5173");
    restored.closed.fire();
    expect(restored.messages.listeners.size).toBe(0);
    expect(fixture.sessionDispose).toHaveBeenCalledTimes(2);
  });

  it("awaits session shutdown and disposes host plugins on deactivation", async () => {
    const panel = start();
    let finish = () => {};
    fixture.sessionDispose.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let finished = false;
    const pending = deactivate().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(fixture.pluginDispose).toHaveBeenCalledTimes(1);
    expect(panel.messages.listeners.size).toBe(0);
    finish();
    await pending;
    expect(finished).toBe(true);
  });
});
