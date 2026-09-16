/**
 * 插件分发产物构建（ADR-054，2026-09-12）：插件一律由用户手动安装，故需产出可安装文件。
 *
 * 产物（`release/plugins/<pluginId>/`，`release/` 已 gitignore）：
 * - 可执行插件：单文件 `.mjs`（`export const manifest` + `export function activate(ctx)`，
 *   自包含、无外部 import，供「同进程执行」加载器 `import()`）+ 从产物中提取的 `manifest.json`；
 * - 纯清单插件（主题色 / panels 示例）：直接拷贝包内 `manifest.json`。
 *
 * 用户在 Settings → Plugins → Install Plugin 中选择 `.json`（纯清单）或 `.mjs`（可执行）安装；
 * 可执行插件安装时需在确认框中显式授权「同进程执行」（ADR-054）。
 *
 * 用法：`pnpm build:plugins`
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.resolve(ROOT, "release/plugins");

/** 可执行插件：打包单文件 entry + 提取 manifest。 */
const EXECUTABLE_PLUGINS = [
  { dir: "address-adjust", pluginId: "builtin-address-adjust" },
  { dir: "custom-function-code", pluginId: "custom-function-code" },
  {
    dir: "yaskawa-memobus-67h-010dh-010eh",
    pluginId: "yaskawa-memobus-67h-010dh-010eh",
  },
];

/** 纯清单插件：仅拷贝包内 manifest.json（无需打包，无可执行代码）。 */
const MANIFEST_ONLY_PLUGINS = [
  { dir: "example-panel", pluginId: "example-panel" },
  { dir: "example-theme", pluginId: "example-theme" },
  { dir: "schneider-green-theme", pluginId: "schneider-green-theme" },
  { dir: "technopro-blue-theme", pluginId: "technopro-blue-theme" },
  { dir: "yaskawa-blue-theme", pluginId: "yaskawa-blue-theme" },
];

async function buildExecutablePlugin({ dir, pluginId }) {
  const outDir = path.join(OUT_ROOT, pluginId);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const bundleFile = path.join(outDir, `${pluginId}.mjs`);
  const entry = path.resolve(ROOT, "plugins", dir, "src", "plugin.ts");

  await build({
    entryPoints: [entry],
    outfile: bundleFile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    legalComments: "none",
    logLevel: "silent",
  });

  // 加载产物校验：能从 entry 提取 manifest 且导出 activate（同安装流程的加载路径）。
  const url = `${pathToFileURL(bundleFile).href}?v=${Date.now()}`;
  const mod = await import(url);
  if (mod.manifest?.id !== pluginId) {
    throw new Error(
      `[build:plugins] ${dir}: entry manifest.id=${String(mod.manifest?.id)} 与期望的 ${pluginId} 不一致`,
    );
  }
  if (typeof mod.activate !== "function") {
    throw new Error(`[build:plugins] ${dir}: entry 未导出 activate(ctx)`);
  }
  writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(mod.manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `[build:plugins] ${pluginId}: ${path.relative(ROOT, bundleFile)}`,
  );
}

function copyManifestOnlyPlugin({ dir, pluginId }) {
  const outDir = path.join(OUT_ROOT, pluginId);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, "manifest.json");
  copyFileSync(path.resolve(ROOT, "plugins", dir, "manifest.json"), target);
  console.log(`[build:plugins] ${pluginId}: ${path.relative(ROOT, target)}`);
}

mkdirSync(OUT_ROOT, { recursive: true });
for (const plugin of EXECUTABLE_PLUGINS) {
  await buildExecutablePlugin(plugin);
}
for (const plugin of MANIFEST_ONLY_PLUGINS) {
  copyManifestOnlyPlugin(plugin);
}
console.log(`[build:plugins] done -> ${path.relative(ROOT, OUT_ROOT)}`);
