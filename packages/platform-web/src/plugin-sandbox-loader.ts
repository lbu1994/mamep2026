/** Fixed host bootstrap. Plugin source arrives only through the private port. */
export const PLUGIN_SANDBOX_LOADER_SOURCE = `addEventListener("message", function initialize(event) {
  if (event.source !== parent || event.ports.length !== 1) return;
  removeEventListener("message", initialize);
  const port = event.ports[0];
  try {
    const url = URL.createObjectURL(
      new Blob([event.data.bootstrap], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    worker.onmessage = (event) =>
      port.postMessage({ kind: "message", data: event.data });
    worker.onerror = (event) =>
      port.postMessage({ kind: "error", message: event.message });
    port.onmessage = (event) => {
      if (event.data.kind === "terminate") {
        worker.terminate();
        URL.revokeObjectURL(url);
        port.close();
      } else worker.postMessage(event.data.data);
    };
    port.start();
  } catch (error) {
    port.postMessage({ kind: "error", message: String(error) });
  }
});`;

/** Exact CSP authorization for the fixed inline bootstrap. */
export const PLUGIN_SANDBOX_LOADER_HASH =
  "sha256-QxLp6Dk8s3A/H+MqRT4wfxtc2DFvCtZO011rhKDwUmg=";
