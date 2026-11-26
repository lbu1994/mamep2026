import type { Page } from "@playwright/test";

/** Startup autosave refreshes only the workspace timestamp; compare all persisted content. */
export function applicationStorageContent(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => {
      if (
        (key === "workspace" || key === "workspace-backup") &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        return [
          key,
          Object.fromEntries(
            Object.entries(value).filter(([field]) => field !== "updatedAt"),
          ),
        ];
      }
      return [key, value];
    }),
  );
}

/** Read application storage from the trusted test driver, never from the plugin. */
export async function readApplicationStorage(
  page: Page,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open("mamep2026", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("kv", "readonly");
          const values: Record<string, unknown> = {};
          for (const key of ["workspace", "workspace-backup", "plugins"]) {
            const read = transaction.objectStore("kv").get(key);
            read.onsuccess = () => {
              values[key] = read.result ?? null;
            };
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(values);
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

/** Populate the real backup key so a blocked attack cannot pass against an empty store. */
export async function copyWorkspaceToBackup(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("mamep2026", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("kv", "readwrite");
          const store = transaction.objectStore("kv");
          const read = store.get("workspace");
          read.onsuccess = () => {
            if (read.result === undefined) {
              transaction.abort();
              return;
            }
            store.put(read.result, "workspace-backup");
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("Workspace missing"));
          };
        };
      }),
  );
}

/** Simulate external tampering; keep the original approval to test restore before import. */
export async function tamperStoredPlugin(
  page: Page,
  change: "source" | "mode" | "approval",
  pluginId = "sandbox-consent",
): Promise<void> {
  await page.evaluate(
    ({ field, id }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("mamep2026", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("kv", "readwrite");
          const store = transaction.objectStore("kv");
          const read = store.get("plugins");
          read.onsuccess = () => {
            const data = read.result as {
              plugins: Array<{
                manifest: { id: string };
                entrySource?: string;
                executionMode?: string;
                approval?: unknown;
              }>;
            };
            const plugin = data.plugins.find((item) => item.manifest.id === id);
            if (plugin === undefined) {
              transaction.abort();
              return;
            }
            if (field === "mode") plugin.executionMode = "same-process";
            else if (field === "source")
              plugin.entrySource =
                'document.documentElement.dataset.unapprovedPlugin = "executed";\n' +
                plugin.entrySource;
            else delete plugin.approval;
            store.put(data, "plugins");
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("Plugin missing"));
          };
        };
      }),
    { field: change, id: pluginId },
  );
}
