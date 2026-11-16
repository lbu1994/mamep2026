/**
 * Android USB-RS485 真实闭环 E2E——**需要 USB 串口硬件，默认跳过**。
 *
 * 真实路径（无任何桩）：真机 WebView → `AndroidAppHost` → `AndroidPlatformHost.openSerialTransport`
 * → `CapacitorUsbSerialTransport` → Capacitor 桥 → app 内原生 `MamepTransportPlugin`
 * （USB Host + usb-serial-for-android）→ 物理 USB-RS485 → PC 侧 Modbus RTU 从站。
 *
 * 前置（缺一不可）：
 * 1. USB 转接器插在**手机**上（OTG），另一端接 PC 侧从站（或另一只 USB-TTL，TX↔RX 交叉 + 共地）；
 * 2. PC 侧先启动 RTU 从站：`pnpm slave`（端口/波特率见 `config/connections.json`）；
 * 3. 手机首次连接需在系统弹窗里确认 USB 权限（用例会等待，最长 30s）；
 * 4. 显式开启：`MAMEP_ANDROID_USB_SERIAL=1 pnpm test:e2e:android`。
 *
 * 断言策略（不依赖从站预置值）：读回 Data 为 4 位 HEX；写入 0x1234 后由写后回读复核为 1234。
 */
import { expect, test } from "@playwright/test";
import {
  clickConnect,
  connectionModal,
  openAppSession,
  openSerialPortDropdown,
  readRow,
  selectRtuProtocol,
  setRowAddress,
  setWriteVerify,
  writeRow,
  type AppSession,
} from "../helpers/app";

const enabled = process.env.MAMEP_ANDROID_USB_SERIAL === "1";

test.skip(
  !enabled,
  "USB-RS485 闭环需真机 + USB 转接器 + PC 侧从站；设 MAMEP_ANDROID_USB_SERIAL=1 开启",
);

let session: AppSession;

test.beforeAll(async () => {
  session = await openAppSession();
});

test.afterAll(async () => {
  await session?.close();
});

test("USB-RS485：枚举 → 连接 → FC03 读 → FC10 写（写后回读）→ 断开", async () => {
  const { page } = session;

  // 切到 RTU 并选择端口（枚举下拉的第一项 = 手机上唯一的 USB 串口）。
  await selectRtuProtocol(page);
  const dropdown = await openSerialPortDropdown(page);
  const options = dropdown.locator(".ant-select-item-option");
  await expect(options.first()).toBeVisible({ timeout: 15_000 });
  await options.first().click();
  await page.waitForTimeout(300);

  await clickConnect(page);

  // 连接成功：弹窗关闭 + 头部 Disconnect 可见（可能需用户在系统弹窗确认权限）。
  await expect(connectionModal(page)).toBeHidden({ timeout: 60_000 });
  const disconnectButton = page
    .locator(".mamep-header")
    .getByRole("button", { name: "Disconnect" });
  await expect(disconnectButton).toBeVisible({ timeout: 30_000 });

  // 通信属性面板应显示所选串口标签（本 Host 记录的 portLabel）。
  await expect(
    page.locator(".ant-layout-footer, .bottom-panel").first(),
  ).toBeVisible();

  // 新表默认 OFF；本用例显式 ON，以覆盖写后回读一致性。
  await expect(page.locator(".table-toolbar__verify")).toContainText("OFF");
  await setWriteVerify(page, "ON");

  // FC03：首行读回 4 位 HEX（真实从站返回值）。
  await setRowAddress(page, "0");
  await readRow(page);
  const dataInput = page.getByLabel("Data", { exact: true }).first();
  await expect(dataInput).toHaveText(/^[0-9A-F]{4}$/, { timeout: 30_000 });

  // FC10 + 写后回读（显式 ON）：写入 1234 后回读一致。
  await writeRow(page, "1234");
  await expect(dataInput).toHaveText("1234", { timeout: 30_000 });
  await setWriteVerify(page, "OFF");

  await disconnectButton.evaluate((element) =>
    (element as HTMLElement).click(),
  );
  await expect(disconnectButton).toBeHidden({ timeout: 20_000 });
});

test("全程无 console 错误", () => {
  expect(session.consoleErrors).toEqual([]);
});
