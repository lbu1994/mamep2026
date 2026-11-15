/**
 * 快捷键按键展示（<kbd> 风格，PRD §8.3 P1）。
 * antd v6 无内置 Kbd 组件；自写小组件，供 Help 弹窗快捷键总览使用。
 * 样式见 apps/web/src/index.css 的 .shortcut-key。
 */
import { memo } from "react";

export const ShortcutKey = memo(function ShortcutKey({
  combo,
}: {
  combo: string;
}): React.ReactNode {
  const parts = combo.split("+").map((part) => part.trim());
  return (
    <span className="shortcut-key">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="shortcut-key__part">
          {index > 0 ? (
            <span className="shortcut-key__plus" aria-hidden="true">
              +
            </span>
          ) : null}
          <kbd className="shortcut-key__kbd">{part}</kbd>
        </span>
      ))}
    </span>
  );
});
