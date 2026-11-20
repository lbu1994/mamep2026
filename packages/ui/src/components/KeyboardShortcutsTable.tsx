/**
 * Help 弹窗「键盘快捷键」总览（PRD §8.3 P1）。
 * 数据源 = keyboard/shortcuts.ts 注册表（唯一事实源），按 scope（app/table）分组展示；
 * 别名快捷键（如 "?" = Ctrl+/）不重复展示。
 * 优先用 antd Table 既有能力（size="small"、pagination={false}）。
 */
import { useTranslation } from "react-i18next";
import Table from "antd/es/table";
import Typography from "antd/es/typography";
import type { ColumnsType } from "antd/es/table";
import { ALL_SHORTCUTS, shortcutI18nKey } from "../keyboard/shortcuts";
import { ShortcutKey } from "./ShortcutKey";

interface ShortcutRow {
  key: string;
  combo: string;
  action: string;
}

export function KeyboardShortcutsTable(): React.ReactNode {
  const { t } = useTranslation();
  // 别名（aliasOf）不重复展示；i18n 文案来自注册表 i18nKey（keyboard.<id>）。
  const rows = ALL_SHORTCUTS.filter((def) => def.aliasOf === undefined).map(
    (def) => ({
      key: def.id,
      scope: def.scope,
      combo: def.comboLabel,
      action: t(shortcutI18nKey(def.id)),
    }),
  );

  const columns: ColumnsType<ShortcutRow & { scope: "app" | "table" }> = [
    {
      title: t("keyboard.shortcut"),
      dataIndex: "combo",
      key: "combo",
      width: 190,
      render: (combo: string) => <ShortcutKey combo={combo} />,
    },
    {
      title: t("keyboard.action"),
      dataIndex: "action",
      key: "action",
    },
  ];

  return (
    <div className="keyboard-shortcuts">
      <Typography.Title level={5} className="keyboard-shortcuts__title">
        {t("keyboard.title")}
      </Typography.Title>
      <Typography.Text strong className="keyboard-shortcuts__group">
        {t("keyboard.groupApp")}
      </Typography.Text>
      <Table
        size="small"
        pagination={false}
        columns={columns}
        dataSource={rows.filter((r) => r.scope === "app")}
        className="keyboard-shortcuts__table"
      />
      <Typography.Text strong className="keyboard-shortcuts__group">
        {t("keyboard.groupTable")}
      </Typography.Text>
      <Table
        size="small"
        pagination={false}
        columns={columns}
        dataSource={rows.filter((r) => r.scope === "table")}
        className="keyboard-shortcuts__table"
      />
      <Typography.Paragraph
        type="secondary"
        className="keyboard-shortcuts__hint"
      >
        {t("keyboard.hint")}
      </Typography.Paragraph>
    </div>
  );
}
