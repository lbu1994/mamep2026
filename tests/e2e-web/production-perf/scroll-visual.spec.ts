import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { expect, test } from "../tests/fixtures";
import { seedWorkspace, writeWorkspace } from "./workspace-fixture";

test.use({ trace: "retain-on-failure" });

interface VisualPart {
  key: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  font: string;
  decoration: string;
}

interface RowFrame {
  key: string;
  deferred: boolean;
  height: number;
  parts: VisualPart[];
}

interface ScrollFrame {
  elapsedMs: number;
  scrollTop: number;
  placeholderCount: number;
  rows: RowFrame[];
}

/** Observe geometry separately from timing budgets: layout reads add probe cost. */
async function captureScroll(page: Page, target: "bottom" | "top") {
  return page.evaluate(async (destination): Promise<ScrollFrame[]> => {
    const holder = document.querySelector<HTMLElement>(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
    );
    if (holder === null) throw new Error("Virtual holder missing");
    const frames: ScrollFrame[] = [];
    const started = performance.now();
    const targetTop =
      destination === "bottom" ? holder.scrollHeight - holder.clientHeight : 0;
    holder.scrollTop = targetTop;
    let settledFrames = 0;
    await new Promise<void>((resolve, reject) => {
      const capture = (): void => {
        const viewport = holder.getBoundingClientRect();
        const rows = Array.from(
          holder.querySelectorAll<HTMLElement>("[data-row-key]"),
        )
          .filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.bottom > viewport.top && rect.top < viewport.bottom;
          })
          .map((row): RowFrame => {
            const bounds = row.getBoundingClientRect();
            const parts: VisualPart[] = [];
            const part = (
              key: string,
              text: string,
              rect: DOMRect,
              element: Element,
            ): void => {
              const style = getComputedStyle(element);
              const thumb = element.matches(".register-table__wp-switch")
                ? getComputedStyle(element, "::before")
                : null;
              parts.push({
                key,
                text,
                x: rect.x - bounds.x,
                y: rect.y - bounds.y,
                width: rect.width,
                height: rect.height,
                color: style.color,
                font: `${style.fontFamily}/${style.fontSize}/${style.fontWeight}/${style.lineHeight}`,
                decoration: key.includes(":text:")
                  ? ""
                  : [
                      style.backgroundColor,
                      style.borderColor,
                      style.borderWidth,
                      style.borderRadius,
                      style.opacity,
                      style.boxShadow,
                      thumb === null
                        ? ""
                        : `${thumb.insetInlineStart}/${thumb.width}/${thumb.height}/${thumb.backgroundColor}`,
                    ].join("/"),
              });
            };
            Array.from(
              row.querySelectorAll<HTMLElement>(".ant-table-cell"),
            ).forEach((cell, column) => {
              part(`${column}:cell`, "", cell.getBoundingClientRect(), cell);
              const walker = document.createTreeWalker(
                cell,
                NodeFilter.SHOW_TEXT,
              );
              let textIndex = 0;
              for (
                let node = walker.nextNode();
                node !== null;
                node = walker.nextNode()
              ) {
                const parent = node.parentElement;
                if (
                  parent === null ||
                  !node.textContent?.trim() ||
                  parent.closest(
                    ".register-table__sr-only, .ant-tooltip, option",
                  ) !== null
                )
                  continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                part(
                  `${column}:text:${textIndex++}`,
                  node.textContent,
                  rect,
                  parent,
                );
              }
              cell
                .querySelectorAll<HTMLElement>(
                  ".anticon, button, input[type=checkbox], .ant-select, .register-table__virtual-placeholder--select",
                )
                .forEach((element, index) => {
                  part(
                    `${column}:control:${index}`,
                    element.getAttribute("data-icon") ??
                      element.querySelector("svg")?.getAttribute("data-icon") ??
                      element.getAttribute("aria-checked") ??
                      "",
                    element.getBoundingClientRect(),
                    element,
                  );
                });
            });
            return {
              key: row.dataset.rowKey ?? "",
              deferred:
                row.querySelector(".register-table__virtual-placeholder") !==
                null,
              height: bounds.height,
              parts,
            };
          });
        const placeholderCount = holder.querySelectorAll(
          ".register-table__virtual-placeholder",
        ).length;
        frames.push({
          elapsedMs: performance.now() - started,
          scrollTop: holder.scrollTop,
          placeholderCount,
          rows,
        });
        const atTarget = Math.abs(holder.scrollTop - targetTop) < 1;
        settledFrames =
          atTarget && placeholderCount === 0 && rows.length > 0
            ? settledFrames + 1
            : 0;
        if (settledFrames >= 3) resolve();
        else if (performance.now() - started > 5000)
          reject(new Error("Scroll did not settle"));
        else requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
    return frames;
  }, target);
}

for (const scenario of [
  { theme: "light", language: "en-US", zoom: 1 },
  { theme: "dark", language: "zh-CN", zoom: 1.25 },
] as const) {
  test(`scroll visuals remain stable: ${scenario.theme}, ${scenario.language}, CSS scale ${scenario.zoom}`, async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace(page);
    workspace.preferences = {
      themePrimary: null,
      theme: scenario.theme,
      language: scenario.language,
    };
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("Seed sheet missing");
    // Exercise clipped names, different radix labels, and enabled/disabled scale controls.
    sheet.rows.forEach((row, index) => {
      row.name = `Long register name for visual alignment ${index}`;
      row.comment = `Comment ${index}`;
      row.dataType = index % 2 === 0 ? "hex" : "unsigned";
      row.pollingEnabled = index % 2 === 0;
    });
    await writeWorkspace(page, workspace);
    await page.reload();
    await expect(page.locator('[data-row-key="perf--0001"]')).toBeVisible();
    const modal = page.locator(".ant-modal-wrap:visible");
    if (await modal.isVisible()) {
      await modal.locator(".ant-modal-close").click();
      await expect(modal).toBeHidden();
    }
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, scenario.zoom);
    await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);
    await expect(
      page.locator(".register-table__virtual-placeholder"),
    ).toHaveCount(0);
    // Let ResizeObserver finish the requested scaling before starting a scroll.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve, reject) => {
        let previous = "";
        let stableFrames = 0;
        const deadline = performance.now() + 5000;
        const sample = (): void => {
          const cells = document.querySelectorAll(
            ".register-table-tabs .ant-tabs-content-active [data-row-key]:first-child .ant-table-cell",
          );
          const current = JSON.stringify(
            Array.from(cells, (cell) => {
              const rect = cell.getBoundingClientRect();
              return [rect.x, rect.y, rect.width, rect.height];
            }),
          );
          stableFrames =
            current === previous && cells.length > 0 ? stableFrames + 1 : 0;
          previous = current;
          if (stableFrames >= 3) resolve();
          else if (performance.now() > deadline)
            reject(new Error("Scaled table did not settle"));
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });

    for (const target of ["bottom", "top"] as const) {
      const frames = await captureScroll(page, target);
      const evidencePath = testInfo.outputPath(`${target}-frames.json`);
      writeFileSync(evidencePath, JSON.stringify(frames));
      await testInfo.attach(`${target}-frames.json`, {
        path: evidencePath,
        contentType: "application/json",
      });
      expect
        .soft(
          frames.every((frame) => frame.rows.length > 0),
          "No blank visible window",
        )
        .toBe(true);
      expect(
        frames.some((frame) => frame.placeholderCount > 0),
        "Exercise deferred rendering",
      ).toBe(true);
      const final = frames.at(-1);
      if (final === undefined) throw new Error("No scroll frames");
      expect(final.placeholderCount).toBe(0);
      const finalRows = new Map(final.rows.map((row) => [row.key, row]));
      let compared = 0;
      const differences: string[] = [];
      for (const frame of frames) {
        for (const row of frame.rows) {
          const reference = finalRows.get(row.key);
          if (reference === undefined) continue;
          if (Math.abs(row.height - 29 * scenario.zoom) > 0.1)
            differences.push(`${row.key}: row height ${row.height}`);
          const expectedParts = new Map(
            reference.parts.map((part) => [part.key, part]),
          );
          for (const actual of row.parts) {
            const expected = expectedParts.get(actual.key);
            if (expected === undefined) {
              differences.push(
                `${row.key}/${actual.key}: control or text disappears`,
              );
              continue;
            }
            compared++;
            for (const property of ["x", "y", "width", "height"] as const) {
              if (Math.abs(actual[property] - expected[property]) > 0.5) {
                differences.push(
                  `${row.key}/${actual.key}/${property}: ${actual[property]} -> ${expected[property]}`,
                );
              }
            }
            if (
              actual.text !== expected.text ||
              actual.color !== expected.color ||
              actual.font !== expected.font ||
              actual.decoration !== expected.decoration
            ) {
              differences.push(
                `${row.key}/${actual.key}: text or style changes`,
              );
            }
          }
          if (row.parts.length !== reference.parts.length)
            differences.push(`${row.key}: visible parts change`);
        }
      }
      expect(compared).toBeGreaterThan(0);
      expect
        .soft(
          [...new Set(differences)],
          "Every visible frame matches the settled row",
        )
        .toEqual([]);
    }
    const data = page.locator(
      '[data-row-key="perf--0001"] [data-register-cell="data"]',
    );
    await data.click();
    await page.locator('input[data-register-cell="data"]').fill("BEEF");
    await page.keyboard.press("Enter");
    await expect(data).toHaveText("BEEF");
    await expect(data).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("settled-table.png") });
  });
}
