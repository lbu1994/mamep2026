/**
 * 文档面板（ADR-043 E-5）：渲染 `documentation` 贡献点。
 *
 * 轻量 Markdown 子集渲染（不引重库）逻辑见 ./documentation-markdown
 * （`renderMarkdown`/`DocumentationContribution`）。本文件只导出组件
 * （react-refresh only-export-components 约束）。
 */
import type { Contribution } from "@mamep2026/plugin-api";
import { Typography } from "antd";
import type { ReactNode } from "react";
import {
  renderMarkdown,
  type DocumentationContribution,
} from "./documentation-markdown";

/** 文档面板：渲染全部 documentation 贡献（按注册顺序）。 */
export function DocumentationPanel({
  contributions,
  titleResolver,
}: {
  contributions: readonly Contribution<DocumentationContribution>[];
  titleResolver: (titleKey: string, fallback: string) => string;
}): ReactNode {
  if (contributions.length === 0) return null;
  return (
    <div className="plugin-documentation">
      {contributions.map((contribution) => {
        const { id, titleKey, markdown } = contribution.payload;
        return (
          <section key={id} className="plugin-documentation__entry">
            <Typography.Title level={5}>
              {titleResolver(titleKey, id)}
            </Typography.Title>
            {renderMarkdown(markdown)}
          </section>
        );
      })}
    </div>
  );
}
