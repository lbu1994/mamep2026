import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
}

test("truncated sidebar group title exposes its full name on hover", async ({
  page,
}) => {
  await openApp(page);

  const groupTitle = page.locator(".sheet-sidebar__group-title").first();
  const fullName = await groupTitle.getAttribute("aria-label");
  expect(fullName).toBe("HOLDING REGISTERS (R/W)");
  await expect(groupTitle).toHaveAccessibleName(fullName ?? "");
  expect(
    await groupTitle.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);

  await groupTitle.hover();
  const tooltip = page.locator(".ant-tooltip:visible");
  await expect(tooltip).toContainText(fullName ?? "");
});

test("truncated sidebar group title exposes its full name on keyboard focus", async ({
  page,
}) => {
  await openApp(page);

  const groupTitle = page.locator(".sheet-sidebar__group-title").first();
  const fullName = await groupTitle.getAttribute("aria-label");
  expect(fullName).toBe("HOLDING REGISTERS (R/W)");
  await groupTitle.focus();
  await expect(groupTitle).toBeFocused();
  const tooltip = page.locator(".ant-tooltip:visible");
  await expect(tooltip).toContainText(fullName ?? "");
});
