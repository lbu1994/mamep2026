import { expect } from "@playwright/test";

/** Android 套件结束时统一检查 console/page error。 */
export function expectNoConsoleErrors(errors: readonly string[]): void {
  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
}
