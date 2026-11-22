/**
 * 宽表横向扫读与区域层级：
 * - 顶栏/侧栏/表格/底部面板使用不同语义表面；
 * - 表头、斑马纹、hover、选中逐级可辨，且 v6 虚拟表格的整行单元格保持同色；
 * - 1366px 与宽屏下 Address/Data 仍为等宽字体，范围子行保持独立从属层级；
 * - 深浅主题均使用同一套状态令牌。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='connected']"),
  ).toBeVisible({ timeout: 15_000 });
}

async function resolveCssColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

async function switchToDarkTheme(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".settings-drawer .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-mamep-theme",
    "dark",
  );
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

test("宽表行状态、区域层级和范围子行在深浅主题下保持清晰", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openApp(page);

  const table = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-wrapper",
  );
  const rows = table.locator(".ant-table-tbody .ant-table-row[data-row-key]");
  const rowFill = (index: number) =>
    rows.nth(index).locator(".ant-table-cell").nth(3);

  // 区域表面各自可辨，但依然全部来自低饱和语义令牌。
  const regionBackgrounds = await Promise.all([
    page
      .locator(".mamep-header")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    page
      .locator(".sheet-sidebar")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    page
      .locator(".register-table-wrap")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    page
      .locator(".bottom-panel")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(new Set(regionBackgrounds).size).toBe(4);

  // 行状态按 基础 < 斑马纹 < hover < 选中 分层。
  const baseFill = await resolveCssColor(page, "--mamep-table-row-bg");
  const stripedFill = await resolveCssColor(
    page,
    "--mamep-table-row-striped-bg",
  );
  const hoverFill = await resolveCssColor(page, "--mamep-table-row-hover-bg");
  const selectedFill = await resolveCssColor(
    page,
    "--mamep-table-row-selected-bg",
  );

  await expect(rowFill(0)).toHaveCSS("background-color", baseFill);
  await expect(rowFill(1)).toHaveCSS("background-color", stripedFill);

  await rows.nth(4).hover();
  await expect(rowFill(4)).toHaveCSS("background-color", hoverFill);

  await rows.nth(2).locator("input[type='checkbox']").first().check();
  await page.mouse.move(0, 0);
  await expect(rowFill(2)).toHaveCSS("background-color", selectedFill);
  // 当前默认列集未启用 antd fixed 列；通过真实 sticky 类名验证冻结单元格继承行状态。
  await rowFill(2).evaluate((cell) =>
    cell.classList.add("ant-table-cell-fix-left"),
  );
  await expect(rowFill(2)).toHaveCSS("background-color", selectedFill);
  await rowFill(2).evaluate((cell) =>
    cell.classList.remove("ant-table-cell-fix-left"),
  );
  await expect
    .poll(async () =>
      rows
        .nth(2)
        .locator(".ant-table-cell")
        .evaluateAll((cells) => [
          ...new Set(
            cells.map((cell) => getComputedStyle(cell).backgroundColor),
          ),
        ])
        .then((colors) => colors.length),
    )
    .toBe(1);

  // Address / Data 继续使用数据字体角色。
  const addressFont = await rows
    .nth(0)
    .locator('[data-register-cell="address"]')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  const dataFont = await rows
    .nth(0)
    .locator('[data-register-cell="data"]')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(addressFont.toLowerCase()).toContain("monospace");
  expect(dataFont.toLowerCase()).toContain("monospace");

  // 范围行展开后，子行使用独立从属底色与树状竖轨，行高不漂移。
  const first = rows.nth(0);
  const address = first.locator('[data-register-cell="address"]');
  await address.click();
  await address.fill("0-1");
  await address.press("Enter");
  await first.locator("button[aria-label='Expand row']").click();
  const childRow = table
    .locator(".ant-table-tbody .ant-table-row.register-table__row--child")
    .first();
  await expect(childRow).toBeVisible();

  const childFill = await resolveCssColor(page, "--mamep-table-child-bg");
  await expect(childRow.locator(".ant-table-cell").nth(3)).toHaveCSS(
    "background-color",
    childFill,
  );
  await expect(childRow).toHaveCSS("height", "29px");
  await expect(childRow.locator(".ant-table-cell").first()).not.toHaveCSS(
    "box-shadow",
    "none",
  );

  // 宽屏下同一行的所有单元格保持相同顶边，便于跨列追踪。
  await page.setViewportSize({ width: 1920, height: 1080 });
  const cellTops = await first
    .locator(".ant-table-cell")
    .evaluateAll((cells) => [
      ...new Set(
        cells.map((cell) => Math.round(cell.getBoundingClientRect().top)),
      ),
    ]);
  expect(cellTops).toHaveLength(1);

  // 深色主题切换后沿用同一状态语义，且与浅色值不同。
  await switchToDarkTheme(page);
  await page.mouse.move(0, 0);
  const darkBaseFill = await resolveCssColor(page, "--mamep-table-row-bg");
  const darkStripedFill = await resolveCssColor(
    page,
    "--mamep-table-row-striped-bg",
  );
  const darkChildFill = await resolveCssColor(page, "--mamep-table-child-bg");
  expect(darkBaseFill).not.toBe(baseFill);
  expect(darkStripedFill).not.toBe(stripedFill);
  expect(darkChildFill).not.toBe(childFill);

  await expect(childRow.locator(".ant-table-cell").nth(3)).toHaveCSS(
    "background-color",
    darkChildFill,
  );
  await expect(first).toHaveCSS("height", "29px");
});
