/**
 * 浏览器兼容性检测结果（PRD §8.3 / §15.7 浏览器兼容性；TECH_DESIGN §40.2）。
 * 纯数据类型（domain 层）：检测函数在 platform-web 实现，三端 Host 与 UI 共用。
 */
export type BrowserCompatibilityIssue =
  "web-serial-missing" | "insecure-context";

export interface BrowserCompatibility {
  /** Web Serial API 是否可用（navigator.serial 存在）。 */
  readonly webSerial: boolean;
  /** 是否处于安全上下文（window.isSecureContext；Web Serial 要求 HTTPS/localhost）。 */
  readonly secureContext: boolean;
  /** 综合可用性：webSerial && secureContext。 */
  readonly usable: boolean;
  /** 不满足的具体原因（空数组 = 全部满足；供 UI 明确提示）。 */
  readonly issues: readonly BrowserCompatibilityIssue[];
}

/** 全部满足。 */
export const FULL_BROWSER_COMPATIBILITY: Readonly<BrowserCompatibility> =
  Object.freeze({
    webSerial: true,
    secureContext: true,
    usable: true,
    issues: Object.freeze([]),
  });
