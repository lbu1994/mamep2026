import { expect, test, type Page, type Worker } from "@playwright/test";
import { STORAGE_ATTACK_ENTRY } from "@mamep2026/e2e-fixtures/storage-attack";
import {
  applicationStorageContent,
  copyWorkspaceToBackup,
  readApplicationStorage,
  tamperStoredPlugin,
} from "@mamep2026/e2e-fixtures/storage-helpers";

async function openPlugins(page: Page, baseURL?: string) {
  await page.goto(`${baseURL ?? "http://localhost:5173"}/?mockTransport=1`);
  // Workspace hydration includes a worker import; wait for readiness before testing plugins.
  await expect(page.locator('[data-startup-hydrated="true"]')).toBeVisible({
    timeout: 30000,
  });
  if (baseURL !== undefined) {
    const connection = page
      .locator(".ant-modal-container")
      .filter({ hasText: "Connection Settings" });
    await expect(connection).toBeVisible();
    await connection
      .getByRole("button", { name: /Cancel|Close/i })
      .first()
      .click();
    await expect(connection).toBeHidden();
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  await expect(page.getByTestId("plugin-manager")).toBeVisible();
}

const ENTRY = `
let storageBlocked = false;
try { indexedDB.open("mamep2026"); } catch { storageBlocked = true; }
if (!storageBlocked) throw new Error("Application storage was accessible");
const denied = await new Promise(resolve => {
  function receive(event) {
    if (event.data.type !== "communication-response" || event.data.id !== 987) return;
    self.removeEventListener("message", receive);
    resolve(event.data.result);
  }
  self.addEventListener("message", receive);
  self.postMessage({ version: 1, type: "communication-request", id: 987, op: "write",
    payload: { pluginId: "another-plugin", req: { address: 0, values: [1] } } });
});
if (denied.ok || denied.error.code !== "PLUGIN_PERMISSION_DENIED") throw new Error("Preview communication was allowed");
export const manifest = { id: "sandbox-consent", name: "Sandbox verified", version: "1.0.0", apiVersion: "2.0",
  description: "Storage and preview communication are blocked", platform: { web: true, node: false }, permissions: [], contributes: {} };
export async function activate(ctx) {
  const read = await ctx.communication.readRegisters({address: 0, quantity: 1});
  const write = await ctx.communication.writeRegisters({address: 0, values: [1]});
  if (read.ok || write.ok || read.error.code !== "PLUGIN_PERMISSION_DENIED" || write.error.code !== "PLUGIN_PERMISSION_DENIED") {
    throw new Error("Unapproved communication was allowed");
  }
}
`;

async function preview(page: Page, source = ENTRY, name = "Sandbox verified") {
  await page.getByTestId("plugin-manifest-file-input").setInputFiles({
    name: "consent.mjs",
    mimeType: "text/javascript",
    buffer: Buffer.from(source),
  });
  const dialog = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(dialog).toContainText(name);
  return dialog;
}

for (const failure of [
  "stop-hang",
  "stop-throw",
  "activation-hang",
  "heartbeat-hang",
  "message-flood",
] as const) {
  test(`SEC-05 releases a real isolated Worker: ${failure}`, async ({
    page,
    baseURL,
  }) => {
    await openPlugins(page, baseURL);
    const liveWorkers = new Set<Worker>();
    page.on("worker", (worker) => {
      // Reload also creates the application's workspace parser Worker, which stays alive.
      if (!worker.url().startsWith("blob:")) return;
      liveWorkers.add(worker);
      worker.on("close", () => liveWorkers.delete(worker));
    });
    const source = `
      export const manifest = { id: "sec05", name: "Lifecycle budgets", description: "SEC-05 regression",
        version: "1.0.0", apiVersion: "2.0", platform: { web: true, node: false }, permissions: [], contributes: {} };
      export function activate() {
        ${failure === "activation-hang" ? "return new Promise(() => {});" : ""}
        ${failure === "heartbeat-hang" ? "setTimeout(() => { while (true) {} }, 0);" : ""}
        ${failure === "message-flood" ? "setTimeout(() => { for (let id = 0; id < 140; id++) self.postMessage({ version: 1, type: 'pong', id }); }, 0);" : ""}
      }
      export function deactivate() {
        ${failure === "stop-hang" ? "return new Promise(() => {});" : ""}
        ${failure === "stop-throw" ? "throw new Error('SEC-05 stop rejected');" : ""}
      }
    `;
    const dialog = await preview(page, source, "Lifecycle budgets");
    await expect.poll(() => liveWorkers.size).toBe(0);
    await dialog
      .getByRole("button", {
        name: "Install",
        exact: true,
      })
      .click();
    // Loading has a 10-second contract; allow that deadline plus the modal update.
    await expect(dialog).toBeHidden({ timeout: 15000 });
    const row = page
      .getByTestId("plugin-manager")
      .locator(".ant-listy-item")
      .filter({ hasText: "Lifecycle budgets" });
    const toggle = row.getByRole("switch");
    if (failure.startsWith("stop-")) {
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-checked", "false", {
      timeout: 25000,
    });
    await expect.poll(() => liveWorkers.size, { timeout: 25000 }).toBe(0);
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
    await expect
      .poll(async () => (await readApplicationStorage(page)).plugins)
      .toMatchObject({ plugins: [{ enabled: false }] });
    // A normal reload must preserve the disabled failure state and must not replay activation.
    await openPlugins(page, baseURL);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
    expect(liveWorkers.size).toBe(0);
  });
}

for (const mode of ["same-process", "isolated"] as const) {
  test(`disabled ${mode} restore never executes entry and explicit enable loads once`, async ({
    page,
    baseURL,
  }) => {
    const calls: string[] = [];
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.text().startsWith("SEC-04:")) calls.push(message.text());
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const source = `
console.log("SEC-04:entry");
export const manifest = { id: "disabled-restore", name: "Disabled restore", version: "1.0.0",
  apiVersion: "2.0", description: "Disabled restore regression", executionRequirements: { version: 1, requiredExecution: "${mode}" }, platform: { web: true, node: false },
  permissions: [], contributes: {} };
export function activate() { console.log("SEC-04:activate"); }
export function deactivate() { console.log("SEC-04:deactivate"); }
`;
    await openPlugins(page, baseURL);
    const dialog = await preview(page, source, "Disabled restore");
    if (mode === "same-process")
      await expect(
        dialog.getByRole("button", {
          name: "Authorize same-process execution and install",
          exact: true,
        }),
      ).toBeVisible();
    await dialog
      .getByRole("button", {
        name:
          mode === "same-process"
            ? "Authorize same-process execution and install"
            : "Install",
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();
    const row = page
      .getByTestId("plugin-manager")
      .locator(".ant-listy-item")
      .filter({ hasText: "Disabled restore" });
    const toggle = row.getByRole("switch");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => calls.filter((call) => call === "SEC-04:activate").length)
      .toBe(1);

    const savedPlugins = async () =>
      (await readApplicationStorage(page)).plugins;
    await expect
      .poll(savedPlugins)
      .toMatchObject({ plugins: [{ enabled: true }] });
    // An enabled restart is the control: the same source must execute normally.
    calls.length = 0;
    await openPlugins(page, baseURL);
    await expect.poll(() => calls).toEqual(["SEC-04:entry", "SEC-04:activate"]);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(savedPlugins)
      .toMatchObject({ plugins: [{ enabled: false }] });
    await expect.poll(() => calls.at(-1)).toBe("SEC-04:deactivate");
    const disabledRecord = await savedPlugins();
    expect(disabledRecord).toMatchObject({
      plugins: [{ entrySource: source, executionMode: mode, enabled: false }],
    });

    calls.length = 0;
    await openPlugins(page, baseURL);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
    expect(calls).toEqual([]);
    expect(await savedPlugins()).toEqual(disabledRecord);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => calls).toEqual(["SEC-04:entry", "SEC-04:activate"]);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(() => calls)
      .toEqual(["SEC-04:entry", "SEC-04:activate", "SEC-04:deactivate"]);
    await expect
      .poll(savedPlugins)
      .toMatchObject({ plugins: [{ enabled: false }] });
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);

    calls.length = 0;
    await openPlugins(page, baseURL);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
    expect(calls).toEqual([]);
    expect(await savedPlugins()).toEqual(disabledRecord);
    expect(errors).toEqual([]);
  });
}

test("sandbox blocks application storage and preview communication, and cancellation releases the runtime", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const liveWorkers = new Set<Worker>();
  let workerCount = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openPlugins(page, baseURL);
  // Track plugin workers only; workspace parsing owns a separate long-lived worker.
  page.on("worker", (worker) => {
    workerCount++;
    liveWorkers.add(worker);
    worker.on("close", () => liveWorkers.delete(worker));
  });
  const baseline = await page.locator('iframe[title="Plugin runtime"]').count();
  for (let attempt = 0; attempt < 2; attempt++) {
    const dialog = await preview(page);
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(
      baseline,
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(
      baseline,
    );
    await expect.poll(() => liveWorkers.size).toBe(0);
  }
  expect(workerCount).toBe(2);
  expect(errors).toEqual([]);
});

test("closing settings releases a preview still evaluating top-level code", async ({
  page,
  baseURL,
}) => {
  await openPlugins(page, baseURL);
  const workerStarted = page.waitForEvent("worker");
  await page.getByTestId("plugin-manifest-file-input").setInputFiles({
    name: "pending-preview.mjs",
    mimeType: "text/javascript",
    buffer: Buffer.from("await new Promise(() => {});" + ENTRY),
  });
  const worker = await workerStarted;
  const workerClosed = worker.waitForEvent("close");
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(1);
  await page
    .locator(".settings-drawer")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await workerClosed;
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
  await expect(
    page.getByText("Install this plugin?", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Failed to load the plugin entry.", { exact: true }),
  ).toHaveCount(0);
});

test("opaque origin protects workspace, backup and consent even through a nested Worker", async ({
  page,
  baseURL,
}) => {
  await openPlugins(page, baseURL);
  await expect
    .poll(async () => (await readApplicationStorage(page)).workspace)
    .not.toBeNull();
  await copyWorkspaceToBackup(page);
  const before = await readApplicationStorage(page);
  const dialog = await preview(
    page,
    STORAGE_ATTACK_ENTRY,
    "Storage isolation regression",
  );
  expect(await readApplicationStorage(page)).toEqual(before);
  await dialog
    .getByRole("button", {
      name: "Install",
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  const row = page
    .getByTestId("plugin-manager")
    .locator(".ant-listy-item")
    .filter({ hasText: "Storage isolation regression" });
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => (await readApplicationStorage(page)).plugins)
    .not.toBeNull();
  const installed = await readApplicationStorage(page);
  expect(installed.workspace).toEqual(before.workspace);
  expect(installed["workspace-backup"]).toEqual(before["workspace-backup"]);
  await openPlugins(page, baseURL);
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(1);
  expect(applicationStorageContent(await readApplicationStorage(page))).toEqual(
    applicationStorageContent(installed),
  );
});

for (const change of ["source", "mode", "approval"] as const) {
  test(`restart rejects ${change} tampering before same-process import`, async ({
    page,
    baseURL,
  }) => {
    await openPlugins(page, baseURL);
    // Preview runs in isolation. This entry can run legitimately in either mode.
    const source =
      ENTRY.slice(
        ENTRY.indexOf("export const manifest"),
        ENTRY.indexOf("export async function activate"),
      ).replace(
        "apiVersion:",
        `executionRequirements: { version: 1, requiredExecution: "${change === "mode" ? "isolated" : "same-process"}" }, apiVersion:`,
      ) +
      'export function activate() { if (typeof document !== "undefined") document.documentElement.dataset.approvedPlugin = "executed"; }';
    const dialog = await preview(page, source);
    if (change !== "mode")
      await expect(
        dialog.getByRole("button", {
          name: "Authorize same-process execution and install",
          exact: true,
        }),
      ).toBeVisible();
    await dialog
      .getByRole("button", {
        name:
          change === "mode"
            ? "Install"
            : "Authorize same-process execution and install",
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await readApplicationStorage(page)).plugins)
      .not.toBeNull();
    if (change !== "mode") {
      await expect(page.locator("html")).toHaveAttribute(
        "data-approved-plugin",
        "executed",
      );
      // Prove intact consent restores before testing the changed record.
      await openPlugins(page, baseURL);
      await expect(page.locator("html")).toHaveAttribute(
        "data-approved-plugin",
        "executed",
      );
    }
    await tamperStoredPlugin(page, change);
    await openPlugins(page, baseURL);
    const row = page
      .getByTestId("plugin-manager")
      .locator(".ant-listy-item")
      .filter({ hasText: "Sandbox verified" });
    await expect(row.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(
      row.getByRole("button", { name: "Review permissions" }),
    ).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-approved-plugin",
      "executed",
    );
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-unapproved-plugin",
      "executed",
    );
    await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
  });
}

test("forged plugin-store-save message cannot reach persistence", async ({
  page,
  baseURL,
}) => {
  await openPlugins(page, baseURL);
  await expect
    .poll(async () => (await readApplicationStorage(page)).workspace)
    .not.toBeNull();
  const before = await readApplicationStorage(page);
  await page.getByTestId("plugin-manifest-file-input").setInputFiles({
    name: "forged-storage-message.mjs",
    mimeType: "text/javascript",
    buffer: Buffer.from(
      `self.postMessage({version: 1, type: "plugin-store-save", data: {schemaVersion: 6, plugins: []}});` +
        ENTRY.slice(
          ENTRY.indexOf("export const manifest"),
          ENTRY.indexOf("export async function activate"),
        ) +
        "export function activate() {}",
    ),
  });
  await expect(
    page.getByText("Failed to load the plugin entry.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
  expect(await readApplicationStorage(page)).toEqual(before);
});

test("approved isolated plugin restores, disables and re-enables through a fresh runtime", async ({
  page,
  baseURL,
}) => {
  await openPlugins(page, baseURL);
  const dialog = await preview(page);
  await dialog
    .getByRole("button", {
      name: "Install",
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  const row = page
    .getByTestId("plugin-manager")
    .locator(".ant-listy-item")
    .filter({ hasText: "Sandbox verified" });
  await expect(row).toBeVisible();
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(1);
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(1);
  await openPlugins(page, baseURL);
  await expect(row).toBeVisible();
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(1);
  await expect(page.getByTestId("plugin-manager")).not.toContainText(
    "Unapproved communication was allowed",
  );
});
