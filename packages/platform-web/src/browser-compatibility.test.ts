import { describe, expect, it } from "vitest";
import {
  detectBrowserCompatibility,
  type CompatibilityEnv,
} from "./browser-compatibility";

describe("detectBrowserCompatibility（PRD §8.3 / §15.7）", () => {
  const full: CompatibilityEnv = { serial: {}, isSecureContext: true };

  it("Web Serial + 安全上下文 → usable，无 issues", () => {
    const r = detectBrowserCompatibility(full);
    expect(r.usable).toBe(true);
    expect(r.webSerial).toBe(true);
    expect(r.secureContext).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("缺 Web Serial → web-serial-missing，不可用", () => {
    const r = detectBrowserCompatibility({
      serial: undefined,
      isSecureContext: true,
    });
    expect(r.usable).toBe(false);
    expect(r.webSerial).toBe(false);
    expect(r.issues).toContain("web-serial-missing");
  });

  it("非安全上下文 → insecure-context，不可用", () => {
    const r = detectBrowserCompatibility({
      serial: {},
      isSecureContext: false,
    });
    expect(r.usable).toBe(false);
    expect(r.issues).toContain("insecure-context");
  });

  it("两者都缺 → 两个 issues", () => {
    const r = detectBrowserCompatibility({
      serial: undefined,
      isSecureContext: false,
    });
    expect(r.usable).toBe(false);
    expect(r.issues).toEqual(["web-serial-missing", "insecure-context"]);
  });
});
