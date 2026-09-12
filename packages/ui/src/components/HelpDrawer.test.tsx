/**
 * 帮助抽屉（HelpDrawer）单测（jsdom，PRD §8.3 完整用户帮助，2026-09-05）。
 * 覆盖：
 * - 渲染各页签标题 + 默认页（快速上手）正文
 * - 点击页签切换正文（中文按语言解析由 help-content 单测覆盖，此处用默认语言）
 * - 键盘快捷键页签渲染既有 KeyboardShortcutsTable
 * - 有文档贡献时渲染「插件文档」页签与内容；无贡献时不渲染该页签
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Contribution } from "@mamep2026/plugin-api";
import { initI18n } from "../i18n";
import { HelpDrawer } from "./HelpDrawer";
import type { DocumentationContribution } from "./documentation-markdown";

function clickTab(name: string): void {
  const tab = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-tabs-tab"),
  ).find((el) => el.textContent?.trim() === name);
  expect(tab).toBeTruthy();
  fireEvent.click(tab as HTMLElement);
}

beforeEach(() => {
  initI18n();
});

describe("HelpDrawer（PRD §8.3 完整用户帮助）", () => {
  it("渲染各页签标题，默认显示「快速上手」正文", () => {
    render(<HelpDrawer open onClose={() => {}} documentationContributions={[]} />);
    // 页签标题（role=tab，与正文标题区分，避免与内容 <h4> 重复匹配）。
    expect(screen.getByRole("tab", { name: "Getting Started" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Connection" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Keyboard Shortcuts" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "About" })).toBeTruthy();
    // 默认内容（markdown 渲染的 # 标题）。
    expect(screen.getByRole("heading", { name: "Getting Started" })).toBeTruthy();
  });

  it("点击页签切换正文", () => {
    render(<HelpDrawer open onClose={() => {}} documentationContributions={[]} />);
    clickTab("Table");
    expect(screen.getByRole("heading", { name: "Table" })).toBeTruthy();
    clickTab("About");
    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy();
  });

  it("键盘快捷键页签渲染快捷键总览（app/table 两组）", () => {
    render(<HelpDrawer open onClose={() => {}} documentationContributions={[]} />);
    clickTab("Keyboard Shortcuts");
    expect(document.querySelectorAll(".keyboard-shortcuts__table").length).toBe(2);
  });

  it("有文档贡献时渲染「插件文档」页签与内容", () => {
    const contributions: Contribution<DocumentationContribution>[] = [
      {
        pluginId: "test-plugin",
        payload: {
          id: "test.manual",
          titleKey: "plugins.testManualTitle",
          markdown: "# Test Manual\n\nManual body.",
        },
      },
    ];
    render(
      <HelpDrawer
        open
        onClose={() => {}}
        documentationContributions={contributions}
      />,
    );
    clickTab("Plugin Documentation");
    expect(screen.getByRole("heading", { name: "Test Manual" })).toBeTruthy();
    expect(screen.getByText("Manual body.")).toBeTruthy();
  });

  it("无文档贡献时不渲染「插件文档」页签", () => {
    render(<HelpDrawer open onClose={() => {}} documentationContributions={[]} />);
    expect(screen.queryByText("Plugin Documentation")).toBeNull();
  });
});
