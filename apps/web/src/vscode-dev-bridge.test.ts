// @vitest-environment jsdom
/**
 * dev iframe 桥单测（apps/web/src/vscode-dev-bridge.ts）：
 * - 门控：仅 ?mamepVscode=1 且处于 iframe 上下文时安装 window.mamepHost；
 * - 复用 createVscodeBridge：request 经 postToParent 上送、宿主 response 回投 resolve。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installVscodeDevBridge,
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
