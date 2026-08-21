/**
 * Electron 骨架冒烟验证（Playwright + Electron，docs/adr/ADR-016 后续事项的先行验证）。
 *
 * 用法：node scripts/smoke-electron.mjs
 * - 用生产构建路径启动：dist-electron/main.js + apps/web/dist（loadFile，验证 base ./ + CSP）
 * - 客观断言：preload 白名单桥、React UI 挂载、getCapabilities/getAppVersion/getDebugState、
 *   剪贴板往返、console 错误
 * - 检查完成后保持窗口打开供人工交互；关闭窗口即退出（退出码 0/1）。
 */
import { _electron } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // electron 包 main 即可执行文件路径

const results = [];
const consoleErrors = [];

function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const electronApp = await _electron.launch({
  executablePath: electronPath,
  args: ["dist-electron/main.js"],
  cwd: process.cwd(),
});

const page = await electronApp.firstWindow();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.waitForLoadState("domcontentloaded");
// 给 React 挂载留出时间。
await page.waitForTimeout(1500);

record(
  "window.mamepHost 存在（preload 白名单桥）",
  await page.evaluate(() => typeof window.mamepHost !== "undefined"),
);

record(
  "React UI 挂载（#root 有子节点）",
  (await page.evaluate(
    () => document.querySelector("#root")?.children.length ?? 0,
  )) > 0,
);

const caps = await page.evaluate(() => window.mamepHost.getCapabilities());
record(
  "getCapabilities -> ok（RTU 支持，串口 enumerated 下拉选择）",
  caps?.ok === true && caps.value?.modbusRtu === true && caps.value?.modbusTcp === false && caps.value?.serialPorts === "enumerated",
  caps?.ok
    ? `rtu=${caps.value?.modbusRtu}, tcp=${caps.value?.modbusTcp}, serialPorts=${caps.value?.serialPorts}`
    : `code=${caps?.error?.code}`,
);

const ver = await page.evaluate(() => window.mamepHost.getAppVersion());
record(
  "getAppVersion -> ok",
  ver?.ok === true && typeof ver.value === "string",
  ver?.ok ? `version=${ver.value}` : `code=${ver?.error?.code}`,
);

const dbg = await page.evaluate(() => window.mamepHost.getDebugState());
record(
  "getDebugState -> ok（dev 探针）",
  dbg?.ok === true && (dbg?.value?.windowCount ?? 0) >= 1,
  dbg?.ok
    ? `windowCount=${dbg.value.windowCount}, state=${dbg.value.connectionState}`
    : `code=${dbg?.error?.code}`,
);

const copyRes = await page.evaluate(() =>
  window.mamepHost.copyTextToClipboard("smoke-20260821"),
);
const readRes = await page.evaluate(() =>
  window.mamepHost.readTextFromClipboard(),
);
record(
  "剪贴板 copy + read 往返",
  copyRes?.ok === true &&
    readRes?.ok === true &&
    readRes.value === "smoke-20260821",
  readRes?.ok ? `read=${JSON.stringify(readRes.value)}` : `code=${readRes?.error?.code}`,
);

record(
  "无 console 错误",
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(" | "),
);

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n=== Electron 冒烟结果: ${results.length - failed}/${results.length} 通过 ===`,
);

// 保持窗口打开供人工交互；用户关闭窗口（window-all-closed -> quit）后脚本退出。
electronApp.on("close", () => process.exit(failed === 0 ? 0 : 1));
await new Promise(() => {});
