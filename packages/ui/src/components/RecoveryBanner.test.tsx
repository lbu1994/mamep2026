/**
 * RecoveryBanner（PRD §8.3 / TECH_DESIGN §19.7，2026-09-04，ADR-049）。
 * 仅测试渲染三态；纯信息、无按钮。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { initI18n } from "../i18n";
import { RecoveryBanner } from "./RecoveryBanner";

beforeEach(() => {
  initI18n();
});

describe("RecoveryBanner", () => {
  it("source=none（正常恢复）：不渲染", () => {
    const { container } = render(
      <RecoveryBanner
        recovery={{
          recovered: false,
          source: "none",
          recoveredAt: 1000,
          backupTimestamp: null,
          errorCode: null,
        }}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("recovery=null：不渲染", () => {
    const { container } = render(<RecoveryBanner recovery={null} />);
    expect(container.textContent).toBe("");
  });

  it("source=backup：渲染「从备份恢复」提示（含时间）", () => {
    render(
      <RecoveryBanner
        recovery={{
          recovered: true,
          source: "backup",
          recoveredAt: new Date("2026-09-04T00:00:00Z").getTime(),
          backupTimestamp: 900,
          errorCode: null,
        }}
      />,
    );
    expect(screen.getByTestId("recovery-banner")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "recovered from backup",
    );
  });

  it("source=fresh：渲染「恢复失败重置为空」提示", () => {
    render(
      <RecoveryBanner
        recovery={{
          recovered: true,
          source: "fresh",
          recoveredAt: 1000,
          backupTimestamp: null,
          errorCode: "WORKSPACE_SCHEMA_INVALID",
        }}
      />,
    );
    expect(screen.getByTestId("recovery-banner")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("restore failed");
  });
});
