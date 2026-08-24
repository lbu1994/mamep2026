#!/usr/bin/env node
/**
 * 应用图标生成脚本：AppIcon.svg（根目录单一事实源）→ 各端打包所需格式。
 *
 * 产出：
 *   - apps/vscode-extension/icon.png   VSCode 扩展图标（VS Code 市场要求 PNG，256×256）
 *   - build/icon.ico                   Electron Windows 图标（多尺寸 PNG 压缩 ICO，
 *                                      electron-builder 的 win.icon 指向，rcedit 写入 exe 资源）
 *
 * 实现说明：
 *   - SVG → PNG 用 sharp（libvips 渲染，含 metadata/rdf 的 SVG 可正常解析）。
 *   - ICO 为容器格式：6 字节头 + 16 字节×N 目录项 + 各尺寸 PNG 数据
 *     （Vista+ 支持 PNG 压缩条目；width/height 0 表示 256），纯 Node 封装，无额外图像依赖。
 *   - 运行：node scripts/generate-icons.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "AppIcon.svg");
const VSCODE_ICON = path.join(ROOT, "apps", "vscode-extension", "icon.png");
const ELECTRON_ICO = path.join(ROOT, "build", "icon.ico");

const svg = await readFile(SRC);

// 1. VSCode 扩展图标：256×256 PNG（市场要求 PNG，方形）
await mkdir(path.dirname(VSCODE_ICON), { recursive: true });
await sharp(svg).resize(256, 256).png().toFile(VSCODE_ICON);

// 2. Electron：多尺寸 PNG → ICO（16/24/32/48/64/128/256）
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map(async (size) => ({
    size,
    data: await sharp(svg).resize(size, size).png().toBuffer(),
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

const vstat = (await import("node:fs/promises")).stat;
const [vs, es] = await Promise.all([vstat(VSCODE_ICON), vstat(ELECTRON_ICO)]);
console.log(
  `[generate-icons] done -> ${VSCODE_ICON} (${(vs.size / 1024).toFixed(1)} KB)`,
);
console.log(
  `[generate-icons] done -> ${ELECTRON_ICO} (${(es.size / 1024).toFixed(1)} KB, ${sizes.join("/")})`,
);
