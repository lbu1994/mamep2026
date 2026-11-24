import type { Page } from "@playwright/test";
import { expect } from "../tests/fixtures";

export const ROW_COUNT = 1000;

export interface StoredRow {
  rowId: string;
  order: number;
  name: string;
  comment: string;
  addressDraft: string;
  addressValue: number | null;
  cellText: string;
  registerValues: number[] | null;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface StoredWorkspace {
  activeSheetId: string | null;
  sheets: Array<{
    sheetId: string;
    rows: StoredRow[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export async function readWorkspace(page: Page): Promise<StoredWorkspace> {
  const raw = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("mamep2026", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("kv");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("kv", "readonly")
            .objectStore("kv")
            .get("workspace");
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
  );
  if (typeof raw !== "object" || raw === null) {
    throw new Error("persisted workspace missing");
  }
  return raw as StoredWorkspace;
}

export async function writeWorkspace(
  page: Page,
  workspace: StoredWorkspace,
): Promise<void> {
  await page.evaluate(
    (next: StoredWorkspace) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("mamep2026", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("kv");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(next, "workspace");
          tx.objectStore("kv").delete("workspace-backup");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    workspace,
  );
}

export function buildRows(template: StoredRow, prefix: string): StoredRow[] {
  const now = Date.now();
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    ...template,
    rowId: `perf-${prefix}-${String(index + 1).padStart(4, "0")}`,
    order: index + 1,
    name: `Perf ${prefix} ${String(index + 1).padStart(4, "0")}`,
    comment: "",
    addressDraft: String(index),
    addressValue: index,
    cellText: (index % 0x10000).toString(16).padStart(4, "0").toUpperCase(),
    registerValues: [index],
    createdAt: now,
    updatedAt: now,
  }));
}

export async function seedWorkspace(page: Page): Promise<StoredWorkspace> {
  await page.goto("http://localhost:4173/");
  await page.locator(".register-table-tabs [data-row-key]").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await expect
    .poll(async () => {
      try {
        return (await readWorkspace(page)).sheets.length > 0;
      } catch {
        return false;
      }
    })
    .toBe(true);
  const workspace = await readWorkspace(page);
  const sheet = workspace.sheets[0];
  if (sheet === undefined || sheet.rows[0] === undefined) {
    throw new Error("default workspace has no sheet/row template");
  }
  sheet.rows = buildRows(sheet.rows[0], "");
  workspace.activeSheetId = sheet.sheetId;
  await writeWorkspace(page, workspace);
  return workspace;
}
