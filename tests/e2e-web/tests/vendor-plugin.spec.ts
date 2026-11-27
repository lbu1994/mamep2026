import { expect, test } from "@playwright/test";
import {
  closeSettings,
  installExecutablePlugin,
  openPluginsSection,
} from "./helpers/manual-plugins";
import { readApplicationStorage } from "@mamep2026/e2e-fixtures/storage-helpers";

test("vendor RTU contributions follow approval, disable, restart and uninstall", async ({
  page,
  baseURL,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const open = async () => {
    await page.goto(baseURL ?? "http://localhost:5173");
    await expect(page.locator('[data-startup-hydrated="true"]')).toBeVisible();
    const connection = page
      .locator(".ant-modal-container")
      .filter({ hasText: "Connection Settings" });
    await expect(connection).toBeVisible();
    await connection.locator(".ant-modal-close").click();
    await expect(connection).toBeHidden();
  };
  await open();
  const table = page.getByRole("button", {
    name: "Read/write via 67H 010DH/010EH",
    exact: true,
  });
  await expect(table).toHaveCount(0);
  await installExecutablePlugin(page, {
    pluginId: "yaskawa-memobus-67h-010dh-010eh",
    pluginName: "Yaskawa MEMOBUS",
    executionMode: "same-process",
  });
  await expect(table).toBeVisible();
  const manager = await openPluginsSection(page);
  const row = manager
    .locator(".ant-listy-item")
    .filter({ hasText: "Yaskawa MEMOBUS" });
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(table).toHaveCount(0);
  await expect
    .poll(async () => (await readApplicationStorage(page)).plugins)
    .toMatchObject({ plugins: [{ enabled: false }] });
  const disabled = (await readApplicationStorage(page)).plugins;
  await open();
  await expect(table).toHaveCount(0);
  await openPluginsSection(page);
  await expect(row.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await closeSettings(page);
  await expect(table).toBeVisible();
  await openPluginsSection(page);
  await row.getByRole("button", { name: "Uninstall", exact: true }).click();
  const dialog = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Uninstall this plugin?" });
  await dialog.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(table).toHaveCount(0);
  await expect
    .poll(async () => (await readApplicationStorage(page)).plugins)
    .toMatchObject({ plugins: [] });
  await open();
  await expect(table).toHaveCount(0);
  await expect(page.locator(".ant-layout-header")).toContainText("Offline");
  expect(errors).toEqual([]);
  await info.attach("vendor-lifecycle", {
    body: JSON.stringify(
      { disabled, removed: (await readApplicationStorage(page)).plugins },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
