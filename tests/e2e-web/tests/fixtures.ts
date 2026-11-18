import { expect, test as base } from "@playwright/test";

/**
 * 浏览器 E2E 统一错误守门。
 *
 * console/page error 是每个场景都应满足的运行约束，不再为不同文件重复编写
 * “无 console 错误”独立用例。自动 fixture 会覆盖使用本 test 的每个用例。
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(`PAGEERROR: ${String(error)}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(`CONSOLE: ${message.text()}`);
        }
      });

      await use();

      const detail = errors.join("\n");
      if (detail.length > 0) {
        await testInfo.attach("console-errors", {
          body: detail,
          contentType: "text/plain",
        });
      }
      expect(errors, `console/page errors:\n${detail}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
