import { expect } from "@playwright/test";

/** 宿主套件结束时统一检查 console/page error，避免每个文件复制一条同义测试。 */
export function expectNoConsoleErrors(errors: readonly string[]): void {
  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
}
