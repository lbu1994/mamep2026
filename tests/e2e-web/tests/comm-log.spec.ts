import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

// Feed the public UI store directly so large-log checks do not depend on device speed.
async function appendLogBatch(
  page: Page,
  count: number,
  continuous = false,
): Promise<number> {
  return page.evaluate(
    async ({ batchSize, continuous }) => {
      const runtimeUrl = "/@id/@mamep2026/ui/runtime";
      const { useAppStore } = await import(runtimeUrl);
      const state = useAppStore.getState();
      const firstSeq = (state.commLog.at(-1)?.seq ?? -1) + 1;
      for (let entryIndex = 0; entryIndex < batchSize; entryIndex++) {
        if (continuous && entryIndex % 20 === 0) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        const seq = firstSeq + entryIndex;
        state.appendCommLog({
          seq,
          timestamp: 1700000000000 + seq,
          direction: "response",
          bytesHex: `01 03 02 ${seq.toString(16).toUpperCase().padStart(8, "0")}`,
          protocol: "rtu",
          slaveAddress: 1,
          functionCode: 3,
          userAddress: 0,
          sentAddress: 0,
          quantity: 1,
          attempt: 1,
          status: "success",
          errorCode: null,
          exceptionCode: null,
          source: "row",
          durationMs: 1,
        });
      }
      return firstSeq + batchSize - 1;
    },
    { batchSize: count, continuous },
  );
}

async function expectLatestLog(page: Page, seq: number): Promise<void> {
  const holder = page.locator(".comm-log .ant-listy-holder");
  await expect
    .poll(() =>
      holder.evaluate((el) => ({
        overflowing: el.scrollHeight > el.clientHeight,
        atBottom:
          el.scrollTop > 0 &&
          el.scrollHeight - el.scrollTop - el.clientHeight <= 1,
      })),
    )
    .toEqual({ overflowing: true, atBottom: true });
  const latest = holder.getByText(
    `01 03 02 ${seq.toString(16).toUpperCase().padStart(8, "0")}`,
    { exact: true },
  );
  await expect(latest).toBeInViewport();
}

test("comm log follows sustained batches through the retention limit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page);
  await openCommLogTab(page);
  for (let batchIndex = 0; batchIndex < 12; batchIndex++) {
    const lastSeq = await appendLogBatch(page, 1000);
    await expectLatestLog(page, lastSeq);
  }
  const retained = await page.evaluate(async () => {
    const runtimeUrl = "/@id/@mamep2026/ui/runtime";
    const { useAppStore } = await import(runtimeUrl);
    const entries = useAppStore.getState().commLog;
    return {
      count: entries.length,
      first: entries[0]?.seq,
      last: entries.at(-1)?.seq,
    };
  });
  expect(retained).toEqual({ count: 10000, first: 2000, last: 11999 });
  await expectLatestLog(page, await appendLogBatch(page, 400, true));
  await expectLatestLog(page, await appendLogBatch(page, 1));
});

test("comm log follows continuous appends before the retention limit", async ({
  page,
}) => {
  await openApp(page);
  await openCommLogTab(page);
  await expectLatestLog(page, await appendLogBatch(page, 2000, true));
});

test("comm log keeps following when a previous scroll event arrives after an append", async ({
  page,
}) => {
  await openApp(page);
  await openCommLogTab(page);
  await expectLatestLog(page, await appendLogBatch(page, 1000));
  await page.evaluate(async () => {
    const runtimeUrl = "/@id/@mamep2026/ui/runtime";
    const { useAppStore } = await import(runtimeUrl);
    const holder = document.querySelector(".comm-log .ant-listy-holder");
    if (holder === null) throw new Error("Missing log scroll holder");
    // Deliver the previous scroll notification after the next DOM update,
    // before a deferred animation-frame scroll can catch up with the new height.
    const observer = new MutationObserver(() => {
      observer.disconnect();
      holder.dispatchEvent(new Event("scroll"));
      const state = useAppStore.getState();
      const previous = state.commLog.at(-1);
      const seq = previous.seq + 1;
      state.appendCommLog({
        ...previous,
        seq,
        bytesHex: `01 03 02 ${seq.toString(16).toUpperCase().padStart(8, "0")}`,
      });
    });
    observer.observe(holder, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  const lastSeq = await appendLogBatch(page, 100);
  await expectLatestLog(page, lastSeq + 1);
  await expectLatestLog(page, await appendLogBatch(page, 100));
});

test("comm log resumes following when auto-scroll is enabled again", async ({
  page,
}) => {
  await openApp(page);
  await openCommLogTab(page);
  await expectLatestLog(page, await appendLogBatch(page, 1000));
  const toggle = page.getByRole("switch", { name: "Auto scroll" });
  await toggle.click();
  const holder = page.locator(".comm-log .ant-listy-holder");
  await holder.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(() => holder.evaluate((el) => el.scrollTop)).toBe(0);
  const lastSeq = await appendLogBatch(page, 100);
  await expect.poll(() => holder.evaluate((el) => el.scrollTop)).toBe(0);
  await toggle.click();
  await expectLatestLog(page, lastSeq);
  await expectLatestLog(page, await appendLogBatch(page, 1));
});

async function openApp(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  expect(
    errors,
    `console/page errors during startup: ${errors.join(" | ")}`,
  ).toEqual([]);
}

async function addEligibleRow(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.locator('[data-register-cell="address"]').first();
  await addressInput.click();
  await addressInput.fill("1");
  await addressInput.press("Enter");
}

async function openCommLogTab(page: Page): Promise<void> {
  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(200);
}

async function readOnce(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^Read row / })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(30);
}

/** 拦截 navigator.clipboard.writeText，避免 E2E 依赖系统剪贴板权限（稳定断言）。 */
async function interceptClipboardWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __commCopyWrites: string[] }).__commCopyWrites =
      writes;
    try {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            writes.push(text);
          },
        },
        configurable: true,
      });
    } catch {
      // 忽略替换失败，测试后续会给出明确失败信息。
    }
  });
}

test("comm log shows only time, direction and raw hex bytes", async ({
  page,
}) => {
  await openApp(page);
  await addEligibleRow(page);
  await readOnce(page);
  await openCommLogTab(page);

  const list = page.locator(".comm-log__list");
  await expect(list).toContainText("01 03 00 01 00 01", { timeout: 5000 });
  await expect(list).toContainText("Request");
  await expect(list).toContainText("Response");
  // 不解析/不展示功能码等协议字段。
  await expect(list).not.toContainText("Function");
});

test("comm log auto-scrolls to the bottom on new entries", async ({ page }) => {
  await openApp(page);
  await addEligibleRow(page);
  await openCommLogTab(page);

  // 产生足够日志使列表可滚动。
  for (let i = 0; i < 15; i++) {
    await readOnce(page);
  }

  // Listy 虚拟列表的实际滚动容器是 .ant-listy-holder（.comm-log__list root 不滚动）。
  const list = page.locator(".comm-log .ant-listy-holder");
  await expect(list).toHaveCount(1);
  // 前置：容器确实可滚动（scrollHeight > clientHeight），避免假阳性。
  await expect
    .poll(
      () =>
        list.evaluate((el) => {
          const e = el as HTMLElement;
          return e.scrollHeight > e.clientHeight;
        }),
      { timeout: 5000 },
    )
    .toBe(true);
  // 贴底：确实发生过滚动（scrollTop > 0）且剩余未滚动距离不超过阈值。
  await expect
    .poll(
      () =>
        list.evaluate((el) => {
          const e = el as HTMLElement;
          return (
            e.scrollTop > 0 &&
            e.scrollHeight - e.scrollTop - e.clientHeight <= 16
          );
        }),
      { timeout: 5000 },
    )
    .toBe(true);
});

test("comm log stops following when the auto-scroll switch is off", async ({
  page,
}) => {
  await openApp(page);
  await addEligibleRow(page);
  await openCommLogTab(page);

  for (let i = 0; i < 12; i++) {
    await readOnce(page);
  }

  // Listy 虚拟列表的实际滚动容器是 .ant-listy-holder。
  const list = page.locator(".comm-log .ant-listy-holder");
  // 前置：容器确实可滚动且已自动贴底（scrollTop > 0），确保后续断言针对真实滚动。
  await expect
    .poll(
      () =>
        list.evaluate((el) => {
          const e = el as HTMLElement;
          return e.scrollHeight > e.clientHeight && e.scrollTop > 0;
        }),
      { timeout: 5000 },
    )
    .toBe(true);

  // 关闭自动滚动开关。
  await page
    .getByRole("switch", { name: "Auto scroll" })
    .evaluate((el) => (el as HTMLElement).click());

  const scrollTopBefore = await list.evaluate((el) => el.scrollTop);

  // 继续产生日志，滚动位置不应变化（且新日志不再被跟随 → 贴底距离变大）。
  for (let i = 0; i < 5; i++) {
    await readOnce(page);
  }
  const scrollTopAfter = await list.evaluate((el) => el.scrollTop);
  expect(scrollTopAfter).toBe(scrollTopBefore);
  const distanceAfter = await list.evaluate(
    (el) =>
      (el as HTMLElement).scrollHeight -
      (el as HTMLElement).scrollTop -
      (el as HTMLElement).clientHeight,
  );
  // 关闭开关后新日志追加但未跟随 → 未贴底。
  expect(distanceAfter).toBeGreaterThan(16);
});

test("comm log pauses follow when the user scrolls up", async ({ page }) => {
  await openApp(page);
  await addEligibleRow(page);
  await openCommLogTab(page);

  for (let i = 0; i < 12; i++) {
    await readOnce(page);
  }

  // Listy 虚拟列表的实际滚动容器是 .ant-listy-holder。
  const list = page.locator(".comm-log .ant-listy-holder");
  // 前置：容器确实可滚动（避免假阳性）。
  await expect
    .poll(
      () =>
        list.evaluate((el) => {
          const e = el as HTMLElement;
          return e.scrollHeight > e.clientHeight;
        }),
      { timeout: 5000 },
    )
    .toBe(true);

  // 用户手动上滚到顶部（离开底部区域 → 暂停跟随）。
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);

  // 继续产生日志，不应自动滚回底部。
  for (let i = 0; i < 3; i++) {
    await readOnce(page);
  }
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
});

test("comm log copy writes formatted hex to the clipboard", async ({
  page,
}) => {
  await interceptClipboardWrites(page);
  await openApp(page);
  await addEligibleRow(page);
  await readOnce(page);
  await openCommLogTab(page);

  await expect(page.locator(".comm-log__list")).toContainText(
    "01 03 00 01 00 01",
    { timeout: 5000 },
  );
  await page
    .getByRole("button", { name: "Copy" })
    .evaluate((el) => (el as HTMLElement).click());

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __commCopyWrites: string[] }).__commCopyWrites
            .length,
      ),
    )
    .toBeGreaterThan(0);
  const text = await page.evaluate(
    () =>
      (window as unknown as { __commCopyWrites: string[] }).__commCopyWrites[0],
  );
  expect(text).toContain("01 03 00 01 00 01");
  expect(text).toContain("Request");
  // 复制内容不包含功能码解析字段。
  expect(text).not.toContain("Function");
});
