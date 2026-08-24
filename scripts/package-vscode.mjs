#!/usr/bin/env node
/**
 * VSCode 扩展 VSIX 打包（根 dist:vscode 调用，先 build:vscode 再打包，不发布）。
 *
 * 为什么用 staging 组装（vsce 3.9.2 行为，2026-08-23 从 node_modules/@vscode/vsce 源码确认）：
 *   - vsce 依赖收集走 `npm list --production`（或 yarn），pnpm monorepo 的
 *     `workspace:*` 协议 npm 无法解析 → 不能直接在 apps/vscode-extension 打包；
 *   - vsce 的 `--no-dependencies` 只扫扩展目录本身且硬编码忽略 `node_modules/**`，
 *     而 serialport 是 esbuild external 的原生绑定（apps/vscode-extension/esbuild.config.mjs，
 *     platform-node 的 real-serial-port.ts 静态 import serialport），必须在运行时从
 *     node_modules 加载 → 必须真实安装并让 vsce 通过 npm list 收集进 VSIX；
 *   - vsce 3.9 不会自动 `npm install`，要求 node_modules 已存在；
 *   - 因此流程：staging 组装 → npm install 生产依赖 → vsce package（与 ADR-018
 *     Electron 绿色版 staging 组装同模式）。
 *
 * 步骤：
 *   1. 前置检查 apps/vscode-extension/dist/（先 build:vscode）；
 *   2. 重建 staging release/vscode-extension/，拷贝 dist/（extension.js + media/）；
 *   3. 写 staging package.json：仅保留 serialport 依赖（@mamep2026/* 已被 esbuild
 *      内联进 dist/extension.js），name 显式 mamep2026（市场 name 不允许 @scope），
 *      版本跟随根 package.json；
 *   4. 写 staging README.md 与 .vscodeignore；
 *   5. staging 内 npm install --omit=dev（拉取 serialport 及原生预编译绑定）；
 *   6. 用根 node_modules 的 vsce 在 staging 内
 *      `package --no-yarn --skip-license --allow-missing-repository`，
 *      产物 release/mamep2026-<version>.vsix。
 */
import { execSync } from "node:child_process";
import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "apps", "vscode-extension");
const RELEASE_DIR = path.join(ROOT, "release");
const STAGING = path.join(RELEASE_DIR, "vscode-extension");
const VSCE_BIN = path.join(ROOT, "node_modules", "@vscode", "vsce", "vsce");

const extPkg = JSON.parse(await readFile(path.join(EXT, "package.json"), "utf-8"));
const rootPkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf-8"));

// 1. 前置检查：先 build:vscode 才有关闭产物
const builtExtension = path.join(EXT, "dist", "extension.js");
try {
  await access(builtExtension);
} catch {
  console.error(
    "[package-vscode] 缺少扩展宿主产物（先执行 pnpm build:vscode）: apps/vscode-extension/dist/extension.js",
  );
  process.exit(1);
}

// 2. 重建 staging 并拷贝 dist/（extension.js + media/ 共享 UI 静态资源）
await rm(STAGING, { recursive: true, force: true });
await mkdir(STAGING, { recursive: true });
await mkdir(RELEASE_DIR, { recursive: true });
await cp(path.join(EXT, "dist"), path.join(STAGING, "dist"), { recursive: true });

// 2.5. 拷贝扩展图标（package.json icon 字段指向，vsce 打包进 VSIX 作为市场图标；
//   由 scripts/generate-icons.mjs 从根 AppIcon.svg 生成）
await cp(path.join(EXT, "icon.png"), path.join(STAGING, "icon.png"));

// 3. staging package.json：name 显式 mamep2026（市场 name 不允许 @scope；扩展 ID 为
//    publisher.name = mamep2026.mamep2026，VSIX 文件名 mamep2026-<version>.vsix），
//    去掉 private/devDependencies/scripts，dependencies 仅保留 serialport（其余被 esbuild 内联）。
const name = "mamep2026";
await writeFile(
  path.join(STAGING, "package.json"),
  `${JSON.stringify(
    {
      name,
      displayName: extPkg.displayName,
      description: extPkg.description,
      version: rootPkg.version,
      publisher: extPkg.publisher,
      engines: extPkg.engines,
      categories: extPkg.categories,
      icon: extPkg.icon,
      main: extPkg.main,
      activationEvents: extPkg.activationEvents,
      contributes: extPkg.contributes,
      dependencies: { serialport: extPkg.dependencies.serialport },
    },
    null,
    2,
  )}\n`,
  "utf-8",
);

// 4. README（vsce 打包进 readme 资产；不含相对链接/图片/SVG，避免 vsce 链接重写报错）。
//   单一事实源：apps/vscode-extension/README.md（仓库内维护），staging 直接引用。
const extReadme = await readFile(path.join(EXT, "README.md"), "utf-8");
await writeFile(path.join(STAGING, "README.md"), extReadme, "utf-8");

// 5. .vscodeignore：排除源码/构建配置/锁文件（staging 内本无 src，兜底防未来变更）
await writeFile(
  path.join(STAGING, ".vscodeignore"),
  `src/**
esbuild.config.mjs
tsconfig.json
**/*.map
package-lock.json
.vscodeignore
`,
  "utf-8",
);

// 6. 生产依赖安装（serialport 原生绑定走 postinstall 下载预编译，勿加 --ignore-scripts）
console.log("[package-vscode] step: npm install (production deps, serialport native binding)");
execSync("npm install --omit=dev --no-audit --no-fund", { cwd: STAGING, stdio: "inherit" });

// 7. vsce 打包（--no-yarn 强制 npm 依赖扫描；--skip-license 仓库无 LICENSE 文件；
//    --allow-missing-repository 仓库无远程 URL 字段，免交互；
//    staging 无 yarn.lock 默认即 npm，显式声明防误判）
const outVsix = path.join(RELEASE_DIR, `${name}-${rootPkg.version}.vsix`);
console.log("[package-vscode] step: vsce package (vsix)");
execSync(
  `node "${VSCE_BIN}" package --no-yarn --skip-license --allow-missing-repository --out "${outVsix}"`,
  { cwd: STAGING, stdio: "inherit" },
);

const stats = await stat(outVsix);
console.log(
  `[package-vscode] done -> ${outVsix} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`,
);
console.log("  安装验证: VS Code 命令面板 → 'Extensions: Install from VSIX...'");
