/** Web adapter for one bounded Worker generation in an opaque-origin iframe. */
import {
  BoundedPluginRemoteRuntime,
  createUnavailableCommunicationApi,
  type PluginCommunicationApi,
  type PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import {
  createSandboxedPluginWorker,
  type PluginWorkerEndpoint,
} from "./plugin-sandbox-worker";
import { PLUGIN_WORKER_BOOTSTRAP } from "./plugin-worker-bootstrap";

/** Legacy factory argument retained for source compatibility; activation supplies the bound API. */
export type PluginCommunicationApiFactory = (
  pluginId: string,
) => PluginCommunicationApi;

/** Injectable Worker endpoint; production uses a Worker owned by an opaque-origin iframe. */
export type PluginWorkerFactory = (
  scriptBlobUrl: string,
) => PluginWorkerEndpoint;

function defaultWorkerFactory(_scriptBlobUrl: string): PluginWorkerEndpoint {
  return createSandboxedPluginWorker(PLUGIN_WORKER_BOOTSTRAP);
}

export class WebPluginRemoteRuntime extends BoundedPluginRemoteRuntime {
  constructor(
    entrySource: string,
    communicationApiFactory: PluginCommunicationApiFactory,
    options: { workerFactory?: PluginWorkerFactory } = {},
  ) {
    // Only activate() supplies the authorized API; a message cannot select a factory.
    void communicationApiFactory;
    super(entrySource, (receive, fail) => {
      const url = URL.createObjectURL(
        new Blob([PLUGIN_WORKER_BOOTSTRAP], { type: "text/javascript" }),
      );
      try {
        const worker = (options.workerFactory ?? defaultWorkerFactory)(url);
        worker.onmessage = (event) => receive(event.data);
        worker.onerror = (event) => fail(new Error(event.message));
        worker.onmessageerror = () =>
          fail(new Error("plugin message could not be deserialized"));
        return {
          postMessage: (message) => worker.postMessage(message),
          terminate: () => {
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            try {
              worker.terminate();
            } finally {
              URL.revokeObjectURL(url);
            }
          },
        };
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    });
  }
}

export function createWebPluginRemoteRuntime(
  entrySource: string,
  communicationApiFactory: PluginCommunicationApiFactory,
  options: { workerFactory?: PluginWorkerFactory } = {},
): PluginRemoteRuntime {
  return new WebPluginRemoteRuntime(
    entrySource,
    communicationApiFactory,
    options,
  );
}

/** Preview has no activation, device API, or application storage access. */
export function createWebPluginPreviewRuntime(
  entrySource: string,
  options: { workerFactory?: PluginWorkerFactory } = {},
): Pick<PluginRemoteRuntime, "load" | "dispose"> {
  const runtime = new WebPluginRemoteRuntime(
    entrySource,
    createUnavailableCommunicationApi,
    options,
  );
  return {
    load: () => runtime.load(),
    dispose: () => runtime.dispose(),
  };
}
