import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Each case edits five rows and verifies two complete paste/undo/redo cycles.
test.setTimeout(90_000);

function rows(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
  );
}

async function resetRows(page: Page, count: number) {
  const panel = page.locator(".register-table-tabs .ant-tabs-content-active");
  await expect(rows(page).first()).toBeVisible();
  await panel.locator(".ant-table-thead .ant-checkbox-input").check();
  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(0);
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Control+i");
  }
  await expect(rows(page)).toHaveCount(count);
}

for (const entry of ["keyboard", "menu"] as const) {
  for (const selection of ["range", "noncontiguous"] as const) {
    for (const writeFails of [false, true]) {
      test(`cross-table ${selection} multi-row copy and paste via ${entry}, write fails: ${writeFails}`, async ({
        page,
      }) => {
        await page.addInitScript((writeFails) => {
          let clipboard =
            "Name,Address,Data,Type,Comment\nOld row,99,0001,hex,Old clipboard";
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (text: string) => {
                if (writeFails)
                  throw new DOMException(
                    "Clipboard write denied",
                    "NotAllowedError",
                  );
                clipboard = text;
              },
              readText: async () => clipboard,
            },
          });
        }, writeFails);
        await page.goto("http://localhost:5173/?mockTransport=1");
        await expect(page.locator(".ant-layout-header")).toContainText(
          "Online",
        );
        await resetRows(page, 5);
        const expectedFields = Array.from({ length: 5 }, (_, index) => ({
          name: `Row ${index}, "copied"`,
          address: index === 2 ? "32-33" : String(16 + index),
          data: index === 2 ? "1234 ABCD" : `000${index + 1}`,
          comment: `Comment ${index}`,
        }));
        for (const [index, values] of expectedFields.entries()) {
          for (const [column, value] of Object.entries(values)) {
            const cell = rows(page)
              .nth(index)
              .locator(`[data-register-cell="${column}"]`);
            await cell.click();
            await cell.fill(value);
            await cell.press("Enter");
          }
        }
        const sourceIds = await rowIds(page);
        await page
          .locator(
            '.sheet-sidebar__group-head[data-sheet-group="holding-register"] .sheet-sidebar__group-action',
          )
          .click();
        await expect(
          page.locator(".register-table-tabs .ant-tabs-tab-active"),
        ).toContainText("Sheet 2");
        await resetRows(page, 1);
        const targetIds = await rowIds(page);
        await page
          .getByRole("tab", { name: "HOLDING REGISTERS Sheet 1", exact: true })
          .click();
        await expect(rows(page)).toHaveCount(5);
        const sourceRows = rows(page);
        for (const index of selection === "range" ? [0] : [4, 0, 2]) {
          await sourceRows
            .nth(index)
            .locator(".ant-table-selection-column input")
            .check();
        }
        if (selection === "range") {
          await sourceRows
            .nth(2)
            .locator(".ant-table-selection-column input")
            .click({ modifiers: ["Shift"] });
        }
        await expect(
          sourceRows.locator(".ant-table-selection-column input:checked"),
        ).toHaveCount(3);
        if (entry === "keyboard") {
          await page.keyboard.press("Control+c");
        } else {
          await sourceRows
            .nth(2)
            .getByRole("button", { name: "Drag to reorder" })
            .click({ button: "right" });
          await page.getByRole("menuitem", { name: /Copy/ }).click();
        }
        await expect(
          sourceRows.locator(".ant-table-selection-column input:checked"),
        ).toHaveCount(3);
        const clipboard = await page.evaluate(() =>
          navigator.clipboard.readText(),
        );
        expect(clipboard.split("\n")).toHaveLength(writeFails ? 2 : 4);
        await page
          .getByRole("tab", { name: "HOLDING REGISTERS Sheet 2", exact: true })
          .click();
        await expect(rows(page)).toHaveCount(1);
        for (const repetition of [1, 2]) {
          if (entry === "keyboard") {
            await rows(page)
              .last()
              .locator(".ant-table-selection-column input")
              .check();
            await page.keyboard.press("Control+v");
          } else {
            await rows(page)
              .last()
              .getByRole("button", { name: "Drag to reorder" })
              .click({ button: "right" });
            await page.getByRole("menuitem", { name: /Paste/ }).click();
          }
          await expect(rows(page)).toHaveCount(1 + 3 * repetition);
          const indexes = selection === "range" ? [0, 1, 2] : [0, 2, 4];
          for (const [offset, index] of indexes.entries()) {
            const expected = expectedFields[index];
            if (expected === undefined)
              throw new Error("Missing expected source row");
            const row = rows(page).nth(1 + 3 * (repetition - 1) + offset);
            for (const [column, value] of Object.entries(expected)) {
              await expect(
                row.locator(`[data-register-cell="${column}"]`),
              ).toHaveText(value);
            }
            await expect(
              row.locator('[data-register-cell="type"]'),
            ).toContainText("HEX");
          }
        }
        const pastedIds = await rowIds(page);
        expect(pastedIds[0]).toBe(targetIds[0]);
        expect(new Set([...sourceIds, ...pastedIds]).size).toBe(12);
        // Each paste is one history entry; redo restores the same row identities.
        await page.keyboard.press("Control+z");
        await expect(rows(page)).toHaveCount(4);
        expect(await rowIds(page)).toEqual(pastedIds.slice(0, 4));
        await page.keyboard.press("Control+z");
        await expect(rows(page)).toHaveCount(1);
        expect(await rowIds(page)).toEqual(targetIds);
        await page.keyboard.press("Control+Shift+z");
        await expect(rows(page)).toHaveCount(4);
        await page.keyboard.press("Control+y");
        await expect(rows(page)).toHaveCount(7);
        expect(await rowIds(page)).toEqual(pastedIds);
        await page
          .getByRole("tab", { name: "HOLDING REGISTERS Sheet 1", exact: true })
          .click();
        await expect(rows(page)).toHaveCount(5);
        expect(await rowIds(page)).toEqual(sourceIds);
      });
    }
  }
}

async function rowIds(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-row-key") ?? ""),
  );
}
