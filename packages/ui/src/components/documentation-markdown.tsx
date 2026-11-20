/**
 * documentation 贡献点的轻量 Markdown 渲染。
 *
 * 独立于 DocumentationPanel 组件文件（react-refresh only-export-components）：
 * 本文件只导出接口与纯函数，不导出组件。
 *
 * 支持的子集：
 * - `#`/`##`/`###` 标题（antd Typography.Title 级别 4/5 + Paragraph strong）；
 * - 段落文本（支持行内 `` `code` `` 与 `**bold**`）；
 * - `-`/`*` 无序列表；
 * - ` ``` ` 围栏代码块（等宽 pre）；
 * - 其余文本按段落输出。
 */
import Typography from "antd/es/typography";
import { Fragment, type ReactNode } from "react";

/** documentation 贡献 payload。 */
export interface DocumentationContribution {
  id: string;
  titleKey: string;
  markdown: string;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // 处理 **bold** 与 `code`。
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-c-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={`${keyPrefix}-t-${index}`}>{part}</Fragment>;
  });
}

/** 把 Markdown 文本渲染为 React 节点（子集）。 */
export function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let listBuffer: string[] = [];
  let codeBuffer: string[] | null = null;
  let key = 0;

  const flushList = (): void => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={`list-${key++}`}>
        {listBuffer.map((item, i) => (
          <li key={`li-${i}`}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (codeBuffer !== null) {
      if (line.trim().startsWith("```")) {
        nodes.push(
          <pre key={`code-${key++}`}>
            <code>{codeBuffer.join("\n")}</code>
          </pre>,
        );
        codeBuffer = null;
      } else {
        codeBuffer.push(line);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushList();
      codeBuffer = [];
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading !== null) {
      flushList();
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      // exactOptionalPropertyTypes：仅在有值时传 level/style。
      const titleProps: { level?: 4 | 5 } = {};
      const styleProps: { fontSize?: number; marginTop?: number } = {};
      if (level === 1) titleProps.level = 4;
      if (level === 2) titleProps.level = 5;
      if (level === 3) {
        styleProps.fontSize = 14;
        styleProps.marginTop = 12;
      }
      nodes.push(
        <Typography.Title key={`h-${key++}`} {...titleProps} style={styleProps}>
          {renderInline(text, `h-${key}`)}
        </Typography.Title>,
      );
      continue;
    }
    const listItem = /^[-*]\s+(.+)$/.exec(line.trim());
    if (listItem !== null) {
      listBuffer.push(listItem[1] ?? "");
      continue;
    }
    if (line.trim() === "") {
      flushList();
      continue;
    }
    flushList();
    nodes.push(
      <Typography.Paragraph key={`p-${key++}`}>
        {renderInline(line, `p-${key}`)}
      </Typography.Paragraph>,
    );
  }
  flushList();
  if (codeBuffer !== null) {
    nodes.push(
      <pre key={`code-${key++}`}>
        <code>{codeBuffer.join("\n")}</code>
      </pre>,
    );
  }
  return nodes;
}
