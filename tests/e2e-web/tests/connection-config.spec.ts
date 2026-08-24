/**
 * 连接对象配置文件（ADR-023）e2e：浏览器端 ?connectionConfig=<base64> URL 载入
 * → Connection Settings「Load from Config File」展示来源与连接对象
 * → 选择 RTU 连接预填表单（baudRate 等端口参数）。
 * Mock 模式（?mockTransport=1）下 RTU 不选口，验证表单预填链路即可。
 */
import { expect, test, type Page } from "@playwright/test";

const MOCK_BASE = "http://localhost:5173/?mockTransport=1";

function base64Url(json: string): string {
  return Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const CONFIG_JSON = JSON.stringify({
  schemaVersion: 1,
  activeConnectionId: "rtu-com4",
  connections: [
    {
      id: "rtu-com4",
      name: "COM4 slave",
      protocol: "rtu",
      port: "COM4",
      baudRate: 115200,
      slaveAddress: 3,
    },
  ],
});

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  const url = `${MOCK_BASE}&connectionConfig=${base64Url(CONFIG_JSON)}`;
  await page.goto(url);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

async function openConnectionModal(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
}

test("URL 载入的连接配置：Connection Settings 展示来源并预填表单", async ({
  page,
}) => {
  const errors = await openApp(page);
  await openConnectionModal(page);

  // 「Load from Config File」分组与来源（url）展示。
  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal.getByText("Load from Config File")).toBeVisible();
  await expect(modal.getByText(/url/)).toBeVisible();

  // 打开连接对象下拉并选择 rtu-com4。
  const configSelect = modal.getByRole("combobox", {
    name: "Select a connection from config…",
  });
  await configSelect.click();
  await modal.getByText("COM4 slave").click();

  // 表单预填：Speed（baudRate）下拉显示 115200。
  await expect(
    modal.locator(".ant-form-item").filter({ hasText: "Speed" }).getByText("115200"),
  ).toBeVisible();

  // 无 console 错误。
  expect(errors).toEqual([]);
});
