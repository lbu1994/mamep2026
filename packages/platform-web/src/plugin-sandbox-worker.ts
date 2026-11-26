import {
  PLUGIN_SANDBOX_LOADER_HASH,
  PLUGIN_SANDBOX_LOADER_SOURCE,
} from "./plugin-sandbox-loader";

/** The host exposes only the Worker methods required by the plugin bridge. */
export interface PluginWorkerEndpoint {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

// The iframe owns the Worker so its opaque origin cannot open application storage.
// Only the parent can transfer the private port. Plugin code runs in the nested Worker.

/** Create an opaque-origin Worker; never fall back to an application-origin Worker. */
export function createSandboxedPluginWorker(
  bootstrap: string,
): PluginWorkerEndpoint {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.title = "Plugin runtime";
  const channel = new MessageChannel();
  let terminated = false;
  const endpoint: PluginWorkerEndpoint = {
    onmessage: null,
    onerror: null,
    postMessage: (data) => {
      if (!terminated) channel.port1.postMessage({ kind: "message", data });
    },
    terminate: () => {
      if (terminated) return;
      terminated = true;
      endpoint.onmessage = null;
      endpoint.onerror = null;
      endpoint.onmessageerror = null;
      frame.onload = null;
      channel.port1.onmessage = null;
      channel.port1.onmessageerror = null;
      try {
        channel.port1.postMessage({ kind: "terminate" });
      } finally {
        channel.port1.close();
        channel.port2.close();
        frame.remove();
      }
    },
  };
  channel.port1.onmessageerror = (event) => endpoint.onmessageerror?.(event);
  channel.port1.onmessage = (event: MessageEvent) => {
    if (terminated) return;
    if (event.data?.kind === "message")
      endpoint.onmessage?.(
        new MessageEvent("message", { data: event.data.data }),
      );
    else if (event.data?.kind === "error")
      endpoint.onerror?.(
        new ErrorEvent("error", { message: String(event.data.message) }),
      );
  };
  frame.onload = () => {
    if (!terminated)
      frame.contentWindow?.postMessage({ bootstrap }, "*", [channel.port2]);
  };
  frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${PLUGIN_SANDBOX_LOADER_HASH}' blob:; worker-src blob:; connect-src 'none';"><script>${PLUGIN_SANDBOX_LOADER_SOURCE}</script>`;
  try {
    document.body.append(frame);
  } catch (error) {
    endpoint.terminate();
    throw error;
  }
  return endpoint;
}
