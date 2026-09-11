#!/usr/bin/env node
/**
 * 应用图标生成脚本：build/AppIcon.svg（单一事实源）→ 各端打包所需格式。
 *
 * 产出：
 *   - apps/vscode-extension/icon.png   VSCode 扩展图标（VS Code 市场要求 PNG，256×256）
 *   - build/icon.ico                   Electron Windows 图标（多尺寸 PNG 压缩 ICO，
 *                                      electron-builder 的 win.icon 指向，rcedit 写入 exe 资源）
 *   - Android 启动图标（2026-09-11 新增，用户要求"全白底 + 黑色线条"）：
 *       apps/android/android/app/src/main/res/mipmap-<density>/ic_launcher.png            （白底方形）
 *       apps/android/android/app/src/main/res/mipmap-<density>/ic_launcher_round.png      （白底圆形）
 *       apps/android/android/app/src/main/res/mipmap-<density>/ic_launcher_foreground.png（透明底，自适应图标前景）
 *       apps/android/android/app/src/main/res/values/ic_launcher_background.xml   （背景色 #FFFFFF）
 *
 * 说明：源 SVG 线条为黑色、背景透明；打包图标（exe/市场/VSIX/Android）需在暗黑模式下可读，
 *       渲染时统一 flatten 合成白色背景（黑色线条 + 白底）。
 *       Android 自适应前景必须保持**透明底**（背景由 adaptive-icon 的 background 提供）。
 *
 * 实现说明：
 *   - SVG → PNG 用 sharp（libvips 渲染，含 metadata/rdf 的 SVG 可正常解析）；
 *     flatten({ background: '#ffffff' }) 把透明背景合成到白色。
 *   - ICO 为容器格式：6 字节头 + 16 字节×N 目录项 + 各尺寸 PNG 数据
 *     （Vista+ 支持 PNG 压缩条目；width/height 0 表示 256），纯 Node 封装，无额外图像依赖。
 *   - 运行：node scripts/generate-icons.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "build", "AppIcon.svg");
const VSCODE_ICON = path.join(ROOT, "apps", "vscode-extension", "icon.png");
const ELECTRON_ICO = path.join(ROOT, "build", "icon.ico");

const svg = await readFile(SRC);

// 1. VSCode 扩展图标：256×256 PNG（市场要求 PNG，方形；白底保证暗黑模式可读）
await mkdir(path.dirname(VSCODE_ICON), { recursive: true });
await sharp(svg)
  .resize(256, 256)
  .flatten({ background: "#ffffff" })
  .png()
  .toFile(VSCODE_ICON);

// 2. Electron：多尺寸 PNG → ICO（16/24/32/48/64/128/256）
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map(async (size) => ({
    size,
    data: await sharp(svg)
      .resize(size, size)
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer(),
  })),
);

/** 组装 PNG 压缩 ICO（容器封装，Vista+ 原生支持）。 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4); // image count
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const blobs = [];
  entries.forEach(({ size, data }, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(data.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // image data offset
    dir.set(entry, i * 16);
    blobs.push(data);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...blobs]);
}

await mkdir(path.dirname(ELECTRON_ICO), { recursive: true });
await writeFile(ELECTRON_ICO, buildIco(pngs));

// 3. Android 启动图标（2026-09-11，用户要求：全白底 + 黑色线条）
//
//    - legacy `ic_launcher.png` / `ic_launcher_round.png`：白底 + 黑线条；
//      图形占画布 LEGACY_CONTENT_RATIO（留白，避免图形贴边显得过大）。
//    - 自适应图标前景 `ic_launcher_foreground.png`：**透明底** + 黑线条；
//      图形占画布 FOREGROUND_CONTENT_RATIO（Android 自适应安全区为中央 66/108 ≈ 61%，
//      超出部分会被系统遮罩裁掉，故前景内容必须小于该比例）。
//    - 自适应图标背景由 `values/ic_launcher_background.xml` 提供（本脚本一并写入，保证确定性）。
const ANDROID_RES = path.join(
  ROOT,
  "apps",
  "android",
  "android",
  "app",
  "src",
  "main",
  "res",
);
const ANDROID_BACKGROUND_COLOR = "#FFFFFF";
const ANDROID_BACKGROUND_XML = path.join(
  ANDROID_RES,
  "values",
  "ic_launcher_background.xml",
);
/** legacy 图标中图形占画布的比例（其余为白底留白）。 */
const LEGACY_CONTENT_RATIO = 0.76;
/** 自适应前景中图形占画布的比例（须 < 安全区 61%）。 */
const FOREGROUND_CONTENT_RATIO = 0.55;
/** Android 各密度目录与对应像素尺寸（legacy 48dp 网格 / 自适应 108dp 网格）。 */
const ANDROID_DENSITIES = [
  { dir: "mipmap-mdpi", legacy: 48, foreground: 108 },
  { dir: "mipmap-hdpi", legacy: 72, foreground: 162 },
  { dir: "mipmap-xhdpi", legacy: 96, foreground: 216 },
  { dir: "mipmap-xxhdpi", legacy: 144, foreground: 324 },
  { dir: "mipmap-xxxhdpi", legacy: 192, foreground: 432 },
];

/** 圆形遮罩（用于 `ic_launcher_round` 的 `dest-in` 合成）。 */
function circleMask(size) {
  const radius = size / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${radius}" cy="${radius}" r="${radius}" fill="#ffffff"/></svg>`,
  );
}

/** 把源 SVG 渲染为边长 `size` 的位图；`flatten` 为 true 时合成白底，否则保留透明底。 */
async function renderAndroidBitmap(size, flatten) {
  const pipeline = sharp(svg).resize(size, size);
  return (flatten ? pipeline.flatten({ background: ANDROID_BACKGROUND_COLOR }) : pipeline)
    .png()
    .toBuffer();
}

/** 在 `size×size` 画布上居中放置图形（`background` 为 #fff 或透明）。 */
async function composeAndroidIcon(size, contentSize, { flatten }) {
  const content = await renderAndroidBitmap(contentSize, flatten);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: flatten
        ? ANDROID_BACKGROUND_COLOR
        : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toBuffer();
}

for (const { dir, legacy, foreground } of ANDROID_DENSITIES) {
  const outDir = path.join(ANDROID_RES, dir);
  await mkdir(outDir, { recursive: true });

  // 白底方形（系统会在旧版本上自行加圆角/圆形遮罩）。
  await writeFile(
    path.join(outDir, "ic_launcher.png"),
    await composeAndroidIcon(legacy, Math.round(legacy * LEGACY_CONTENT_RATIO), {
      flatten: true,
    }),
  );

  // 白底圆形：先渲染白底方形，再用圆形遮罩裁掉圆外（圆外透明）。
  await writeFile(
    path.join(outDir, "ic_launcher_round.png"),
    await sharp(
      await composeAndroidIcon(legacy, Math.round(legacy * LEGACY_CONTENT_RATIO), {
        flatten: true,
      }),
    )
      .composite([{ input: circleMask(legacy), blend: "dest-in" }])
      .png()
      .toBuffer(),
  );

  // 自适应图标前景：透明底（背景由 ic_launcher_background 提供）。
  await writeFile(
    path.join(outDir, "ic_launcher_foreground.png"),
    await composeAndroidIcon(
      foreground,
      Math.round(foreground * FOREGROUND_CONTENT_RATIO),
      { flatten: false },
    ),
  );
}

// 自适应图标背景色（与本脚本常量同源，避免手改漂移）。
await mkdir(path.dirname(ANDROID_BACKGROUND_XML), { recursive: true });
await writeFile(
  ANDROID_BACKGROUND_XML,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ANDROID_BACKGROUND_COLOR}</color>\n</resources>\n`,
);

console.log(
  `[generate-icons] VSCode: ${path.relative(ROOT, VSCODE_ICON)}\n` +
    `[generate-icons] Electron: ${path.relative(ROOT, ELECTRON_ICO)}\n` +
    `[generate-icons] Android: ${ANDROID_DENSITIES.length} 个密度 × ` +
    `ic_launcher / ic_launcher_round / ic_launcher_foreground（背景 ${ANDROID_BACKGROUND_COLOR}）`,
);

const vstat = (await import("node:fs/promises")).stat;
const [vs, es] = await Promise.all([vstat(VSCODE_ICON), vstat(ELECTRON_ICO)]);
console.log(
  `[generate-icons] done -> ${VSCODE_ICON} (${(vs.size / 1024).toFixed(1)} KB)`,
);
console.log(
  `[generate-icons] done -> ${ELECTRON_ICO} (${(es.size / 1024).toFixed(1)} KB, ${sizes.join("/")})`,
);
