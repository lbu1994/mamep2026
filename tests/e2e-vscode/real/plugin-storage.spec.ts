import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Frame,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { STORAGE_ATTACK_ENTRY } from "@mamep2026/e2e-fixtures/storage-attack";
import {
  applicationStorageContent,
  copyWorkspaceToBackup,
  readApplicationStorage,
} from "@mamep2026/e2e-fixtures/storage-helpers";
import { isKnownVSCodeWebviewShellPageError } from "./known-upstream-errors";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const EXTENSION_ID = "mamep2026.mamep2026";
const STORAGE_KEY = "mamep2026.plugins";
type Mode = "isolated" | "same-process";
interface Plugin {
  manifest: {
    id: string;
    name: string;
    version: string;
    apiVersion: string;
    description: string;
    executionRequirements?: { version: 1; requiredExecution: Mode };
    platform: { web: boolean; node: boolean };
    permissions: string[];
    contributes: Record<string, never>;
  };
  enabled: boolean;
  entrySource: string;
  executionMode: Mode;
  approval?: { version: 1; contentDigest: string; permissions: string[] };
}
interface Store {
  schemaVersion: 6;
  plugins: Plugin[];
}
type Result<T> =
  { ok: true; value: T } | { ok: false; error: { code: string } };
interface StorageBridge {
  pluginStoreLoad(): Promise<Result<Store>>;
  pluginStoreSave(data: Store): Promise<Result<null>>;
  getDebugState(): Promise<Result<unknown>>;
  getColorTheme(): Promise<Result<"light" | "dark">>;
  sessionGetState(): Promise<Result<{ connectionState: string }>>;
}

/** Exercise the real bridge from the trusted driver; plugins never receive this reference. */
async function loadStore(frame: Frame): Promise<Store> {
  const result = await frame.evaluate(() =>
    (
      window as unknown as { mamepHost: StorageBridge }
    ).mamepHost.pluginStoreLoad(),
  );
  if (!result.ok) throw new Error(`Plugin load failed: ${result.error.code}`);
  return result.value;
}

async function saveStore(frame: Frame, data: Store): Promise<void> {
  const result = await frame.evaluate(
    (next) =>
      (
        window as unknown as { mamepHost: StorageBridge }
      ).mamepHost.pluginStoreSave(next),
    data,
  );
  expect(result).toEqual({ ok: true, value: null });
}

/** Compare the UI-created approval against an independent SHA-256 calculation. */
function expectApproval(plugin: Plugin): void {
  const content = {
    approvalVersion: 1,
    manifest: plugin.manifest,
    entrySource: plugin.entrySource,
    executionMode: plugin.executionMode,
  };
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, sortKeys(item)]),
      );
    }
    return value;
  };
  expect(plugin.approval).toEqual({
    version: 1,
    contentDigest: createHash("sha256")
      .update(JSON.stringify(sortKeys(content)))
      .digest("hex"),
    permissions: plugin.manifest.permissions,
  });
}

async function uiFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (!frame.url().startsWith("vscode-webview://")) continue;
          if (
            await frame
              .locator("#root .ant-app")
              .count()
              .catch(() => 0)
          ) {
            found = frame;
            return true;
          }
        }
        return false;
      },
      { timeout: 45_000, message: "Production Webview did not become ready" },
    )
    .toBe(true);
  if (found === undefined) throw new Error("Production Webview missing");
  return found;
}

/** Install current production assets as a normal extension in an isolated user profile. */
class VSCodeStorageRun {
  private app: ElectronApplication | undefined;
  private launchNumber = 0;
  readonly pids: number[] = [];
  readonly versions: string[] = [];
  readonly errors: string[] = [];
  readonly knownShellErrors: string[] = [];
  readonly directory: string;
  private readonly executable: string;
  private readonly info: TestInfo;
  constructor(directory: string, executable: string, info: TestInfo) {
    this.directory = directory;
    this.executable = executable;
    this.info = info;
  }

  async launch(): Promise<Frame> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        value !== undefined &&
        !/^(VSCODE_|MAMEP_)/i.test(key) &&
        key !== "ELECTRON_RUN_AS_NODE"
      )
        env[key] = value;
    }
    this.app = await _electron.launch({
      executablePath: this.executable,
      env,
      timeout: 60_000,
      args: [
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        "--new-window",
        "--locale=en",
        `--extensions-dir=${path.join(this.directory, "extensions")}`,
        `--user-data-dir=${path.join(this.directory, "user-data")}`,
      ],
    });
    const pid = this.app.process().pid;
    if (pid === undefined) throw new Error("VSCode process PID missing");
    expect(this.pids).not.toContain(pid);
    this.pids.push(pid);
    this.versions.push(await this.app.evaluate(({ app }) => app.getVersion()));
    this.launchNumber += 1;
    await this.app
      .context()
      .tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await this.app.firstWindow();
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.location().url.startsWith("vscode-webview://")
      )
        this.errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      if (!(error.stack ?? "").includes("vscode-webview://")) return;
      if (isKnownVSCodeWebviewShellPageError(error))
        this.knownShellErrors.push(String(error));
      else this.errors.push(String(error));
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    const command = page.locator(".quick-input-widget input");
    await expect(
      page.getByRole("menuitem", { name: "View", exact: true }),
    ).toBeVisible();
    const action = page
      .locator(".quick-input-list .monaco-list-row")
      .filter({ hasText: "Mamep2026" })
      .first();
    // The palette snapshots available commands when it opens. Reopen it until
    // startup extension discovery has registered the production panel command.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await page.keyboard.press("F1");
      await command.fill(">Mamep2026", { timeout: 2_000 });
      await expect(action).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await action.click();
    const frame = await uiFrame(page);
    await expect(
      frame.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    // The shell renders before plugin hydration finishes. Keep the fixture's
    // host theme equal to the initial workspace theme across every restart.
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            performance.getEntriesByName("mamep:startup:plugins-settled")
              .length,
        ),
      )
      .toBeGreaterThan(0);
    const theme = await frame.evaluate(() =>
      (
        window as unknown as { mamepHost: StorageBridge }
      ).mamepHost.getColorTheme(),
    );
    if (!theme.ok)
      throw new Error(`Host theme unavailable: ${theme.error.code}`);
    expect(theme.value).toBe("light");
    await expect
      .poll(async () => (await readApplicationStorage(frame)).workspace)
      .toMatchObject({ preferences: { theme: theme.value } });
    // A production extension rejects the debug RPC. A development launch must fail this test.
    const debug = await frame.evaluate(() =>
      (
        window as unknown as { mamepHost: StorageBridge }
      ).mamepHost.getDebugState(),
    );
    expect(debug.ok).toBe(false);
    if (!debug.ok) expect(debug.error.code).toBe("DEBUG_PROBE_DISABLED");
    expect(
      await frame.evaluate(() =>
        (
          window as unknown as { mamepHost: StorageBridge }
        ).mamepHost.sessionGetState(),
      ),
    ).toEqual({ ok: true, value: { connectionState: "disconnected" } });
    const scripts = await frame
      .locator("script[src]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("src")),
      );
    expect(scripts.length).toBeGreaterThan(0);
    expect(
      scripts.every((src) => src !== null && src.includes("vscode-resource")),
    ).toBe(true);
    const connection = frame
      .locator(".ant-modal-container")
      .filter({ hasText: "Connection Settings" });
    if (await connection.isVisible())
      await connection.locator(".ant-modal-close").click();
    await frame.getByRole("button", { name: "Settings", exact: true }).click();
    await frame
      .locator(".settings-drawer")
      .getByRole("tab", { name: "Plugins" })
      .click();
    await expect(frame.getByTestId("plugin-manager")).toBeVisible();
    return frame;
  }

  async close(): Promise<void> {
    const app = this.app;
    if (app === undefined) return;
    const trace = this.info.outputPath(`restart-${this.launchNumber}.zip`);
    await app.context().tracing.stop({ path: trace });
    await this.info.attach(`restart-${this.launchNumber}`, {
      path: trace,
      contentType: "application/zip",
    });
    const child = app.process();
    await app.close();
    this.app = undefined;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }

  /** Read the real VSCode Memento database only after the process has exited. */
  diskStore(): Store {
    if (this.app !== undefined)
      throw new Error("Close VSCode before reading its database");
    const database = new DatabaseSync(
      path.join(this.directory, "user-data/User/globalStorage/state.vscdb"),
      { readOnly: true },
    );
    try {
      const row = database
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get(EXTENSION_ID);
      if (typeof row?.value !== "string")
        throw new Error("Extension globalState missing");
      return JSON.parse(row.value)[STORAGE_KEY] as Store;
    } finally {
      database.close();
    }
  }

  async dispose(): Promise<void> {
    const target = path.resolve(this.directory);
    if (
      path.dirname(target) !== path.resolve(tmpdir()) ||
      !path.basename(target).startsWith("mamep-vscode-storage-")
    )
      throw new Error("Unexpected cleanup directory");
    try {
      await this.close();
    } finally {
      try {
        await cp(
          path.join(this.directory, "user-data/logs"),
          this.info.outputPath("vscode-logs"),
          { recursive: true },
        );
        await this.info.attach("processes-and-errors", {
          body: JSON.stringify(
            {
              pids: this.pids,
              versions: this.versions,
              errors: this.errors,
              knownShellErrors: this.knownShellErrors,
            },
            null,
            2,
          ),
          contentType: "application/json",
        });
      } finally {
        // Only remove the directory allocated by mkdtemp; unlink the dependency junction first.
        await rm(
          path.join(target, "extensions", EXTENSION_ID, "node_modules"),
          {
            recursive: true,
            force: true,
          },
        );
        await rm(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
        await this.info.attach("cleanup", {
          body: "VSCode closed; isolated user data, extension staging and plugin markers removed.",
          contentType: "text/plain",
        });
      }
    }
  }
}

const storageTest = test.extend<{ run: VSCodeStorageRun }>({
  // eslint-disable-next-line no-empty-pattern -- This fixture creates its own VSCode processes.
  run: async ({}, provide, info) => {
    const executable =
      process.env.MAMEP_VSCODE_EXECUTABLE ??
      (await downloadAndUnzipVSCode({
        version: process.env.MAMEP_VSCODE_VERSION ?? "stable",
        cachePath: path.join(ROOT, ".vscode-test"),
      }));
    const directory = await mkdtemp(
      path.join(tmpdir(), "mamep-vscode-storage-"),
    );
    const run = new VSCodeStorageRun(directory, executable, info);
    try {
      const staged = path.join(directory, "extensions", EXTENSION_ID);
      await mkdir(staged, { recursive: true });
      const extension = JSON.parse(
        await readFile(
          path.join(ROOT, "apps/vscode-extension/package.json"),
          "utf8",
        ),
      );
      const root = JSON.parse(
        await readFile(path.join(ROOT, "package.json"), "utf8"),
      );
      await writeFile(
        path.join(staged, "package.json"),
        JSON.stringify({
          name: "mamep2026",
          publisher: extension.publisher,
          displayName: extension.displayName,
          version: root.version,
          engines: extension.engines,
          main: extension.main,
          activationEvents: extension.activationEvents,
          contributes: extension.contributes,
        }),
      );
      await cp(
        path.join(ROOT, "apps/vscode-extension/dist"),
        path.join(staged, "dist"),
        { recursive: true },
      );
      await symlink(
        path.join(ROOT, "apps/vscode-extension/node_modules"),
        path.join(staged, "node_modules"),
        "junction",
      );
      await mkdir(path.join(directory, "user-data/User"), { recursive: true });
      await writeFile(
        path.join(directory, "user-data/User/settings.json"),
        JSON.stringify({
          "workbench.startupEditor": "none",
          "workbench.colorTheme": "Light Modern",
          "extensions.autoUpdate": false,
          "telemetry.telemetryLevel": "off",
        }),
      );
      await provide(run);
      expect(run.errors).toEqual([]);
    } finally {
      await run.dispose();
    }
  },
});

function pluginRow(frame: Frame, name: string) {
  return frame
    .getByTestId("plugin-manager")
    .locator(".ant-listy-item")
    .filter({ hasText: name });
}

/** Seed unapproved source, then use the real permission review and confirmation UI. */
async function approve(
  frame: Frame,
  name: string,
  mode: Mode = "isolated",
): Promise<void> {
  const row = pluginRow(frame, name);
  await row.getByRole("button", { name: "Review permissions" }).click();
  const dialog = frame
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(dialog).toContainText(name);
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
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(
      async () =>
        (await loadStore(frame)).plugins.find(
          (entry) => entry.manifest.name === name,
        )?.approval,
    )
    .toBeDefined();
}

function unapproved(id: string, name: string, source: string): Plugin {
  return {
    manifest: {
      id,
      name,
      version: "1.0.0",
      apiVersion: "2.0",
      description: "Storage access must fail with SecurityError",
      platform: { web: true, node: false },
      permissions: [],
      contributes: {},
    },
    enabled: false,
    entrySource: source,
    executionMode: "isolated",
  };
}

storageTest(
  "production Webview storage isolation, forged messages and disabled restart",
  async ({ run }, info) => {
    let frame = await run.launch();
    const attack = unapproved(
      "storage-isolation-regression",
      "Storage isolation regression",
      STORAGE_ATTACK_ENTRY,
    );
    const forged = unapproved(
      "forged-storage",
      "Forged storage",
      `self.postMessage({version:1,type:"plugin-store-save",data:{schemaVersion:6,plugins:[]}});\nexport const manifest = ${JSON.stringify({ ...attack.manifest, id: "forged-storage", name: "Forged storage" })}; export function activate() {}`,
    );
    await saveStore(frame, { schemaVersion: 6, plugins: [attack, forged] });
    await run.close();
    frame = await run.launch();
    await expect
      .poll(async () => (await readApplicationStorage(frame)).workspace)
      .not.toBeNull();
    await copyWorkspaceToBackup(frame);
    const before = applicationStorageContent(
      await readApplicationStorage(frame),
    );
    expect(before["workspace-backup"]).toEqual(before.workspace);
    expect(before.plugins).toBeNull();
    await approve(frame, attack.manifest.name);
    await expect(
      frame.locator('iframe[title="Plugin runtime"]'),
    ).toHaveAttribute("sandbox", "allow-scripts");
    const installed = await loadStore(frame);
    const approved = installed.plugins.find(
      (entry) => entry.manifest.id === attack.manifest.id,
    );
    if (approved === undefined) throw new Error("Approved record missing");
    expectApproval(approved);
    await pluginRow(frame, forged.manifest.name)
      .getByRole("button", { name: "Review permissions" })
      .click();
    await expect(
      frame
        .getByText("Failed to load the plugin entry.", { exact: true })
        .first(),
    ).toBeVisible();
    expect(await loadStore(frame)).toEqual(installed);
    expect(
      applicationStorageContent(await readApplicationStorage(frame)),
    ).toEqual(before);
    await run.close();
    expect(run.diskStore()).toEqual(installed);
    frame = await run.launch();
    await expect(
      pluginRow(frame, attack.manifest.name).getByRole("switch"),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      frame.locator('iframe[title="Plugin runtime"]'),
    ).toHaveAttribute("sandbox", "allow-scripts");
    expect(await loadStore(frame)).toEqual(installed);
    expect(
      applicationStorageContent(await readApplicationStorage(frame)),
    ).toEqual(before);
    await pluginRow(frame, attack.manifest.name).getByRole("switch").click();
    await expect(frame.locator('iframe[title="Plugin runtime"]')).toHaveCount(
      0,
    );
    await expect
      .poll(
        async () =>
          (await loadStore(frame)).plugins.find(
            (entry) => entry.manifest.id === attack.manifest.id,
          )?.enabled,
      )
      .toBe(false);
    const disabled = await loadStore(frame);
    await run.close();
    expect(run.diskStore()).toEqual(disabled);
    frame = await run.launch();
    await expect(
      pluginRow(frame, attack.manifest.name).getByRole("switch"),
    ).toHaveAttribute("aria-checked", "false");
    await expect(frame.locator('iframe[title="Plugin runtime"]')).toHaveCount(
      0,
    );
    expect(await loadStore(frame)).toEqual(disabled);
    await pluginRow(frame, attack.manifest.name).getByRole("switch").click();
    await expect(
      frame.locator('iframe[title="Plugin runtime"]'),
    ).toHaveAttribute("sandbox", "allow-scripts");
    await expect(
      pluginRow(frame, attack.manifest.name).getByRole("switch"),
    ).toHaveAttribute("aria-checked", "true");
    await info.attach("storage-snapshots", {
      body: JSON.stringify({ before, installed, disabled }, null, 2),
      contentType: "application/json",
    });
  },
);

storageTest(
  "real globalState restart rejects changed consent before Webview and Node imports",
  async ({ run }, info) => {
    const cases = [
      "intact",
      "disabled",
      "source",
      "mode",
      "approval",
      "manifest",
    ] as const;
    const records = cases.map((change) => {
      const id = `consent-${change}`;
      const record = unapproved(id, `Consent ${change}`, "");
      record.manifest.platform.node = true;
      record.manifest.executionRequirements = {
        version: 1,
        requiredExecution: change === "mode" ? "isolated" : "same-process",
      };
      // Top-level markers detect imports even when activate later fails or is never called.
      record.entrySource = `
if (typeof document !== "undefined") document.documentElement.setAttribute("data-${id}", "imported");
if (typeof process !== "undefined" && process.versions?.node) {
  const fs = await import("node:fs"); fs.appendFileSync(${JSON.stringify(path.join(run.directory, `${id}.txt`))}, "imported\\n");
}
export const manifest = ${JSON.stringify(record.manifest)};
export function activate() {}
`;
      return record;
    });
    let frame = await run.launch();
    await saveStore(frame, { schemaVersion: 6, plugins: records });
    await run.close();
    frame = await run.launch();
    for (const change of cases)
      await approve(
        frame,
        `Consent ${change}`,
        change === "mode" ? "isolated" : "same-process",
      );
    const approved = await loadStore(frame);
    for (const record of approved.plugins) expectApproval(record);
    for (const change of cases.filter((item) => item !== "mode")) {
      await expect(frame.locator("html")).toHaveAttribute(
        `data-consent-${change}`,
        "imported",
      );
      await expect
        .poll(() =>
          readFile(
            path.join(run.directory, `consent-${change}.txt`),
            "utf8",
          ).catch(() => ""),
        )
        .toContain("imported");
    }
    await run.close();
    expect(run.diskStore()).toEqual(approved);
    for (const change of cases)
      await rm(path.join(run.directory, `consent-${change}.txt`), {
        force: true,
      });
    frame = await run.launch();
    expect(await loadStore(frame)).toEqual(approved);
    for (const change of cases.filter((item) => item !== "mode")) {
      await expect(frame.locator("html")).toHaveAttribute(
        `data-consent-${change}`,
        "imported",
      );
      await expect
        .poll(() =>
          readFile(
            path.join(run.directory, `consent-${change}.txt`),
            "utf8",
          ).catch(() => ""),
        )
        .toContain("imported");
    }
    await pluginRow(frame, "Consent disabled").getByRole("switch").click();
    await expect
      .poll(
        async () =>
          (await loadStore(frame)).plugins.find(
            (entry) => entry.manifest.id === "consent-disabled",
          )?.enabled,
      )
      .toBe(false);
    const changed = await loadStore(frame);
    for (const record of changed.plugins) {
      if (record.manifest.id === "consent-source")
        record.entrySource += "\n// Changed source bytes.\n";
      if (record.manifest.id === "consent-mode")
        record.executionMode = "same-process";
      if (record.manifest.id === "consent-approval") delete record.approval;
      if (record.manifest.id === "consent-manifest")
        record.manifest.description += " Changed.";
    }
    // This is trusted-driver corruption, not a claim that an isolated plugin can reach globalState.
    await saveStore(frame, changed);
    await run.close();
    expect(run.diskStore()).toEqual(changed);
    for (const change of cases)
      await rm(path.join(run.directory, `consent-${change}.txt`), {
        force: true,
      });
    frame = await run.launch();
    await expect(frame.locator("html")).toHaveAttribute(
      "data-consent-intact",
      "imported",
    );
    await expect
      .poll(() =>
        readFile(path.join(run.directory, "consent-intact.txt"), "utf8").catch(
          () => "",
        ),
      )
      .toContain("imported");
    for (const change of cases.filter((item) => item !== "intact")) {
      const row = pluginRow(frame, `Consent ${change}`);
      await expect(row.getByRole("switch")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      if (change !== "disabled")
        await expect(
          row.getByRole("button", { name: "Review permissions" }),
        ).toBeVisible();
      await expect(frame.locator("html")).not.toHaveAttribute(
        `data-consent-${change}`,
        "imported",
      );
      await expect(
        readFile(path.join(run.directory, `consent-${change}.txt`), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(frame.locator('iframe[title="Plugin runtime"]')).toHaveCount(
      0,
    );
    const restored = await loadStore(frame);
    for (const record of changed.plugins) {
      const actual = restored.plugins.find(
        (entry) => entry.manifest.id === record.manifest.id,
      );
      expect(actual?.entrySource).toBe(record.entrySource);
      expect(actual?.executionMode).toBe(record.executionMode);
    }
    await info.attach("consent-snapshots", {
      body: JSON.stringify({ approved, changed, restored }, null, 2),
      contentType: "application/json",
    });
  },
);
