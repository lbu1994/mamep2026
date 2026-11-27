import { expect, test, type Page } from "@playwright/test";
import { createServer, type Socket } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import {
  launchIsolatedElectron,
  closeIsolatedElectron,
} from "../launch-isolated-electron";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../../..");

async function plugins(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  return page.getByTestId("plugin-manager");
}

test("Electron TCP consumes an installed codec and table transform through the production bridge", async () => {
  const received: number[][] = [];
  const values = new Map<number, number>([
    [15, 42],
    [17, 43],
  ]);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 7) {
        const length = pending.readUInt16BE(4) + 6;
        if (pending.length < length) return;
        const request = pending.subarray(0, length);
        pending = pending.subarray(length);
        received.push([...request]);
        const address = request.readUInt16BE(8);
        const count = request.readUInt16BE(10);
        let pdu: number[];
        if (request[7] === 65) {
          pdu = [65, count * 2];
          for (let index = 0; index < count; index++) {
            const value = values.get(address + index) ?? 0;
            pdu.push(value >> 8, value & 255);
          }
        } else if (request[7] === 66) {
          for (let index = 0; index < count; index++)
            values.set(address + index, request.readUInt16BE(12 + index * 2));
          pdu = [66];
        } else throw new Error(`Unexpected function code ${request[7]}`);
        socket.write(
          Buffer.from([
            request[0] ?? 0,
            request[1] ?? 0,
            0,
            0,
            0,
            pdu.length + 1,
            request[6] ?? 0,
            ...pdu,
          ]),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = server.address();
  if (endpoint === null || typeof endpoint === "string")
    throw new Error("Missing loopback port");
  const { app, userDataDir } = await launchIsolatedElectron({
    executablePath: require("electron") as string,
    mainEntry: "dist-electron/main.js",
    cwd: root,
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator(".ant-modal-container:visible .ant-modal-close").click();
    await app.evaluate(
      ({ dialog }, fixture) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [fixture],
        });
      },
      path.join(root, "tests/e2e-electron/fixtures/tcp-plugin.mjs"),
    );
    const section = await plugins(page);
    await section.getByRole("button", { name: "Install Plugin" }).click();
    const confirm = page
      .locator(".ant-modal-container")
      .filter({ hasText: "Install this plugin?" });
    await confirm
      .getByRole("button", {
        name: "Authorize same-process execution and install",
        exact: true,
      })
      .click();
    await expect(confirm).toBeHidden();
    await expect(
      section.getByTestId("host-plugin-state-tcp-routing-fixture"),
    ).toContainText("Host: active");
    await page.locator(".settings-drawer .ant-drawer-close").click();
    await page
      .getByRole("button", { name: "TCP fixture", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connection settings", exact: true })
      .click();
    const modal = page.locator(".ant-modal-container:visible");
    await expect(page.locator(".ant-modal:visible")).not.toHaveClass(
      /(?:zoom|fade)-(?:appear|enter)/,
    );
    await modal
      .locator(".ant-segmented-item")
      .filter({ hasText: "Modbus TCP" })
      .click();
    await modal.getByPlaceholder("192.168.1.10").fill("127.0.0.1");
    await modal
      .getByRole("spinbutton", { name: "TCP Port", exact: true })
      .fill(String(endpoint.port));
    await page
      .locator(".ant-modal:visible")
      .getByRole("button", { name: /connect/i })
      .click({ timeout: 10000 });
    await expect(modal).toHaveCount(0);
    await expect(page.locator(".ant-layout-header")).toContainText("Online");
    await page.evaluate(() => {
      const logs: unknown[] = [];
      Reflect.set(window, "tcpPluginLogs", logs);
      const bridge = Reflect.get(window, "mamepHost") as {
        onEvent(
          listener: (event: { kind: string; payload: unknown }) => void,
        ): () => void;
      };
      bridge.onEvent((event) => {
        if (event.kind === "comm-log") logs.push(event.payload);
      });
    });
    await page
      .getByRole("button", { name: "Table settings", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Address Adjust" }).click();
    await page.getByText("fixture.offset", { exact: true }).last().click();
    await expect(page.getByLabel("offset", { exact: true })).toHaveValue("5");
    await page
      .getByRole("button", { name: "Table settings", exact: true })
      .click();
    const address = page
      .locator('[data-register-cell="address"]:visible')
      .first();
    await address.click();
    await address.fill("10");
    await address.press("Enter");
    await page
      .getByRole("button", { name: /^Read row / })
      .first()
      .click();
    const data = page.locator('[data-register-cell="data"]:visible').first();
    await expect(data).toHaveText("002A");
    expect(received[0]?.slice(2, 12)).toEqual([0, 0, 0, 6, 1, 65, 0, 15, 0, 1]);
    await data.click();
    await data.fill("1234");
    await data.press("Enter");
    await page
      .getByRole("button", { name: /^Write row / })
      .first()
      .click();
    await expect.poll(() => values.get(15)).toBe(0x1234);
    await page
      .getByRole("button", { name: "Table settings", exact: true })
      .click();
    await page.getByLabel("offset", { exact: true }).fill("7");
    await page
      .getByRole("button", { name: "Table settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Read row / })
      .first()
      .click();
    await expect(data).toHaveText("002B");
    const logs: unknown = await page.evaluate(() =>
      Reflect.get(window, "tcpPluginLogs"),
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            pluginId: "tcp-routing-fixture",
            userAddress: 10,
            sentAddress: 15,
          }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({
            pluginId: "tcp-routing-fixture",
            userAddress: 10,
            sentAddress: 17,
          }),
        }),
      ]),
    );

    const manager = await plugins(page);
    const row = manager
      .locator(".ant-listy-item")
      .filter({ hasText: "TCP routing fixture" });
    await row.getByRole("switch").click();
    await expect(
      manager.getByTestId("host-plugin-state-tcp-routing-fixture"),
    ).toContainText("Host: disabled");
    const sentBefore = received.length;
    const rejected = await page.evaluate(async () => {
      const bridge = Reflect.get(window, "mamepHost") as {
        sessionBatchRead(
          id: string,
          rows: { key: string; sheetId: string; address: number }[],
          route: { unitAddress: number; protocol: string },
        ): Promise<{
          ok: boolean;
          value?: { summary: { failureCount: number; cancelledCount: number } };
        }>;
      };
      return bridge.sessionBatchRead(
        "revoked",
        [{ key: "row", sheetId: "sheet", address: 10 }],
        { unitAddress: 1, protocol: "fixture-tcp" },
      );
    });
    expect(rejected.ok).toBe(true);
    expect(rejected.value?.summary.cancelledCount).toBe(1);
    expect(received).toHaveLength(sentBefore);
    await test
      .info()
      .attach("tcp-plugin-evidence.json", {
        body: JSON.stringify({ received, logs, rejected }, null, 2),
        contentType: "application/json",
      });
    expect(errors).toEqual([]);
  } finally {
    await closeIsolatedElectron(app, userDataDir);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
