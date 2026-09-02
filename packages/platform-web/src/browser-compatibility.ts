/**
 * 浏览器能力检测（PRD §8.3 / §15.7 浏览器兼容性；TECH_DESIGN §40.2）。
 * 纯函数：输入注入、输出可断言；不直接访问 window/navigator。
 */
import {
  FULL_BROWSER_COMPATIBILITY,
  type BrowserCompatibility,
  type BrowserCompatibilityIssue,
} from "@mamep2026/domain";

/** 检测输入环境（注入式：便于单测，不触碰真实 DOM）。 */
export interface CompatibilityEnv {
  readonly serial: unknown;
  readonly isSecureContext: boolean;
}

/** 由真实浏览器环境构造检测输入（仅浏览器上下文调用）。 */
export function detectFromBrowser(): CompatibilityEnv {
  const nav = globalThis.navigator as { serial?: unknown } | undefined;
  const win = globalThis as { isSecureContext?: boolean };
  return {
    serial: nav?.serial,
    isSecureContext: win.isSecureContext === true,
  };
}

/**
 * 浏览器能力检测：Web Serial 存在性 + 安全上下文。
 * Web Serial 仅 Chromium 系浏览器且须安全上下文（HTTPS 或 localhost）可用。
 */
export function detectBrowserCompatibility(
  env: CompatibilityEnv,
): BrowserCompatibility {
  const webSerial = env.serial !== undefined;
  const secureContext = env.isSecureContext;
  const issues: BrowserCompatibilityIssue[] = [];
  if (!webSerial) issues.push("web-serial-missing");
  if (!secureContext) issues.push("insecure-context");
  if (issues.length === 0) return FULL_BROWSER_COMPATIBILITY;
  return {
    webSerial,
    secureContext,
    usable: false,
    issues: Object.freeze(issues),
  };
}
