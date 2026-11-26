/** Self-contained entry shared by browser, Electron and Android security regressions. */
export const STORAGE_ATTACK_ENTRY = `
async function requireStorageIsolation() {
  async function denied(label, operation) {
    try { await operation(); }
    catch (error) {
      if (error?.name === "SecurityError") return;
      throw new Error(label + " failed for an unexpected reason: " + String(error));
    }
    throw new Error(label + " was accessible to the isolated plugin");
  }
  await denied("IndexedDB read/write", () => new Promise((resolve, reject) => {
    const request = indexedDB.open("mamep2026", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      // Reaching this point already violates isolation; do not damage existing data.
      database.close();
      resolve();
    };
  }));
  await denied("IndexedDB deletion", () => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("mamep2026");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  }));
  // Chromium also rejects an internal promise with undefined on this denied call.
  // Consume the next matching diagnostic after this denied call; still require SecurityError.
  let enumerationDenied = false;
  const enumerationDiagnostic = event => {
    if (enumerationDenied && event.reason === undefined) {
      self.removeEventListener("unhandledrejection", enumerationDiagnostic);
      event.preventDefault();
    }
  };
  self.addEventListener("unhandledrejection", enumerationDiagnostic);
  try {
    await denied("IndexedDB enumeration", () => indexedDB.databases());
    enumerationDenied = true;
  } catch (error) {
    self.removeEventListener("unhandledrejection", enumerationDiagnostic);
    throw error;
  }
  // Some opaque-origin contexts do not expose Cache Storage at all.
  if (typeof caches !== "undefined") await denied("Cache Storage", () => caches.open("mamep-plugin-attack"));
  for (const name of ["document", "localStorage", "mamepHost", "Capacitor", "require", "process"]) {
    if (typeof globalThis[name] !== "undefined") throw new Error(name + " leaked into the Worker");
  }
}
await requireStorageIsolation();
const nestedSource = "(" + requireStorageIsolation.toString() + ")().then(" +
  "() => self.postMessage({ok:true}), error => self.postMessage({ok:false,error:String(error)}))";
const nestedUrl = URL.createObjectURL(new Blob([nestedSource], {type:"text/javascript"}));
const nested = new Worker(nestedUrl);
try {
  await new Promise((resolve, reject) => {
    nested.onmessage = event => event.data.ok ? resolve() : reject(new Error(event.data.error));
    nested.onerror = event => reject(new Error(event.message));
  });
} finally {
  nested.terminate();
  URL.revokeObjectURL(nestedUrl);
}
export const manifest = {
  id: "storage-isolation-regression", name: "Storage isolation regression",
  version: "1.0.0", apiVersion: "2.0", description: "Storage access must fail with SecurityError",
  platform: {web:true,node:false}, permissions: [], contributes: {}
};
export async function activate() { await requireStorageIsolation(); }
`;
