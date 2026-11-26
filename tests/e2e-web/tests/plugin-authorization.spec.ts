import { expect, test, type Page } from "@playwright/test";

async function openPlugins(page: Page, baseURL?: string) {
  await page.goto(`${baseURL ?? "http://localhost:5173"}/?mockTransport=1`);
  await expect(page.locator('[data-startup-hydrated="true"]')).toBeVisible();
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

async function preview(page: Page) {
  await page.getByTestId("plugin-manifest-file-input").setInputFiles({
    name: "consent.mjs",
    mimeType: "text/javascript",
    buffer: Buffer.from(ENTRY),
  });
  const dialog = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(dialog).toContainText("Sandbox verified");
  return dialog;
}

test("sandbox blocks application storage and preview communication, and cancellation releases the runtime", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openPlugins(page, baseURL);
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
  }
  expect(errors).toEqual([]);
});

test("approved isolated plugin restores, disables and re-enables through a fresh runtime", async ({
  page,
  baseURL,
}) => {
  await openPlugins(page, baseURL);
  const dialog = await preview(page);
  await dialog.getByRole("button", { name: "Install", exact: true }).click();
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
