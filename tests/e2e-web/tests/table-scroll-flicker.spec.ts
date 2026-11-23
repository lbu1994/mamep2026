/**
 * 大型滚轮/翻页跳转的虚拟表稳定性：
 * - 原生大幅滚轮滚动最终到达请求的位置；
 * - 过渡期间始终有可绘制行，已挂载的可见行不会降级成占位样式；
 * - 新进入窗口的占位与真实控件保持相同高度；
 * - 虚拟行和单元格高度保持一致，避免滚动位置产生偏移。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openChineseApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".mamep-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".settings-drawer.ant-drawer-open")
    .waitFor({ state: "visible" });
  await page.locator(".settings-drawer .ant-select").nth(1).click();
  await page.getByText("中文", { exact: true }).last().click();
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  await expect(page.locator(".settings-drawer.ant-drawer-open")).toBeHidden();
  await expect(page.locator(".ant-drawer-mask")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("button", { name: "设置", exact: true }),
  ).toBeFocused();
}

interface ScrollFrame {
  visibleRows: number;
  placeholderCount: number;
  placeholdersInExistingRows: number;
  incompleteVisibleRows: number;
  rowHeights: number[];
  cellHeights: number[];
  textPlaceholderVisuals: ControlVisual[];
  buttonPlaceholderCount: number;
  buttonPlaceholderComponentCount: number;
  selectPlaceholderVisuals: ControlVisual[];
  disabledSelectPlaceholderVisuals: ControlVisual[];
  selectArrowPlaceholderVisuals: ControlVisual[];
  selectValuePlaceholderVisuals: ControlVisual[];
  switchPlaceholderCount: number;
  switchPlaceholderComponentCount: number;
  checkboxPlaceholderCount: number;
  checkboxPlaceholderComponentCount: number;
  /** 各可见行内开关相对行顶的偏移（px）；占位与真实开关应一致，防止垂直上跳。 */
  switchRowOffsets: number[];
}

interface ControlVisual {
  height: number;
  color: string;
  backgroundColor: string;
  borderTopColor: string;
  borderTopStyle: string;
  borderTopWidth: string;
  borderRadius: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  paddingLeft: string;
  paddingRight: string;
  opacity: string;
  boxShadow: string;
}

interface ControlVisuals {
  text: ControlVisual[];
  select: ControlVisual[];
  disabledSelect: ControlVisual[];
  selectArrow: ControlVisual[];
  selectValue: ControlVisual[];
  /** 已挂载真实开关相对行顶的偏移（px）。 */
  switchRowOffset: number | null;
}

test("大型滚轮翻页时已有行不降级且新行占位尺寸一致", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await openChineseApp(page);

  const holder = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
  );
  await expect(holder).toBeVisible();
  const holderBox = await holder.boundingBox();
  if (holderBox === null) throw new Error("virtual table holder has no bounds");
  const initialRowKeys = await holder
    .locator("[data-row-key]")
    .evaluateAll((rows) =>
      rows.flatMap((row) => {
        const key = row.getAttribute("data-row-key");
        return key === null ? [] : [key];
      }),
    );
  const controlVisuals = await holder.evaluate((holder): ControlVisuals => {
      const visual = (
        element: Element | null,
        name: string,
      ): ControlVisual => {
        if (element === null) throw new Error(`control visual not found: ${name}`);
        const style = getComputedStyle(element);
        return {
          height: Math.round(element.getBoundingClientRect().height),
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderRadius,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          opacity: style.opacity,
          boxShadow: style.boxShadow,
        };
      };
      const rows = Array.from(
        holder.querySelectorAll<HTMLElement>("[data-row-key]"),
      );
      const collect = (selector: string): ControlVisual[] =>
        rows.flatMap((row) =>
          Array.from(row.querySelectorAll(selector), (element) =>
            visual(element, selector),
          ),
        );
      const switchRow = rows.find(
        (row) => row.querySelector(".register-table__wp .ant-switch") !== null,
      );
      const switchEl =
        switchRow?.querySelector<HTMLElement>(
          ".register-table__wp .ant-switch",
        ) ?? null;
      const switchRowOffset =
        switchRow === undefined || switchEl === null
          ? null
          : Math.round(
              (switchEl.getBoundingClientRect().top -
                switchRow.getBoundingClientRect().top) *
                10,
            ) / 10;
      return {
        text: collect(".register-table__editable-cell-value-wrap"),
        select: collect(".ant-select:not(.ant-select-disabled)"),
        disabledSelect: collect(".ant-select.ant-select-disabled"),
        selectArrow: collect(".ant-select .anticon"),
        // antd v6 单选选中值是 .ant-select-content 内的文本节点（不再渲染
        // .ant-select-selection-item），这里对值容器比对文本相关视觉样式。
        selectValue: collect(".ant-select .ant-select-content"),
        switchRowOffset,
      };
    });

  const monitor = page.evaluate(
    async (startingRowKeys: string[]): Promise<ScrollFrame[]> => {
      const start = performance.now();
      const samples: ScrollFrame[] = [];
      const visual = (element: Element): ControlVisual => {
        const style = getComputedStyle(element);
        return {
          height: Math.round(element.getBoundingClientRect().height),
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderRadius,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          opacity: style.opacity,
          boxShadow: style.boxShadow,
        };
      };
      const visuals = (
        holder: HTMLElement,
        selector: string,
      ): ControlVisual[] =>
        Array.from(holder.querySelectorAll(selector), visual);
      await new Promise<void>((resolve) => {
        const capture = (): void => {
          const holder = document.querySelector<HTMLElement>(
            ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
          );
          if (holder !== null) {
            const holderRect = holder.getBoundingClientRect();
            const visibleRows = Array.from(
              holder.querySelectorAll<HTMLElement>("[data-row-key]"),
            ).filter((row) => {
              const rect = row.getBoundingClientRect();
              return (
                rect.bottom > holderRect.top && rect.top < holderRect.bottom
              );
            });
            const interactiveRows = visibleRows.filter(
              (row) =>
                !row.classList.contains("register-table__row--child") &&
                !row.classList.contains("register-table__row--bit"),
            );
            const incompleteVisibleRows = interactiveRows.filter(
              (row) =>
                (row.querySelectorAll(".ant-checkbox").length < 2 &&
                  row.querySelector(
                    ".register-table__virtual-placeholder--checkbox",
                  ) === null) ||
                (row.querySelector(".register-table__row-action--read") ===
                  null &&
                  !Array.from(
                    row.querySelectorAll(
                      ".register-table__virtual-placeholder--button",
                    ),
                  ).some((placeholder) =>
                    placeholder.textContent?.includes("读取"),
                  )) ||
                (row.querySelector(".register-table__row-action--write") ===
                  null &&
                  !Array.from(
                    row.querySelectorAll(
                      ".register-table__virtual-placeholder--button",
                    ),
                  ).some((placeholder) =>
                    placeholder.textContent?.includes("写入"),
                  )) ||
                (row.querySelector(".register-table__wp-switch") === null &&
                  row.querySelector(
                    ".register-table__virtual-placeholder--switch",
                  ) === null) ||
                row.querySelectorAll(".ant-select").length +
                  row.querySelectorAll(
                    ".register-table__virtual-placeholder--select",
                  ).length <
                  2 ||
                row.querySelectorAll(
                  ".register-table__editable-cell-value-wrap",
                ).length +
                  row.querySelectorAll(
                    ".register-table__virtual-placeholder--text",
                  ).length <
                  4,
            ).length;
            const placeholdersInExistingRows = visibleRows.filter((row) => {
              const rowKey = row.getAttribute("data-row-key");
              return (
                rowKey !== null &&
                startingRowKeys.includes(rowKey) &&
                row.querySelector(".register-table__virtual-placeholder") !==
                  null
              );
            }).length;
            const selectPlaceholders = Array.from(
              holder.querySelectorAll<HTMLElement>(
                ".register-table__virtual-placeholder--select",
              ),
            );
            samples.push({
              visibleRows: visibleRows.length,
              placeholderCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder",
              ).length,
              placeholdersInExistingRows,
              incompleteVisibleRows,
              rowHeights: visibleRows.map((row) =>
                Math.round(row.getBoundingClientRect().height),
              ),
              cellHeights: visibleRows.flatMap((row) =>
                Array.from(row.querySelectorAll(".ant-table-cell")).map(
                  (cell) => Math.round(cell.getBoundingClientRect().height),
                ),
              ),
              textPlaceholderVisuals: visuals(
                holder,
                ".register-table__virtual-placeholder--text",
              ),
              buttonPlaceholderCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder--button",
              ).length,
              buttonPlaceholderComponentCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder--button .ant-btn",
              ).length,
              selectPlaceholderVisuals: selectPlaceholders
                .filter(
                  (placeholder) =>
                    !placeholder.classList.contains(
                      "register-table__virtual-placeholder--disabled",
                    ),
                )
                .map(visual),
              disabledSelectPlaceholderVisuals: selectPlaceholders
                .filter((placeholder) =>
                  placeholder.classList.contains(
                    "register-table__virtual-placeholder--disabled",
                  ),
                )
                .map(visual),
              selectArrowPlaceholderVisuals: visuals(
                holder,
                ".register-table__virtual-placeholder-select-arrow .anticon",
              ),
              selectValuePlaceholderVisuals: visuals(
                holder,
                ".register-table__virtual-placeholder-select-value",
              ),
              switchPlaceholderCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder--switch",
              ).length,
              switchPlaceholderComponentCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder--switch .ant-switch",
              ).length,
              checkboxPlaceholderCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder--checkbox",
              ).length,
              checkboxPlaceholderComponentCount: holder.querySelectorAll(
                ".register-table__virtual-placeholder--checkbox .ant-checkbox",
              ).length,
              switchRowOffsets: visibleRows.flatMap((row) => {
                const switches = Array.from(
                  row.querySelectorAll<HTMLElement>(".ant-switch"),
                );
                return switches.map(
                  (sw) =>
                    Math.round(
                      (sw.getBoundingClientRect().top -
                        row.getBoundingClientRect().top) *
                        10,
                    ) / 10,
                );
              }),
            });
          }
          if (performance.now() - start < 1800) requestAnimationFrame(capture);
          else resolve();
        };
        requestAnimationFrame(capture);
      });
      return samples;
    },
    initialRowKeys,
  );

  const pointer = {
    x: holderBox.x + holderBox.width / 2,
    y: holderBox.y + holderBox.height / 2,
  };
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, 700);
  try {
    await expect
      .poll(() => holder.evaluate((element) => element.scrollTop))
      .toBe(700);
  } catch (error) {
    console.log(
      "wheel queue debug",
      await page.locator("html").getAttribute("data-virtual-wheel-debug"),
      await holder.evaluate((element) => element.scrollTop),
    );
    throw error;
  }
  const samples = await monitor;

  expect(samples.some((sample) => sample.visibleRows === 0)).toBe(false);
  expect(samples.some((sample) => sample.placeholderCount > 0)).toBe(true);
  expect(
    samples.every((sample) => sample.placeholdersInExistingRows === 0),
  ).toBe(true);
  expect(samples.every((sample) => sample.incompleteVisibleRows === 0)).toBe(
    true,
  );
  expect([...new Set(samples.flatMap((sample) => sample.rowHeights))]).toEqual([
    29,
  ]);
  expect([...new Set(samples.flatMap((sample) => sample.cellHeights))]).toEqual(
    [29],
  );
  const visualSignatures = (visuals: ControlVisual[]): string[] =>
    [...new Set(visuals.map((visual) => JSON.stringify(visual)))].sort();
  // 选中值文本是 .ant-select-content 内的文本节点，容器几何（height/display）与
  // 占位 span 结构不同，只比对决定文本观感的属性，避免结构差异造成假阳性。
  const valueTextSignatures = (visuals: ControlVisual[]): string[] =>
    [
      ...new Set(
        visuals.map(({ color, fontFamily, fontSize, fontWeight, lineHeight }) =>
          JSON.stringify({ color, fontFamily, fontSize, fontWeight, lineHeight }),
        ),
      ),
    ].sort();
  expect(
    visualSignatures(
      samples.flatMap((sample) => sample.textPlaceholderVisuals),
    ),
  ).toEqual(visualSignatures(controlVisuals.text));
  expect(
    samples.some((sample) => sample.buttonPlaceholderCount > 0),
  ).toBe(true);
  expect(
    samples.filter((sample) => sample.buttonPlaceholderCount > 0).every(
      (sample) =>
        sample.buttonPlaceholderComponentCount ===
        sample.buttonPlaceholderCount,
    ),
  ).toBe(true);
  expect(
    visualSignatures(
      samples.flatMap((sample) => sample.selectPlaceholderVisuals),
    ),
  ).toEqual(visualSignatures(controlVisuals.select));
  expect(
    visualSignatures(
      samples.flatMap((sample) => sample.disabledSelectPlaceholderVisuals),
    ),
  ).toEqual(visualSignatures(controlVisuals.disabledSelect));
  expect(
    visualSignatures(
      samples.flatMap((sample) => sample.selectArrowPlaceholderVisuals),
    ),
  ).toEqual(visualSignatures(controlVisuals.selectArrow));
  expect(
    valueTextSignatures(
      samples.flatMap((sample) => sample.selectValuePlaceholderVisuals),
    ),
  ).toEqual(valueTextSignatures(controlVisuals.selectValue));
  expect(samples.some((sample) => sample.switchPlaceholderCount > 0)).toBe(
    true,
  );
  expect(
    samples
      .filter((sample) => sample.switchPlaceholderCount > 0)
      .every(
        (sample) =>
          sample.switchPlaceholderComponentCount ===
          sample.switchPlaceholderCount,
      ),
  ).toBe(true);
  expect(samples.some((sample) => sample.checkboxPlaceholderCount > 0)).toBe(
    true,
  );
  expect(
    samples
      .filter((sample) => sample.checkboxPlaceholderCount > 0)
      .every(
        (sample) =>
          sample.checkboxPlaceholderComponentCount ===
          sample.checkboxPlaceholderCount,
      ),
  ).toBe(true);
  // WP 开关在占位态与真实态相对行顶的偏移必须一致（display:contents 透传后，
  // 开关不再被 24px 盒垂直居中抬升 5px）。
  expect(controlVisuals.switchRowOffset).not.toBeNull();
  expect(
    [...new Set(samples.flatMap((sample) => sample.switchRowOffsets))],
  ).toEqual([controlVisuals.switchRowOffset]);
  expect(errors).toEqual([]);
});

test("PageDown / PageUp 在表格内滚动并可往返", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openChineseApp(page);

  const holder = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
  );
  await expect(holder).toBeVisible();
  const box = await holder.boundingBox();
  if (box === null) throw new Error("virtual table holder has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const pageKeyTarget = holder.locator("button").first();
  await pageKeyTarget.focus();
  await expect(pageKeyTarget).toBeFocused();
  const pageDistance = await holder.evaluate(
    (element) => element.clientHeight - 29,
  );

  await page.keyboard.press("PageDown");
  await expect
    .poll(() => holder.evaluate((element) => element.scrollTop))
    .toBe(pageDistance);

  await page.keyboard.press("PageUp");
  await expect
    .poll(() => holder.evaluate((element) => element.scrollTop))
    .toBe(0);
});

test("移动端虚拟表行与单元格保持 44px 触控高度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL);
  await expect(page.locator(".mamep-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);

  const holder = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
  );
  await expect(holder).toBeVisible();
  const row = holder.locator("[data-row-key]").first();
  await expect(row).toBeVisible();
  const heights = await row.evaluate((element) => ({
    row: Math.round(element.getBoundingClientRect().height),
    cells: Array.from(element.querySelectorAll(".ant-table-cell")).map((cell) =>
      Math.round(cell.getBoundingClientRect().height),
    ),
  }));

  expect(heights.row).toBe(44);
  expect([...new Set(heights.cells)]).toEqual([44]);
});

test("移动端 Type/Scale 列滚动期不出现占位，直接渲染原生 select", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL);
  await expect(page.locator(".mamep-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);

  const holder = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
  );
  await expect(holder).toBeVisible();
  // 快速滚轮制造新进入窗口的行，并在升级窗口内采样。
  const box = await holder.boundingBox();
  if (box === null) throw new Error("virtual table holder has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 700);
  const seenPlaceholderSelect = await holder.evaluate((element) =>
    Array.from(element.querySelectorAll("[data-row-key]")).some(
      (row) =>
        row.querySelector(".register-table__virtual-placeholder--select") !==
        null,
    ),
  );
  // 移动端原生 select 廉价，Type/Scale 不应再走滚动占位，避免 span↔原生 select 变脸。
  expect(seenPlaceholderSelect).toBe(false);
  // 可见行内 Type/Scale 均已渲染原生 select。
  const nativeSelects = await holder.evaluate(
    (element) =>
      element.querySelectorAll(".register-table__native-select").length,
  );
  expect(nativeSelects).toBeGreaterThan(0);
});
