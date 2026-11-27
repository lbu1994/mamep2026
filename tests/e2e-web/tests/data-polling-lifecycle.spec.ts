import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

interface MockDevice {
  setRegister(address: number, value: number): void;
  getRegister(address: number): number | null;
  setResponseDelayMs(delayMs: number): void;
  getTraffic(): Array<{ direction: "request" | "response"; timestamp: number }>;
}

async function saveEvidence(info: TestInfo, name: string, evidence: unknown) {
  const file = info.outputPath(`${name}.json`);
  await writeFile(file, JSON.stringify(evidence, null, 2));
  await info.attach(name, { path: file, contentType: "application/json" });
}

async function findWindowPage(context: BrowserContext) {
  for (const page of context.pages()) {
    const cdp = await context.newCDPSession(page);
    try {
      const window = await cdp.send("Browser.getWindowForTarget");
      return { page, cdp, window };
    } catch (error) {
      await cdp.detach();
      if (
        !(error instanceof Error) ||
        !error.message.includes("Browser window not found")
      )
        throw error;
    }
  }
  return undefined;
}

// Keep the browser's normal background scheduling policy for this suite.
test.use({
  channel: "msedge",
  launchOptions: {
    ignoreDefaultArgs: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  },
});

function row(page: Page) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
    )
    .first();
}
async function traffic(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __mamepMock: MockDevice }).__mamepMock.getTraffic(),
  );
}
async function setup(page: Page) {
  await page.goto("http://localhost:5173/?mockTransport=1");
  await expect(page.getByRole("button", { name: /^Online/ })).toBeVisible({
    timeout: 15_000,
  });
  const address = row(page).locator('[data-register-cell="address"]');
  await address.click();
  await address.fill("1");
  await address.press("Enter");
  await page.evaluate(() => {
    const device = (window as unknown as { __mamepMock: MockDevice })
      .__mamepMock;
    device.setRegister(1, 16);
    device.setResponseDelayMs(10);
  });
}

test("focused Data accepts successful polling, preserves failed input, and never writes on Type changes", async ({
  page,
}, info) => {
  await setup(page);
  const data = row(page).locator('[data-register-cell="data"]');
  const wp = row(page).getByRole("switch", { name: /^Poll row/ });
  await wp.click();
  await expect(data).toHaveAttribute("data-committed-value", "0010");
  await data.click();
  await data.fill("ffff");
  await expect(data).toHaveValue("0010");
  await expect(data).toBeFocused();
  await expect(wp).toBeChecked();
  await page.evaluate(() =>
    (window as unknown as { __mamepMock: MockDevice }).__mamepMock.setRegister(
      1,
      32,
    ),
  );
  await expect(data).toHaveValue("0020");
  await data.press("Tab");
  await wp.click();
  await expect(wp).not.toBeChecked();
  await data.click();
  await data.fill("ab");
  await data.press("Enter");
  await expect(data).toHaveAttribute("data-committed-value", "00AB");
  await row(page)
    .getByRole("button", { name: /^Write row/ })
    .click();
  await expect(data).toHaveAttribute("data-committed-value", "00AB");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __mamepMock: MockDevice }
        ).__mamepMock.getRegister(1),
      ),
    )
    .toBe(171);

  const type = row(page).locator('[data-register-cell="type"]');
  await type.click();
  await page
    .locator(".ant-select-dropdown:visible [title='Unsigned Dec.']")
    .click();
  await expect(data).toHaveAttribute("data-committed-value", "171");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __mamepMock: MockDevice }
      ).__mamepMock.getRegister(1),
    ),
  ).toBe(171);

  // Address 512 belongs to the fixture's read-error range.
  const address = row(page).locator('[data-register-cell="address"]');
  await address.click();
  await address.fill("512");
  await address.press("Enter");
  await wp.click();
  await expect(
    row(page).locator('[data-polling-state="failure"]'),
  ).toBeVisible();
  await data.click();
  await data.fill("invalid");
  await expect
    .poll(
      async () =>
        (await traffic(page)).filter((event) => event.direction === "response")
          .length,
    )
    .toBeGreaterThan(4);
  await expect(data).toHaveValue("invalid");
  await data.press("Tab");
  await expect(data).toHaveAttribute("data-committed-value", "invalid");
  await expect(wp).toBeChecked();
  await wp.click();
  await saveEvidence(info, "request-response-timeline", await traffic(page));
});

test("real tab visibility pauses polling and resumes without accumulated requests", async ({
  playwright,
}, info) => {
  // Attach without focus emulation. A regular Playwright page stays visible even in a hidden tab.
  const executable = [
    process.env.MAMEP_EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((candidate) => candidate !== undefined && existsSync(candidate));
  if (!executable)
    throw new Error("System Edge is required for real visibility regression");
  const directory = await mkdtemp(path.join(tmpdir(), "mamep-visibility-"));
  const target = path.resolve(directory);
  if (
    path.dirname(target) !== path.resolve(tmpdir()) ||
    !path.basename(target).startsWith("mamep-visibility-")
  )
    throw new Error("Unexpected cleanup path");
  const child = spawn(
    executable,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${directory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,1000",
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let browser:
    Awaited<ReturnType<typeof playwright.chromium.connectOverCDP>> | undefined;
  const evidence: Record<string, unknown> = {};
  try {
    let port = "";
    let endpoint = "";
    await expect
      .poll(async () => {
        const lines = (
          await readFile(
            path.join(directory, "DevToolsActivePort"),
            "utf8",
          ).catch(() => "")
        )
          .trim()
          .split("\n");
        port = lines[0] ?? "";
        endpoint = lines[1] ?? "";
        return port;
      })
      .toMatch(/^\d+$/);
    browser = await playwright.chromium.connectOverCDP(
      `ws://127.0.0.1:${port}${endpoint}`,
      { noDefaults: true },
    );
    const context = browser.contexts()[0];
    if (!context) throw new Error("Missing default browser context");
    // Edge can expose a preloaded page that has no OS window. Exclude that target.
    let targetWindow: Awaited<ReturnType<typeof findWindowPage>>;
    await expect
      .poll(async () => {
        targetWindow = await findWindowPage(context);
        return targetWindow !== undefined;
      })
      .toBe(true);
    if (!targetWindow) throw new Error("Missing real Edge window");
    const { page, cdp: pageCdp, window } = targetWindow;
    await pageCdp.send("Emulation.setFocusEmulationEnabled", {
      enabled: false,
    });
    evidence.window = window;
    await page.bringToFront();
    await setup(page);
    const wp = row(page).getByRole("switch", { name: /^Poll row/ });
    await wp.click();
    await expect(
      row(page).locator('[data-polling-state="success"]'),
    ).toBeVisible();
    evidence.foreground = await traffic(page);
    const cover = await context.newPage();
    await cover.goto("about:blank");
    const coverCdp = await context.newCDPSession(cover);
    const coverWindow = await coverCdp.send("Browser.getWindowForTarget");
    expect(coverWindow.windowId).toBe(window.windowId);
    await cover.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("hidden");
    evidence.hiddenAt = await page.evaluate(() => performance.now());
    // Observe a quiet period; this delay is the behavior under test, not a race workaround.
    await page.waitForTimeout(1200);
    const settled = await traffic(page);
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");
    expect(await traffic(page)).toEqual(settled);
    evidence.hidden = settled;
    await page.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("visible");
    evidence.resumedAt = await page.evaluate(() => performance.now());
    await expect
      .poll(async () => (await traffic(page)).at(-1)?.timestamp ?? 0)
      .toBeGreaterThan(settled.at(-1)?.timestamp ?? 0);
    const resumed = (await traffic(page)).filter(
      (event) => event.timestamp > (settled.at(-1)?.timestamp ?? 0),
    );
    expect(resumed[0]?.direction).toBe("request");
    for (let index = 1; index < resumed.length; index++) {
      expect(resumed[index]?.direction).not.toBe(resumed[index - 1]?.direction);
    }
    evidence.resumed = resumed;
    const delayChangedAt = await page.evaluate(() => {
      (
        window as unknown as { __mamepMock: MockDevice }
      ).__mamepMock.setResponseDelayMs(20);
      return performance.now();
    });
    await expect
      .poll(
        async () =>
          (await traffic(page)).filter(
            (event) =>
              event.timestamp > delayChangedAt &&
              event.direction === "response",
          ).length,
      )
      .toBeGreaterThanOrEqual(4);
    const delayed = (await traffic(page)).filter(
      (event) => event.timestamp > delayChangedAt,
    );
    const durations: number[] = [];
    for (let index = 1; index < delayed.length; index++) {
      const previous = delayed[index - 1];
      const current = delayed[index];
      if (
        previous?.direction === "request" &&
        current?.direction === "response"
      )
        durations.push(current.timestamp - previous.timestamp);
    }
    expect(durations.length).toBeGreaterThanOrEqual(2);
    for (const duration of durations)
      expect(duration).toBeGreaterThanOrEqual(19);
    evidence.delayedRoundTripsMs = durations;
    await wp.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "Last successful update:",
    );
    await expect(page.getByRole("tooltip")).not.toContainText("unknown");
    await expect(wp).toBeChecked();
    await wp.click();
  } finally {
    if (browser) {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send("Browser.close").catch(() => {});
      await browser.close();
    } else child.kill();
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
    await saveEvidence(info, "visibility-and-traffic", evidence);
  }
});
