/**
 * BrowserCompatibilityBanner（PRD §8.3 / §15.7）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { initI18n } from "../i18n";
import { BrowserCompatibilityBanner } from "./BrowserCompatibilityBanner";

const BLOCKED = {
  webSerial: false,
  secureContext: true,
  usable: false,
  issues: ["web-serial-missing"] as const,
};

beforeEach(() => {
  initI18n();
});

describe("BrowserCompatibilityBanner", () => {
  it("检测失败：渲染横幅 + 具体原因 + 替代方案", () => {
    const { container } = render(
      <BrowserCompatibilityBanner compatibility={BLOCKED} isMock={false} />,
    );
    expect(container.textContent).toContain("Browser compatibility");
    expect(container.textContent).toContain("Web Serial");
    expect(container.textContent).toContain("Chromium");
  });

  it("检测全部满足：不渲染", () => {
    const { container } = render(
      <BrowserCompatibilityBanner
        compatibility={{
          webSerial: true,
          secureContext: true,
          usable: true,
          issues: [],
        }}
        isMock={false}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("桌面端（null）或 mock 模式：不渲染", () => {
    const none = render(
      <BrowserCompatibilityBanner compatibility={null} isMock={false} />,
    );
    expect(none.container.textContent).toBe("");
    const mock = render(
      <BrowserCompatibilityBanner compatibility={BLOCKED} isMock={true} />,
    );
    expect(mock.container.textContent).toBe("");
  });
});
