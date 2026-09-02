// scripts/check-contrast.mjs
// Mamep2026 设计令牌 WCAG 2.2 AA 对比度实测（Node 运行）。
//
// 颜色值来源：
//   - antd 公开令牌 theme.getDesignToken({ algorithm })（品牌色 / 链接色 / 选中态，
//     2026-09-02，ADR-048：随库升级自动跟随，无硬编码字面量）
//   - packages/ui-theme/src/base.ts 的 token 覆盖（文字灰阶 / 背景）
//
// 用法：node scripts/check-contrast.mjs
// 输出逐项比值表；任何 AA 项不达标退出码 1。

import { theme as antdTheme } from "antd";

/* antd 运行时默认令牌（浅/暗算法） */
const lightToken = antdTheme.getDesignToken({
  algorithm: antdTheme.defaultAlgorithm,
});
const darkToken = antdTheme.getDesignToken({
  algorithm: antdTheme.darkAlgorithm,
});

/* ---------- 工具 ---------- */

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`invalid color: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- 主题调色板（与 theme.ts / antd 算法一致） ---------- */

// 浅色：bg-container=#fff、bg-layout=#f2f3f5；alpha 已按白底合成。
const LIGHT = {
  bgApp: "#f2f3f5",
  bgNav: "#ffffff",
  bgPanel: "#ffffff",
  bgElevated: "#ffffff",
  textPrimary: "#1f1f1f", // rgba(0,0,0,0.88)
  textSecondary: "#595959", // rgba(0,0,0,0.65)
  textTertiary: "#737373", // rgba(0,0,0,0.55)
  textDisabled: "#949494", // rgba(0,0,0,0.42)
  brandPrimary: lightToken.colorPrimary, // Primary 按钮/焦点（antd 运行时令牌，ADR-048）
  link: lightToken.colorLink, // colorLink（浅，antd 运行时令牌）
  brandBg: lightToken.colorPrimaryBg, // antd primaryBg（浅）
  brandOnBrandBg: lightToken.colorPrimaryText, // antd primaryText（浅，选中态文字）
  focusRing: lightToken.colorPrimary,
  success: "#389e0d",
  warning: "#c08a00",
  error: "#cf1322",
};

// 暗色：bg-app=#101014、bg-nav/sidebar=#141414、bg-panel=#16161c、bg-elevated=#1f1f1f；
// 文字 alpha 已按对应背景合成。
const DARK = {
  bgApp: "#101014",
  bgNav: "#141414",
  bgPanel: "#16161c",
  bgElevated: "#1f1f1f",
  textPrimary: "#dcdcdc", // rgba(255,255,255,0.85) on #141414
  textSecondary: "#adadad", // rgba(255,255,255,0.65) on #141414
  textTertiary: "#a6a6a6", // rgba(255,255,255,0.62) on #141414
  textDisabled: "#6d6d6d", // rgba(255,255,255,0.38) on #141414
  brandPrimary: darkToken.colorPrimary, // Primary 按钮/焦点（暗色主色，antd 运行时令牌）
  link: darkToken.colorLink, // colorLink（暗色，antd 运行时令牌）
  brandBg: darkToken.colorPrimaryBg, // antd dark primaryBg
  brandOnBrandBg: darkToken.colorPrimaryText, // antd dark primaryText
  focusRing: darkToken.colorPrimary,
  success: "#49aa19",
  warning: "#d89614",
  error: "#dc4446",
};

/* ---------- 检查项 ---------- */

const REQUIREMENTS = (p) => [
  {
    name: "正文 / 应用背景",
    fg: p.textPrimary,
    bg: p.bgApp,
    min: 4.5,
    note: "正文",
  },
  {
    name: "正文 / 导航背景",
    fg: p.textPrimary,
    bg: p.bgNav,
    min: 4.5,
    note: "正文",
  },
  {
    name: "正文 / 面板背景",
    fg: p.textPrimary,
    bg: p.bgPanel,
    min: 4.5,
    note: "正文",
  },
  {
    name: "正文 / 浮层背景",
    fg: p.textPrimary,
    bg: p.bgElevated,
    min: 4.5,
    note: "正文",
  },
  {
    name: "次要文字 / 面板背景",
    fg: p.textSecondary,
    bg: p.bgPanel,
    min: 4.5,
    note: "正文",
  },
  {
    name: "辅助文字 / 面板背景",
    fg: p.textTertiary,
    bg: p.bgPanel,
    min: 4.5,
    note: "小字(11-12px)",
  },
  {
    name: "辅助文字 / 导航背景",
    fg: p.textTertiary,
    bg: p.bgNav,
    min: 4.5,
    note: "小字(11-12px)",
  },
  {
    name: "禁用文字 / 面板背景",
    fg: p.textDisabled,
    bg: p.bgPanel,
    min: 3.0,
    note: "Disabled(豁免,可读性目标)",
  },
  {
    name: "主按钮白字 / 品牌色",
    fg: "#ffffff",
    bg: p.brandPrimary,
    min: 4.5,
    note: "Primary 按钮",
  },
  {
    name: "品牌文字 / 面板背景",
    fg: p.link,
    bg: p.bgPanel,
    min: 4.5,
    note: "链接/强调(colorLink)",
  },
  {
    name: "选中态文字 / 选中背景",
    fg: p.brandOnBrandBg,
    bg: p.brandBg,
    min: 4.5,
    note: "侧栏选中/页签",
  },
  {
    name: "焦点环 / 面板背景",
    fg: p.focusRing,
    bg: p.bgPanel,
    min: 3.0,
    note: "Focus ring(非文字)",
  },
  {
    name: "成功 / 面板背景",
    fg: p.success,
    bg: p.bgPanel,
    min: 3.0,
    note: "状态(配合文字/图标)",
  },
  {
    name: "警告 / 面板背景",
    fg: p.warning,
    bg: p.bgPanel,
    min: 3.0,
    note: "状态(配合文字/图标)",
  },
  {
    name: "错误 / 面板背景",
    fg: p.error,
    bg: p.bgPanel,
    min: 3.0,
    note: "状态(配合文字/图标)",
  },
];

/* ---------- 主流程 ---------- */

function run(name, palette) {
  console.log(`\n=== ${name} ===`);
  let failed = 0;
  for (const r of REQUIREMENTS(palette)) {
    const ratio = contrast(r.fg, r.bg);
    const ok = ratio >= r.min;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${String(ratio.toFixed(2)).padStart(5)}:1  >= ${r.min}  ${r.name}  (${r.note})  [${r.fg} on ${r.bg}]`,
    );
  }
  return failed;
}

const failed = run("Light", LIGHT) + run("Dark", DARK);
console.log(`\n${failed === 0 ? "全部达标 ✓" : `${failed} 项未达标 ✗`}`);
process.exit(failed === 0 ? 0 : 1);
