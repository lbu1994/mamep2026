/**
 * 启动骨架屏（2026-09-13）：Host 按运行时平台动态加载期间的占位。
 * 仅测试「按文案渲染 + 无障碍标注」；主题由外层 ConfigProvider 提供（见 MamepApp 用例）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { initI18n } from "../i18n";
import { AppStartupPlaceholder } from "./AppStartupPlaceholder";

beforeEach(() => {
  initI18n();
});

describe("AppStartupPlaceholder", () => {
  it("渲染品牌名与加载文案", () => {
    render(<AppStartupPlaceholder />);

    expect(screen.getByText("Mamep2026")).toBeTruthy();
    expect(screen.getByText("Starting…")).toBeTruthy();
    expect(screen.getByTestId("app-startup")).toBeTruthy();
  });

  it("带无障碍标注（role=status + aria-live，供屏幕阅读器播报）", () => {
    render(<AppStartupPlaceholder />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-label")).toBe("Starting…");
  });
});
