import {
  _electron,
  expect,
  test,
  type Frame,
  type Page,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
interface Bridge {
  sessionConnect(payload: unknown): Promise<{ ok: boolean }>;
  sessionGetState(): Promise<{
    ok: boolean;
    value?: { connectionState: string };
  }>;
}

async function command(page: Page, text: string): Promise<void> {
  console.log(`[lifecycle] command: ${text}`);
  await expect(
    page.getByRole("menuitem", { name: "View", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("F1");
  await page.locator(".quick-input-widget input").fill(`>${text}`);
  const action = page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: text })
    .first();
  await expect(action).toBeVisible();
  await action.click();
}

async function frameFor(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (
          frame.url().startsWith("vscode-webview://") &&
          (await frame
            .locator("#root .ant-app")
            .count()
            .catch(() => 0))
        ) {
          found = frame;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  if (!found) throw new Error("Missing restored Webview");
  await expect
    .poll(() =>
      found?.evaluate(
        () =>
          performance.getEntriesByName("mamep:startup:plugins-settled").length,
      ),
    )
    .toBeGreaterThan(0);
  const modal = found.getByRole("dialog", { name: "Connection Settings" });
  await expect(modal).toBeVisible();
  await modal.locator(".ant-modal-close").click();
  await expect(modal).toBeHidden();
  return found;
}

// eslint-disable-next-line no-empty-pattern -- This test owns an isolated VSCode process.
test("serializer reload and close/reopen restore an offline workspace snapshot", async ({}, info) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mamep-lifecycle-"));
  const target = path.resolve(directory);
  if (
    path.dirname(target) !== path.resolve(tmpdir()) ||
    !path.basename(target).startsWith("mamep-lifecycle-")
  )
    throw new Error("Unexpected cleanup path");
  await mkdir(path.join(directory, "user-data/User"), { recursive: true });
  await writeFile(
    path.join(directory, "user-data/User/settings.json"),
    JSON.stringify({
      "workbench.startupEditor": "none",
      "workbench.colorTheme": "Light Modern",
      "extensions.autoUpdate": false,
      "telemetry.telemetryLevel": "off",
      "chat.disableAIFeatures": true,
    }),
  );
  const executablePath =
    process.env.MAMEP_VSCODE_EXECUTABLE ??
    (await downloadAndUnzipVSCode({
      cachePath: path.join(ROOT, ".vscode-test"),
    }));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !/^(VSCODE_|MAMEP_)/i.test(key) &&
      key !== "ELECTRON_RUN_AS_NODE"
    )
      env[key] = value;
  }
  env.MAMEP_FAKE_SERIAL = "1";
  env.MAMEP_FAKE_SERIAL_DELAY_MS = "40";
  const app = await _electron.launch({
    executablePath,
    env,
    args: [
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--disable-telemetry",
      "--new-window",
      "--locale=en",
      `--extensionDevelopmentPath=${path.join(ROOT, "apps/vscode-extension")}`,
      `--user-data-dir=${path.join(directory, "user-data")}`,
      `--extensions-dir=${path.join(directory, "extensions")}`,
    ],
  });
  try {
    await app
      .context()
      .tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await app.firstWindow();
    console.log("[lifecycle] workbench window opened");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await command(page, "Mamep2026");
    let frame = await frameFor(page);
    console.log("[lifecycle] initial Webview ready");
    const row = () =>
      frame
        .locator(
          ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
        )
        .first();
    const name = row().locator('[data-register-cell="name"]');
    await name.click();
    await name.fill("Lifecycle snapshot");
    await name.press("Enter");
    await expect(name).toHaveAttribute(
      "data-committed-value",
      "Lifecycle snapshot",
    );
    const address = row().locator('[data-register-cell="address"]');
    await address.click();
    await address.fill("1");
    await address.press("Enter");
    await expect(address).toHaveAttribute("data-committed-value", "1");
    expect(
      await frame.evaluate(() =>
        (window as unknown as { mamepHost: Bridge }).mamepHost.sessionConnect({
          portId: "FAKE-1",
          slaveAddress: 1,
          profile: {
            id: "lifecycle",
            name: "RTU",
            protocol: "rtu",
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            flowControl: "off",
            requestTimeoutMs: 1000,
            retryCount: 0,
            recentPortHint: null,
          },
        }),
      ),
    ).toEqual({ ok: true, value: null });
    await row()
      .getByRole("switch", { name: /^Poll row/ })
      .click();
    await expect(row().locator('[data-polling-state="success"]')).toBeVisible();
    console.log("[lifecycle] polling active");

    // An editor switch flushes the workspace through the normal visibility path.
    await command(page, "File: New Untitled Text File");
    await command(page, "Mamep2026");
    await command(page, "Developer: Reload Window");
    // Serializer must restore the panel without another open command.
    await expect.poll(async () => page.frames().includes(frame)).toBe(false);
    frame = await frameFor(page);
    console.log("[lifecycle] serializer Webview ready");
    await expect(row().locator('[data-register-cell="name"]')).toHaveAttribute(
      "data-committed-value",
      "Lifecycle snapshot",
    );
    await expect(
      row().getByRole("switch", { name: /^Poll row/ }),
    ).not.toBeChecked();
    expect(
      await frame.evaluate(() =>
        (
          window as unknown as { mamepHost: Bridge }
        ).mamepHost.sessionGetState(),
      ),
    ).toEqual({ ok: true, value: { connectionState: "disconnected" } });
    await expect(frame.locator(".ant-layout-header")).toContainText("Offline");
    await command(page, "View: Close Editor");
    await command(page, "Mamep2026");
    frame = await frameFor(page);
    await expect(row().locator('[data-register-cell="name"]')).toHaveAttribute(
      "data-committed-value",
      "Lifecycle snapshot",
    );
    await expect(frame.locator(".ant-layout-header")).toContainText("Offline");
    await info.attach("offline-snapshot", {
      body: JSON.stringify({
        serializer: "offline",
        reopen: "offline",
        pollingEnabled: false,
        snapshotName: "Lifecycle snapshot",
      }),
      contentType: "application/json",
    });
  } finally {
    const trace = info.outputPath("lifecycle.zip");
    await app.context().tracing.stop({ path: trace });
    await info.attach("lifecycle", {
      path: trace,
      contentType: "application/zip",
    });
    await app.close();
    await rm(target, { recursive: true, force: true });
  }
});
