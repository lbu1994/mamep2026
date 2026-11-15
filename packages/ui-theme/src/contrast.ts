/**
 * WCAG 2.2 颜色对比度工具（scripts/check-contrast.mjs 同思路，供 ui-theme 映射层保证 AA）。
 * 纯函数，无 DOM 依赖。
 */

export interface Color {
  r: number;
  g: number;
  b: number;
  /** 0..1，1=不透明。 */
  a: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 解析 CSS 颜色（#rgb / #rrggbb / rgb() / rgba()）；不支持或解析失败返回 null。 */
export function parseColor(input: string): Color | null {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex !== null) {
    let digits = hex[1];
    if (digits === undefined) return null;
    if (digits.length === 3) {
      digits = digits
        .split("")
        .map((c) => `${c}${c}`)
        .join("");
    }
    const num = parseInt(digits, 16);
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff, a: 1 };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      s,
    );
  if (rgb !== null) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return {
      r: clampByte(Number(rgb[1])),
      g: clampByte(Number(rgb[2])),
      b: clampByte(Number(rgb[3])),
      a: Math.max(0, Math.min(1, alpha)),
    };
  }
  return null;
}

/** 生成带指定 alpha 的新颜色（其余通道不变）。 */
export function withAlpha(color: Color, alpha: number): Color {
  return { ...color, a: alpha };
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Color): number {
  return (
    0.2126 * channelToLinear(color.r) +
    0.7152 * channelToLinear(color.g) +
    0.0722 * channelToLinear(color.b)
  );
}

export function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 在背景上按前景 alpha 混合（结果不透明）。 */
export function blend(fg: Color, bg: Color): Color {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** 序列化为 CSS 颜色字符串（不透明输出 rgb()，否则 rgba()）。 */
export function toRgbaString(color: Color): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  if (color.a >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Number(color.a.toFixed(2))})`;
}

/**
 * 提升前景 alpha 直到与背景的对比度 ≥ minRatio（从 fg.a 起步，步长 0.02，上限 1）。
 * 返回可直接作为 CSS 颜色的字符串（rgba()/rgb()）。
 */
export function ensureContrast(fg: Color, bg: Color, minRatio: number): string {
  let alpha = fg.a;
  let current = blend(withAlpha(fg, alpha), bg);
  while (contrastRatio(current, bg) < minRatio && alpha < 1) {
    alpha = Math.min(1, alpha + 0.02);
    current = blend(withAlpha(fg, alpha), bg);
  }
  return toRgbaString(withAlpha(fg, alpha));
}

/** 白字 on 主色是否满足 WCAG AA（≥4.5:1，用于主按钮/选中态文字主题色校验）。 */
export function isWhiteOnPrimaryAa(color: string): boolean {
  const parsed = parseColor(color);
  if (parsed === null) return false;
  return contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, parsed) >= 4.5;
}
