/**
 * Android USB-RS485 UI 面 E2E——**无需任何 USB 硬件即可在真机运行**。
 *
 * 覆盖能力位翻转后的可观察结果：协议分组出现（RTU + TCP）、RTU 表单完整、
 * 串口下拉走 `serialPorts: "enumerated"` 分支且能打开（设备为空时显示空态而不是崩溃），
 * 全程无 console 错误。
 *
 * 真实 USB 读写在 rtu-loop.spec.ts（需硬件，`MAMEP_ANDROID_USB_SERIAL=1` 门控）。
 */
import { expect, test } from "@playwright/test";
import {
  clickConnect,
  connectionModal,
  openAppSession,
  openSerialPortDropdown,
  selectRtuProtocol,
  serialPortSelect,
  type AppSession,
} from "../helpers/app";

let session: AppSession;

test.beforeAll(async () => {
  session = await openAppSession();
});

test.afterAll(async () => {
  await session?.close();
});

test("USB 串口能力已声明：协议分组出现、RTU 表单完整、串口下拉可用", async () => {
  const { page } = session;

  // 平台确认为 Android（Capacitor 容器；同一份 UI 产物）。
  expect(await page.evaluate(() => window.Capacitor?.getPlatform?.())).toBe(
    "android",
  );

  // 能力位翻转（modbusRtu:true + serialPorts:"enumerated"）→ 协议分组可见。
  await expect(connectionModal(page)).toContainText("Modbus TCP");
  await expect(connectionModal(page)).toContainText("Modbus RTU");

  await selectRtuProtocol(page);

  // RTU 表单字段（与 Electron/VSCode 同源的表单；文案按实际渲染值断言）。
  for (const label of [
    "Port",
    "Speed",
    "Data Length",
    "Stop Bit",
    "Parity Bit",
    "Flow Control",
  ]) {
    await expect(
      connectionModal(page)
        .locator(".ant-form-item-label")
        .filter({ hasText: label })
        .first(),
    ).toBeVisible();
  }

  // enumerated 分支：下拉可打开（空设备时展示空态，不是能力错误）。
  await expect(serialPortSelect(page)).toBeVisible();
  const dropdown = await openSerialPortDropdown(page);
  // 打开即证明原生 listSerialPorts 被调用且回包通过 Zod 校验（失败会在弹窗内显示错误）。
  await expect(dropdown).toBeVisible();
  await page.keyboard.press("Escape");

  // 未选择端口时 CONNECT 应被门控（无错误通道，只断言按钮存在且表单未连接）。
  await expect(
    connectionModal(page).locator(".ant-btn").filter({ hasText: "CONNECT" }),
  ).toBeVisible();
});

test("未选端口直接 CONNECT 不会崩（能力错误以提示呈现）", async () => {
  const { page } = session;

  await clickConnect(page);
  await page.waitForTimeout(1000);

  // 仍停在弹窗（未连接成功），页面未崩溃、表格仍在。
  await expect(connectionModal(page)).toBeVisible();
  await expect(page.locator(".register-table-tabs")).toBeVisible();
});

test("全程无 console 错误", () => {
  // Capacitor debug 构建会把每次插件调用以 log 形式打进 console（非 error），
  // 这里只断言 error/pageerror，与三端 e2e 口径一致。
  expect(session.consoleErrors).toEqual([]);
});
