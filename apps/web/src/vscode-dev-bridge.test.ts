// @vitest-environment jsdom
/**
 * dev iframe 桥单测（apps/web/src/vscode-dev-bridge.ts）：
 * - 门控：仅 ?mamepVscode=1 且处于 iframe 上下文时安装 window.mamepHost；
 * - 复用 createVscodeBridge：request 经 postToParent 上送、宿主 response 回投 resolve。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installVscodeDevBridge,
  installVscodeDevThemeRelay,
  THEME_RELAY_COLORS_TYPE,
  THEME_RELAY_REQUEST_TYPE,
  THEME_RELAY_SOURCE,
  VSCODE_IFRAME_FLAG,
} from "./vscode-dev-bridge";

type WindowWithHost = Window & { mamepHost?: unknown };

describe("installVscodeDevBridge（dev iframe → VscodeAppHost 桥）", () => {
  afterEach(() => {
    delete (window as WindowWithHost).mamepHost;
  });

  it("无 mamepVscode 查询参数时不安装", () => {
    const installed = installVscodeDevBridge({
      search: "",
      isIframe: () => true,
      postToParent: vi.fn(),
      targetWindow: window,
    });
    expect(installed).toBe(false);
    expect((window as WindowWithHost).mamepHost).toBeUndefined();
  });

  it("非 iframe 上下文（window.self === window.top）时不安装", () => {
    const installed = installVscodeDevBridge({
      search: `?${VSCODE_IFRAME_FLAG}=1`,
      isIframe: () => false,
      postToParent: vi.fn(),
      targetWindow: window,
    });
    expect(installed).toBe(false);
    expect((window as WindowWithHost).mamepHost).toBeUndefined();
  });

  it("满足门控时安装 window.mamepHost，request 经 postToParent 上送、response 回投 resolve", async () => {
    const postToParent = vi.fn();
    const installed = installVscodeDevBridge({
      search: `?${VSCODE_IFRAME_FLAG}=1`,
      isIframe: () => true,
      postToParent,
      targetWindow: window,
    });
    expect(installed).toBe(true);
    const host = (window as WindowWithHost).mamepHost as {
      platform: string;
      getCapabilities: () => Promise<{ ok: boolean }>;
    };
    expect(host).toBeDefined();
    expect(host.platform).toBe("vscode");

    const pending = host.getCapabilities();
    expect(postToParent).toHaveBeenCalledTimes(1);
    const envelope = postToParent.mock.calls[0]?.[0] as {
      type: string;
      kind: string;
      messageId: string;
    };
    expect(envelope.type).toBe("request");
    expect(envelope.kind).toBe("get-capabilities");

    // 宿主 response Envelope 经 targetWindow message 事件回投 → promise resolve。
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          protocolVersion: 1,
          type: "response",
          messageId: envelope.messageId,
          kind: "get-capabilities",
          ok: true,
          payload: {
            modbusRtu: true,
            modbusTcp: false,
            serialPorts: "enumerated",
            filesystem: "unsupported",
            nodePlugins: false,
            webPlugins: true,
          },
        },
      }),
    );
    const result = await pending;
    expect(result.ok).toBe(true);
  });
});

describe("installVscodeDevThemeRelay（dev iframe 主题颜色中继，ADR-027）", () => {
  function makeEnv() {
    const postToParent = vi.fn();
    const setProperty = vi.fn();
    const removeProperty = vi.fn();
    const env = {
      search: `?${VSCODE_IFRAME_FLAG}=1`,
      isIframe: () => true,
      postToParent,
      targetWindow: window,
      docStyle: { setProperty, removeProperty },
      varNames: ["--vscode-editor-background", "--vscode-focusBorder"],
    };
    return { env, postToParent, setProperty, removeProperty };
  }

  it("门控：无标记 / 非 iframe 时不安装", () => {
    expect(
      installVscodeDevThemeRelay({
        ...makeEnv().env,
        search: "",
      }),
    ).toBe(false);
    expect(
      installVscodeDevThemeRelay({
        ...makeEnv().env,
        isIframe: () => false,
      }),
    ).toBe(false);
  });

  it("安装时向主 frame 发 theme-colors-request（闭合竞态）", () => {
    const { env, postToParent } = makeEnv();
    const installed = installVscodeDevThemeRelay(env);
    expect(installed).toBe(true);
    expect(postToParent).toHaveBeenCalledWith({
      source: THEME_RELAY_SOURCE,
      type: THEME_RELAY_REQUEST_TYPE,
    });
  });

  it("收到 theme-colors 消息时把变量物化到 docStyle；缺失值移除", () => {
    const { env, setProperty, removeProperty } = makeEnv();
    installVscodeDevThemeRelay(env);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: THEME_RELAY_SOURCE,
          type: THEME_RELAY_COLORS_TYPE,
          colors: {
            "--vscode-editor-background": "#1e1e1e",
            "--vscode-focusBorder": "",
          },
        },
      }),
    );

    expect(setProperty).toHaveBeenCalledWith(
      "--vscode-editor-background",
      "#1e1e1e",
    );
    // 空值/缺失 → 移除（回退默认）。
    expect(removeProperty).toHaveBeenCalledWith("--vscode-focusBorder");
  });

  it("忽略非中继消息（HostMessage Envelope 等），不物化不报错", () => {
    const { env, setProperty } = makeEnv();
    installVscodeDevThemeRelay(env);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { protocolVersion: 1, type: "event", kind: "comm-log" },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", { data: { source: "other", type: "x" } }),
    );

    expect(setProperty).not.toHaveBeenCalled();
  });
});
