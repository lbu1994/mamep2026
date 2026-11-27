/**
 * Electron 端「真实串口」RTU e2e（com0com COM4↔COM5 + 真实 Web Serial）。
 *
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 真实端口路径：Renderer Web Serial（主进程 select-serial-port 最小授权）→
 * Connection Settings 串口下拉（用户手势触发枚举，主进程转发端口列表）→
 * 自动选择配置文件中指定的串口（config/connections.json rtu-com4-master.port，
 * 本 spec 读取该文件，不硬编码）→ 真实串口读写闭环。
 *
 * 门控：仅 MAMEP_REAL=1（由 scripts/e2e-real.mjs 设置）时运行。
 * 运行方式：pnpm test:e2e:electron:real（runner 预检 + 拉起 COM5 从站）。
 *
 * 场景与浏览器 real-serial 一致：连接 Online → FC03 读 / FC10 写 + 读回 → 写值门控
 * → 异常区 → no-response 超时 → 边界 → 扩展（分片/延迟）→ 通信日志 → 断开 → 无 console 错误。
 *
 * 插件不再随包分发/首启安装，故本 spec 在基础表用例前**先经
 * Settings → Plugins 安装** `custom-function-code` 插件（`pnpm build:plugins` 产物，
 * 安装时授权「同进程执行」——codec / dataType 属同步注册面），否则侧边栏不会出现
 * 自定义功能码分组。
 */
import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { clearWorkspaceFile } from "../clear-workspace-file";
import {
  closeIsolatedElectron,
  launchIsolatedElectron,
} from "../launch-isolated-electron";
import { expectNoConsoleErrors } from "../no-console-guard";

const require = createRequire(import.meta.url);
/** 仓库根目录（本文件位于 tests/e2e-electron/tests-real/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CONNECTED_TIMEOUT = 15_000;
/** 自定义功能码示例插件（手动安装；贡献 codec / dataType / tableType）。 */
const CUSTOM_FC_PLUGIN_ID = "custom-function-code";
/**
 * ASCII 字符串区（从站保持寄存器 0x0010–0x001F，16 寄存器 = 32 字符）。
 * 期望文本直接由从站配置解码得出（`scripts/modbus-slave/modbus-slave.config.json`
 * 为唯一事实源，与从站自测 / README 一致，测试内不硬编码字符串）。
 */
function asciiStringRegion(): {
  start: number;
  registerCount: number;
  text: string;
} {
  const start = 0x0010;
  const registerCount = 16;
  const config = JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        "scripts",
        "modbus-slave",
        "modbus-slave.config.json",
      ),
      "utf8",
    ),
  ) as { registers: Record<string, number> };
  let text = "";
  for (let i = 0; i < registerCount; i += 1) {
    const value = Number(config.registers[String(start + i)] ?? 0) & 0xffff;
    text += String.fromCharCode((value >> 8) & 0xff, value & 0xff);
  }
  return { start, registerCount, text };
}
const CUSTOM_FC_ENTRY_PATH = path.resolve(
  REPO_ROOT,
  "release/plugins",
  CUSTOM_FC_PLUGIN_ID,
  `${CUSTOM_FC_PLUGIN_ID}.mjs`,
);
/** 侧边栏分组标题（插件 tableType 贡献的 i18n 文案，aria-label = 组标题）。 */
const CUSTOM_FC_GROUP_LABEL = "Custom FC 65H/66H (example plugin)";

// 门控：真实端口测试需显式开启（MAMEP_REAL=1，由 scripts/e2e-real.mjs 设置）。
test.skip(
  process.env.MAMEP_REAL !== "1",
  "真实端口测试需显式开启（MAMEP_REAL=1，由 pnpm test:e2e:electron:real 触发）",
);

/** 读取 config/connections.json 的 rtu-com4-master（连接参数唯一事实源，不硬编码）。 */
function rtuConfig(): { port: string; baudRate: number; slaveAddress: number } {
  const raw = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "config", "connections.json"), "utf8"),
  );
  const conn = raw.connections.find(
    (c: { id: string }) => c.id === "rtu-com4-master",
  );
  if (conn === undefined)
    throw new Error("config/connections.json 缺少 rtu-com4-master");
  return {
    port: conn.port,
    baudRate: conn.baudRate,
    slaveAddress: conn.slaveAddress,
  };
}

let app: ElectronApplication;
let page: Page;
let userDataDir: string | undefined;
const consoleErrors: string[] = [];

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致）。 */
async function setRadixHex(p: Page): Promise<void> {
  const panel = await openTableSettings(p);
  const radix = panel.locator(".table-toolbar__radix");
  await radix
    .locator(".ant-segmented-item")
    .filter({ hasText: "HEX" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(radix).toContainText("HEX", { timeout: 5000 });
  await p.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 5000 });
}
/**
 * 把 RTU 超时 Select 设为固定档位。真实端口 e2e 稳定连接：应用默认超时为 50ms
 * 对 com0com 虚拟串口偏紧，测试连接显式设为 100ms（应用默认维持 50ms）。
 *  增补长档位后键入 "100" 会同时匹配 "100 ms" 与 "1000 ms"，Enter 落点不保证 →
 * 使用「键入收窄列表（antd 下拉为虚拟列表）+ 精确点选 <值> ms」。
 * 收窄方式为**直接 fill 搜索框**（与 e2e-vscode 同源）——
 * 键盘输入依赖窗口焦点，失焦时列表不收敛 → 虚拟列表不渲染目标档位 → 点选超时。
 */
async function setRtuTimeoutSelect(
  p: Page,
  modal: Locator,
  timeoutMs: number,
): Promise<void> {
  const select = modal
    .locator(".ant-form-item")
    .filter({ hasText: "Timeout" })
    .locator(".ant-select")
    .first();
  await select.click();
  // 直接写入 Select 的搜索框（focus + input 事件），不依赖窗口键盘焦点。
  await select.locator("input").fill(String(timeoutMs));
  // 锚定正则只命中目标档位（避免前缀匹配到 "1000 ms"）。
  const option = p
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: new RegExp(`^${timeoutMs} ms$`) });
  await option.waitFor({ state: "visible", timeout: 10_000 });
  await option.click();
  // 确认 Select 回显值精确等于目标档位。
  await expect(select).toHaveText(new RegExp(`^${timeoutMs} ms$`));
}
/**
 * 活动表内容面板（多 Sheet 时限定到当前活动表，避免命中隐藏表单元格/工具栏）。
 * antd v6 活动面板 DOM 类名为 `.ant-tabs-content-active`（AGENTS.md「antd v6 关键差异」）。
 */
const activeTable = (p: Page) =>
  p.locator(".register-table-tabs .ant-tabs-content-active");

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(p: Page, addressHex: string): Promise<void> {
  const cell = activeTable(p).locator('[data-register-cell="address"]').first();
  await cell.click();
  // 等待进入编辑态：click 触发 React 重渲染渲染出 input（生产构建高负载下可能延迟，
  // 且前序读/写操作的行重渲染尚未 settle 时点击可能命中旧节点）。toBeEditable 自动
  // 重试直到 input 出现，比裸 waitForTimeout 可靠（real e2e 竞态）。
  const input = activeTable(p)
    .locator('[data-register-cell="address"]')
    .first();
  await expect(input).toBeEditable({ timeout: 5000 });
  // Playwright fill() 用原生 value setter 设置 DOM 值，偶发不触发 React onChange
  // （draftRef 未同步但 DOM value 已变，toHaveValue 假通过，Enter 提交读到旧 draft 而
  // 短路）。使用 fill("")+pressSequentially 逐字符输入（真实键盘事件，onChange 必然触发），
  // toHaveValue 确认受控值同步后再 Enter。
  await input.fill("");
  await input.pressSequentially(addressHex, { delay: 10 });
  await expect(input).toHaveValue(addressHex);
  await input.press("Enter");
  await expect(
    activeTable(p).locator('input[data-register-cell="address"]'),
  ).toHaveCount(0);
  await expect(
    activeTable(p).locator('[data-register-cell="address"]').first(),
  ).toHaveAttribute("data-committed-value", addressHex);
}

/** 首行点击 Read。 */
async function readRow(p: Page): Promise<void> {
  const button = activeTable(p)
    .getByRole("button", { name: /^Read row / })
    .first();
  // Enter 提交到 Store/轮询目标映射是异步宏任务；按钮变为 enabled 才表示首行地址与
  // 连接路由均已就绪，避免在提交完成前点击禁用按钮。
  await expect(button).toBeEnabled({ timeout: 5000 });
  await button.click();
}

/** 把活动表首行 Type（进制列）切到指定选项（antd Select 选项按 title 定位）。 */
async function setRowType(p: Page, optionTitle: string): Promise<void> {
  await activeTable(p).locator('[data-register-cell="type"]').first().click();
  await p
    .locator(`.ant-select-dropdown:visible [title='${optionTitle}']`)
    .click();
}

/** 打开活动表的 Table settings 面板。 */
async function openTableSettings(p: Page) {
  const active = activeTable(p);
  const trigger = active
    .getByRole("button", { name: "Table settings", exact: true })
    .first();
  // Popover 面板经 portal 渲染，不能限定在活动表子树内。
  const panel = p.locator(".table-toolbar__settings:visible").first();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible({ timeout: 5000 });
  return panel;
}

/** 显式切换活动表的写后回读配置。 */
async function setWriteVerify(p: Page, optionText: string): Promise<void> {
  const panel = await openTableSettings(p);
  const verify = panel.locator(".table-toolbar__verify");
  const control = verify.getByRole("combobox", {
    name: "Write verification",
  });
  await expect(control).toBeVisible();

  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
    await control.click({ force: true });
    opened = await p
      .locator(".ant-select-dropdown:visible")
      .waitFor({ state: "visible", timeout: 1500 })
      .then(
        () => true,
        () => false,
      );
    if (!opened) {
      await control.focus();
      await p.keyboard.press("ArrowDown");
      opened = await p
        .locator(".ant-select-dropdown:visible")
        .waitFor({ state: "visible", timeout: 1500 })
        .then(
          () => true,
          () => false,
        );
    }
  }
  expect(opened).toBe(true);

  try {
    const option = p
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: new RegExp(`^${optionText}$`) })
      .first();
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.evaluate((el) => (el as HTMLElement).click());
    await expect(verify).toContainText(optionText, { timeout: 5000 });
  } finally {
    await p.keyboard.press("Escape");
    if (await panel.isVisible().catch(() => false)) {
      await p.keyboard.press("Escape");
    }
    await panel
      .waitFor({ state: "hidden", timeout: 2000 })
      .catch(() => undefined);
  }
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(p: Page, valueHex: string): Promise<void> {
  const cell = activeTable(p).locator('[data-register-cell="data"]').first();
  await cell.click();
  // 同 setRowAddress：等待编辑态 + pressSequentially 逐字符输入（fill 偶发不触发
  // React onChange 致提交短路）+ toHaveValue 确认受控值同步后再 Enter。
  const data = activeTable(p).locator('[data-register-cell="data"]').first();
  await expect(data).toBeEditable({ timeout: 5000 });
  await data.fill("");
  await data.pressSequentially(valueHex, { delay: 10 });
  await expect(data).toHaveValue(valueHex);
  await data.press("Enter");
  await expect(
    activeTable(p).locator('input[data-register-cell="data"]'),
  ).toHaveCount(0);
  await expect(
    activeTable(p).locator('[data-register-cell="data"]').first(),
  ).toHaveAttribute("data-committed-value", valueHex);
  const writeButton = activeTable(p)
    .getByRole("button", { name: /^Write row / })
    .first();
  await expect(writeButton).toBeEnabled({ timeout: 5000 });
  await writeButton.click();
}

/** 通过侧边栏分组「+」按钮新建基础表/自定义表（aria-label = 组标题）。 */
async function addBasicSheet(p: Page, groupTitle: string): Promise<void> {
  await p
    .getByRole("button", { name: groupTitle, exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/**
 * 以当前活动表协议重新连接（真实串口，自动枚举并选中 config/connections.json 的
 * rtu-com4-master.port，无系统 picker）。用于切换到基础表/自定义表 codec 后重连。
 */
async function reconnectAsActiveSheet(p: Page): Promise<void> {
  // 1) 断开（已连接时弹窗按钮是 Disconnect）。
  await p
    .getByRole("button", { name: /Disconnect/i })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(p.locator(".ant-layout-header")).not.toContainText(
    "Disconnect",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
  // 2) 打开 Connection Settings → 端口下拉枚举 → 选择 COM4 → Connect。
  await p
    .getByRole("button", { name: "Connection settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await p.waitForSelector(".ant-modal-container:visible", { timeout: 8000 });
  const modal = p.locator(".ant-modal-container:visible");
  const rtu = rtuConfig();
  await modal
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first()
    .click();
  const option = p
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(p.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(p.locator(".ant-modal-container:visible")).toHaveCount(0);
}

/**
 * 经 Settings → Plugins 安装 custom-function-code 插件产物（插件一律手动安装）。
 * 生产构建下「Install Plugin」走主进程 `open-text-file` → `dialog.showOpenDialog`
 * （系统对话框无法自动化），故与 `plugin-host-execution.spec.ts` 同法用 `app.evaluate`
 * 桩替换对话框；该插件贡献 codec / dataType（同步纯函数），确认框中须授权声明的同进程执行。
 */
async function installCustomFunctionCodePlugin(): Promise<void> {
  await app.evaluate(async ({ dialog }, entryPath) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
      async () => ({ canceled: false, filePaths: [entryPath] });
  }, CUSTOM_FC_ENTRY_PATH);

  await page
    .getByRole("button", { name: "Settings", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  const section = page.getByTestId("plugin-manager");
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Install Plugin" }).click();

  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await expect(
    confirm.getByRole("button", {
      name: "Authorize same-process execution and install",
      exact: true,
    }),
  ).toBeVisible();
  await confirm
    .getByRole("button", {
      name: "Authorize same-process execution and install",
      exact: true,
    })
    .click();
  await expect(confirm).toBeHidden();
  await expect(section).toContainText("Custom Function Code");

  // 关闭 Settings（离场动画期间点击会被遮罩吞掉：等 wrapper 隐藏）。
  await page
    .locator(".settings-drawer .ant-drawer-close")
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

test.beforeAll(async () => {
  const launched = await launchIsolatedElectron({
    executablePath: require("electron"),
    mainEntry: "dist-electron/main.js",
    cwd: REPO_ROOT,
  });
  app = launched.app;
  userDataDir = launched.userDataDir;
  const isolatedUserDataDir = launched.userDataDir;
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  page.on("pageerror", (err) =>
    consoleErrors.push(`PAGEERROR: ${String(err)}`),
  );

  // 清理 IndexedDB 避免跨运行残留工作区，随后重载生效。
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name !== undefined) indexedDB.deleteDatabase(db.name);
    }
  });
  // 工作区持久化使用文件仓储：IndexedDB 清理不涉及工作区，
  // 一并删除 userData 下 workspace.json(.bak)，避免跨测试/跨运行污染。
  await clearWorkspaceFile(app);
  // 插件存储同理：删掉 plugins.json(.bak)，保证本 spec 从「未安装任何插件」基线
  // 开始（否则上次运行安装的插件会让侧边栏多出分组、重复安装而注册失败）。
  await rm(path.join(isolatedUserDataDir, "plugins.json"), { force: true });
  await rm(path.join(isolatedUserDataDir, "plugins.json.bak"), { force: true });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // 非 mock 启动自动弹出 Connection Settings。
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test.afterAll(async () => {
  await closeIsolatedElectron(app, userDataDir);
  expectNoConsoleErrors(consoleErrors);
});

test("RTU 自动选择 COM4（来自 config/connections.json）+ 连接 Online", async () => {
  const rtu = rtuConfig();
  const modal = page.locator(".ant-modal-container:visible");

  // 打开端口下拉框（用户手势触发枚举 → 主进程转发端口列表 → 选项出现）。
  // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除）。
  await modal
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first()
    .click();
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();

  // 端口标签出现在弹窗（已选中）。
  await expect(modal).toContainText(rtu.port, { timeout: 8000 });
  // 真实端口稳定连接：RTU 超时手动输入设 Select 上限 100ms。
  await setRtuTimeoutSelect(page, modal, 100);

  // Connect → Online，弹窗关闭。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 地址进制切到 HEX，便于按从站规则地址操作。
  await setRadixHex(page);
});

test("RTU：FC03 读正常区 0x0000 → 0x04D2（从站初始值 1234）", async () => {
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "04D2",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：FC0x10 写正常区 0x0001=0x12AB + 读回验证", async () => {
  await setRowAddress(page, "0001");
  await writeRow(page, "12AB");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "12AB",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：写值门控 0x0400：写 0x8000 被拒（异常 0x03），写 0x1234 成功", async () => {
  await setRowAddress(page, "0400");
  await writeRow(page, "8000");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(
    page.locator(".register-table__status-dot").first(),
  ).toHaveAttribute("aria-label", "The device returned a Modbus exception.");
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "1234",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：异常区：只读 0x0100 写 / 只写 0x0200 读 / 不存在 0x0300 读 / 不支持功能 0x0500 读", async () => {
  await setRowAddress(page, "0100");
  await writeRow(page, "0001");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  await setRowAddress(page, "0200");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  await setRowAddress(page, "0300");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  await setRowAddress(page, "0500");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
});

test("RTU：no-response 0x0600：读超时错误，且不破坏后续请求", async () => {
  await setRowAddress(page, "0600");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(
    page.locator(".register-table__status-dot").first(),
  ).toHaveAttribute(
    "aria-label",
    "No response from the device within the timeout.",
  );
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "04D2",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：边界：地址 0 与最大地址 0xFFFF（规则外回退正常）", async () => {
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "04D2",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
  await setRowAddress(page, "FFFF");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "0000",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "1234",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：扩展：分片响应 0x0800 读写成功（半包/粘包组帧健壮性）", async () => {
  await setRowAddress(page, "0800");
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "1234",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：扩展：延迟响应 0x0700 读超时（迟到丢弃），后续正常", async () => {
  await setRowAddress(page, "0700");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  // 从站对 0x0700 的延迟响应（2500ms）落在主站超时窗口（requestTimeoutMs 50ms ×
  // retryCount+1 共 2 次 ≈ 100ms）之后才到达；若此时立即发起新读，RTU 无 Transaction ID
  // 会把迟到的 0x0700 响应当作新读的响应，污染 0x0000 的新读。两次重试
  // （attempt1/attempt2）均在 ~100ms 内超时，两帧迟到响应各在其请求
  // 后 ~2500ms 到达（~2500 / ~2550ms）。等两帧迟到响应都在无活动请求时（pendingExchange
  // 为空）到达并被丢弃，再读回正常区（默认超时改 50ms，等待 3000ms 覆盖）。
  await page.waitForTimeout(3000);
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "04D2",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
});

test("RTU：通信日志：请求/响应/异常帧字节", async () => {
  // Listy 虚拟列表只渲染视口内的行：共享 app 下历史帧已被滚动挤出，
  // 清空后在测试内重建目标帧（写值门控异常 0x03、只读区异常 0x02、读 0x0000）。
  await page.getByRole("tab", { name: "Comm Log" }).click();
  await page.getByRole("button", { name: /Clear/i }).click();
  await setRowAddress(page, "0400");
  await writeRow(page, "8000");
  await setRowAddress(page, "0100");
  await writeRow(page, "0001");
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "04D2",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
  await page.waitForTimeout(200);
  const list = page.locator(".comm-log .ant-listy-holder");
  // Listy 虚拟列表默认停在底部（最新帧可见）；最早帧（写门控异常 01 90 03）可能被挤出
  // 视口（延迟响应的迟到帧也会占用视口）。滚动到顶部让最早帧渲染后断言，再滚回底部
  // 断言最新帧。
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 90 03", { timeout: 5000 });
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 90 02", { timeout: 5000 });
  await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
  await expect(list).toContainText("01 03 02 04 D2", { timeout: 5000 });
});

test("RTU：写后回读 Verify：默认 OFF，显式 ON 后写忽略区 0x0900 显示回读值 0000", async () => {
  // 写忽略区（0x0900–0x090f）：写入返回正常成功帧但不落盘——回读仍为旧值 0。
  // 新表默认 OFF；本用例显式 ON，写入后立即 FC03 回读 → 值不一致 → 失败点（红点），
  // Data 列被回读值覆盖（§15.1）显示 0000 而非写入的 1234。
  const settings = await openTableSettings(page);
  await expect(settings.locator(".table-toolbar__verify")).toContainText("OFF");
  await page.keyboard.press("Escape");
  await setWriteVerify(page, "ON");
  await setRowAddress(page, "0900");
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "0000",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
  await expect(
    page.locator('[data-register-cell="data"]').first(),
  ).not.toHaveText("1234");
  await readRow(page);
  await expect(page.locator('[data-register-cell="data"]').first()).toHaveText(
    "0000",
    {
      timeout: CONNECTED_TIMEOUT,
    },
  );
  await setWriteVerify(page, "OFF");
});

test("ASCII 字符串区：FC03 连续读 16 寄存器（0x0010–0x001F）+ Type=String → Data 显示字符串", async () => {
  // 从站保持寄存器 0x0010–0x001F 预置 32 字符 ASCII（16 寄存器 × 2 字符，高字节在前）；
  // 该区间未命中任何规则 → 回退正常行为。应用侧用范围行 + Type=String 一次 FC03 读回，
  // Data 列直接显示可读 ASCII 字符串（字符串语义）。
  const ascii = asciiStringRegion();
  await setRowAddress(page, "0010-001F");
  await setRowType(page, "String");
  await readRow(page);
  await expect(
    activeTable(page).locator('[data-register-cell="data"]').first(),
  ).toHaveText(ascii.text, { timeout: CONNECTED_TIMEOUT });
  await expect(
    activeTable(page).locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
});

test("安装 custom-function-code 插件（ADR-054：手动安装 + 同进程执行）", async () => {
  // 基线：未安装插件时侧边栏无自定义功能码分组。
  const groupButton = page.getByRole("button", {
    name: CUSTOM_FC_GROUP_LABEL,
    exact: true,
  });
  await expect(groupButton).toHaveCount(0);

  await installCustomFunctionCodePlugin();

  // 插件的 tableType 贡献生效 → 侧边栏出现分组（后续用例据此新建自定义功能码表）。
  await expect(groupButton.first()).toBeVisible({ timeout: CONNECTED_TIMEOUT });
});

test("基础表与自定义功能码（真实端口）：FC01/FC02/FC04/FC0F + FC65/FC66", async () => {
  // 所有行断言限定到活动表（多 Sheet 时不得命中隐藏表）。
  const dataCell = () =>
    activeTable(page).locator('[data-register-cell="data"]').first();
  const okDot = () =>
    activeTable(page).locator(".register-table__status-dot--success").first();

  // 线圈表：FC01 读 coil0（配置预置 1）→ 位值 "1"；FC0F 写 0 → 读回 "0"。
  await addBasicSheet(page, "COILS (R/W)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(dataCell()).toHaveText("1", {
    timeout: CONNECTED_TIMEOUT,
  });
  await writeRow(page, "0");
  await expect(okDot()).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(dataCell()).toHaveText("0", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 离散输入表（只读）：FC02 读 input1（配置预置 1）→ "0001"。
  await addBasicSheet(page, "DISCRETE INPUTS (R)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0001");
  await readRow(page);
  await expect(dataCell()).toHaveText("0001", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 输入寄存器表（只读）：FC04 读 inputReg2（配置预置 0x1234）→ "1234"。
  await addBasicSheet(page, "INPUT REGISTERS (R)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0002");
  await readRow(page);
  await expect(dataCell()).toHaveText("1234", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 自定义功能码表：FC65 读保持寄存器 1（此前 FC10 写 0x12AB）→ "12AB"；
  // FC66 写 3=0xABCD → 回执；并用通信日志断言帧字节（FC65/FC66 与 FC03/FC10 同构，须靠帧区分）。
  // 前置：custom-function-code 插件已在前一用例经 Settings → Plugins 安装。
  await addBasicSheet(page, CUSTOM_FC_GROUP_LABEL);
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0001");
  await readRow(page);
  await expect(dataCell()).toHaveText("12AB", {
    timeout: CONNECTED_TIMEOUT,
  });
  await setRowAddress(page, "0003");
  await writeRow(page, "ABCD");
  await expect(okDot()).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  // 通信日志：清空后重建目标帧（FC65 读 + FC66 写），断言函数码字节。
  // Listy 虚拟列表只渲染视口内行：最早帧（FC65 读请求）可能被挤出，先滚到顶部断言
  // 最早帧，再滚回底部断言最新帧（与既有「通信日志」用例一致）。
  await page.getByRole("tab", { name: "Comm Log" }).click();
  await page.getByRole("button", { name: /Clear/i }).click();
  await setRowAddress(page, "0001");
  await readRow(page);
  await setRowAddress(page, "0003");
  await writeRow(page, "ABCD");
  await page.waitForTimeout(300);
  const list = page.locator(".comm-log .ant-listy-holder");
  await list.evaluate((el) => {
    (el as HTMLElement).scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 65 00 01 00 01", { timeout: 5000 });
  await list.evaluate((el) => {
    (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 66 00 03 00 01", { timeout: 5000 });

  // 恢复保持寄存器表（HOLDING REGISTERS Sheet 1）连接，避免后续「断开连接/重连」用例以自定义功能码协议重连。
  await page
    .getByRole("tab", { name: "HOLDING REGISTERS Sheet 1" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await reconnectAsActiveSheet(page);
});

test("断开连接 → Offline，可重连 → Online（稳定性）", async () => {
  // 断开（Header 连接按钮已整合，断开后显示 Connect 态、无 "Offline" 文本；以 data-conn-state 判定）。
  await page.getByRole("button", { name: /Disconnect/i }).click();
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='disconnected']"),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  // 重连：打开 Connection Settings → 串口下拉已可复用授权快照（enumerated 自动匹配 COM4）。
  await page
    .getByRole("button", { name: "Connection settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 8000,
  });
  const modal = page.locator(".ant-modal-container:visible");
  const rtu = rtuConfig();
  // 打开下拉触发枚举（用户手势），等待 COM4 选项后选择。
  // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除）。
  await modal
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first()
    .click();
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
});
