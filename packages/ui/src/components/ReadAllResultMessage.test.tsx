/**
 * ReadAllResultMessage 富内容渲染测试（jsdom，2026-08-28）。
 * 断言标题、统计 Tag（语义色分层）、耗时；全成功/有失败时标题图标切换。
 * 组件用 theme.useToken（无 ConfigProvider 时返回默认 token）与 useTranslation
 * （全局 i18n 实例），自身不调用 message，渲染无需 <AntApp>。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { BatchReadSummary } from "@mamep2026/communication";
import { applyLanguage, initI18n } from "../i18n";
import { ReadAllResultMessage } from "./ReadAllResultMessage";

function summary(overrides: Partial<BatchReadSummary> = {}): BatchReadSummary {
  return {
    batchId: "b-1",
    totalRows: 8,
    eligibleRows: 8,
    successCount: 8,
    failureCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    startedAt: 0,
    completedAt: 152,
    durationMs: 152,
    ...overrides,
  };
}

describe("ReadAllResultMessage", () => {
  beforeEach(() => {
    initI18n();
  });

  it("全成功：标题 + 4 项统计 + 耗时，绿勾图标，失败 Tag 无 error 语义色", () => {
    render(<ReadAllResultMessage summary={summary()} />);
    const root = document.querySelector(".read-all-result");
    expect(root).toBeTruthy();
    expect(root?.textContent).toContain("Read All Complete");
    expect(root?.textContent).toContain("8 Succeeded");
    expect(root?.textContent).toContain("0 Failed");
    expect(root?.textContent).toContain("0 Skipped");
    expect(root?.textContent).toContain("0 Cancelled");
    expect(root?.textContent).toContain("152 ms");
    // 全成功：成功图标；失败为 0 时失败 Tag 不取 error 语义色。
    // （antd 图标 class 用 icon.name：CheckCircleFilled → anticon-check-circle）
    expect(document.querySelector(".anticon-check-circle")).toBeTruthy();
    expect(
      document.querySelector(".read-all-result .ant-tag-error"),
    ).toBeNull();
  });

  it("有失败：警示图标 + 失败 Tag 带 error 语义色", () => {
    render(
      <ReadAllResultMessage
        summary={summary({
          successCount: 6,
          failureCount: 2,
          cancelledCount: 1,
        })}
      />,
    );
    // （antd 图标 class 用 icon.name：ExclamationCircleFilled → anticon-exclamation-circle）
    expect(
      document.querySelector(".anticon-exclamation-circle"),
    ).toBeTruthy();
    expect(document.querySelector(".read-all-result .ant-tag-error")).toBeTruthy();
    expect(document.querySelector(".read-all-result")?.textContent).toContain(
      "2 Failed",
    );
  });

  it("zh-CN：中文文案与数字", () => {
    applyLanguage("zh-CN");
    render(<ReadAllResultMessage summary={summary()} />);
    const root = document.querySelector(".read-all-result");
    expect(root?.textContent).toContain("全表读取完成");
    expect(root?.textContent).toContain("成功 8");
    expect(root?.textContent).toContain("152 毫秒");
  });
});
