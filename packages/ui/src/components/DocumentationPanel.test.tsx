import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderMarkdown } from "./documentation-markdown";

describe("renderMarkdown（ADR-043 E-5 轻量渲染）", () => {
  it("渲染标题/段落/行内 code 与 bold", () => {
    render(
      <div>
        {renderMarkdown(
          "# Title One\n\nA paragraph with `code` and **bold** text.",
        )}
      </div>,
    );
    expect(screen.getByRole("heading", { name: "Title One" })).toBeTruthy();
    // 段落文本被行内元素拆分为多个文本节点，用正则按 textContent 匹配。
    expect(screen.getByText(/A paragraph with/)).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
  });

  it("渲染无序列表", () => {
    render(<div>{renderMarkdown("- item one\n- item two")}</div>);
    expect(screen.getByText("item one")).toBeTruthy();
    expect(screen.getByText("item two")).toBeTruthy();
  });

  it("渲染围栏代码块", () => {
    render(
      <div>
        {renderMarkdown("```\nslave + 67H + 01H + 0DH + CRC\n```")}
      </div>,
    );
    expect(screen.getByText("slave + 67H + 01H + 0DH + CRC")).toBeTruthy();
  });

  it("空输入返回空", () => {
    expect(renderMarkdown("")).toHaveLength(0);
  });
});
