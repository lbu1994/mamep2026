#!/usr/bin/env node
/**
 * Electron 免安装绿色版打包：staging 应用组装脚本。
 *
 * 用法（由根 package.json 的 dist:portable 调用，先 build:electron 再组装）：
 *   node scripts/package-electron.mjs
 *
 * 职责（只负责组装 staging，electron-builder 由 pnpm script 在根目录调用）：
 *   1. 清空并重建 release/staging-app/；
 *   2. 拷贝根 dist-electron/（主进程 + preload）→ staging-app/dist-electron/；
 *   3. 拷贝 apps/web/dist-electron/（Electron 模式渲染器产物）→ staging-app/apps/web/dist-electron/
 *      （保持 main.ts 里 __dirname 相对路径所依赖的目录结构）；
 *   4. 写 staging-app/package.json（name/version 取自根 package.json、main 指 dist-electron/main.js、
 *      type: module，无 dependencies —— 主进程/渲染器产物自包含，electron-builder 据此
 *      跳过 node_modules 收集，避免根 package.json 的 production deps 被打进安装目录）。
 *
 * 之后 electron-builder（根 electron-builder.yml，win.target=dir）产出 release/win-unpacked/，
 * 整个文件夹即为"拷贝即用"的分发物。
 */
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = path.join(ROOT, "release", "staging-app");

const REQUIRED_DIRS = [
  { rel: "dist-electron", label: "主进程产物（先执行 pnpm build:electron）" },
  {
    rel: path.join("apps", "web", "dist-electron"),
    label: "渲染器产物（先执行 pnpm build:electron）",
  },
];

for (const { rel, label } of REQUIRED_DIRS) {
  const abs = path.join(ROOT, rel);
  try {
    await access(abs);
  } catch {
    console.error(`[package-electron] 缺少 ${label}: ${rel}`);
    process.exit(1);
  }
}

const rootPkg = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf-8"),
);

// 1. 重建 staging
await rm(STAGING, { recursive: true, force: true });
await mkdir(STAGING, { recursive: true });

// 2. 主进程 + preload
await cp(
  path.join(ROOT, "dist-electron"),
  path.join(STAGING, "dist-electron"),
  {
    recursive: true,
  },
);

// 3. 渲染器（保持 main.ts 的 __dirname 相对路径结构：<app>/apps/web/dist-electron/index.html）
await cp(
  path.join(ROOT, "apps", "web", "dist-electron"),
  path.join(STAGING, "apps", "web", "dist-electron"),
  { recursive: true },
);

// 4. 应用 package.json：无 dependencies → electron-builder 跳过 node_modules 打包
await writeFile(
  path.join(STAGING, "package.json"),
  `${JSON.stringify(
    {
      name: "mamep2026",
      version: rootPkg.version,
      private: true,
      type: "module",
      main: "dist-electron/main.js",
    },
    null,
    2,
  )}\n`,
  "utf-8",
);

console.log(
  `[package-electron] staging 就绪: ${STAGING}（版本 ${rootPkg.version}）`,
);
console.log(`  下一步: electron-builder（产出 release/win-unpacked/）`);
