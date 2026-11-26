/** Node threads remain privileged; this adapter is not wired into product assembly. */
import { Worker } from "node:worker_threads";
import {
  BoundedPluginRemoteRuntime,
  type PluginCommunicationApi,
  type PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import { PLUGIN_NODE_WORKER_BOOTSTRAP } from "./plugin-node-worker-bootstrap";

export type PluginCommunicationApiFactory = (
  pluginId: string,
) => PluginCommunicationApi;

/** Thread isolation limits execution resources, not filesystem or network permissions. */
export class NodePluginRemoteRuntime extends BoundedPluginRemoteRuntime {
  constructor(
    entrySource: string,
    communicationApiFactory: PluginCommunicationApiFactory,
  ) {
    void communicationApiFactory;
    super(entrySource, (receive, fail) => {
      const worker = new Worker(PLUGIN_NODE_WORKER_BOOTSTRAP, {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      worker.on("message", receive);
      worker.on("messageerror", () =>
        fail(new Error("plugin message could not be deserialized")),
      );
      worker.on("error", fail);
      worker.on("exit", (code) =>
        fail(new Error(`plugin worker exited (${code})`)),
      );
      return {
        postMessage: (message) => worker.postMessage(message),
        terminate: async () => {
          worker.removeAllListeners();
          // Observe errors until termination completes, without invoking the old generation.
          worker.on("error", () => {});
          try {
            await worker.terminate();
          } finally {
            worker.removeAllListeners();
          }
        },
      };
    });
  }
}

/** Experimental Node runtime; callers must separately assess permissions before enabling it. */
export function createNodePluginRemoteRuntime(
  entrySource: string,
  communicationApiFactory: PluginCommunicationApiFactory,
): PluginRemoteRuntime {
  return new NodePluginRemoteRuntime(entrySource, communicationApiFactory);
}
