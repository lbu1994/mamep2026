/**
 * Help/关于抽屉（PRD §8.3「完整用户帮助」，2026-09-05）。
 *
 * 由 Modal 改为右侧 Drawer + 顶部 Tabs：按主题分页展示完整帮助正文；
 * 复用 ADR-043 E-5 的 markdown 渲染（renderMarkdown）与已有组件：
 * - 键盘快捷键 → KeyboardShortcutsTable；
 * - 插件文档 → DocumentationPanel（文档/寄存器手册贡献点）。
 *
 * 独立成文件（react-refresh only-export-components），由 MamepApp 装配。
 */
import { useTranslation } from "react-i18next";
import { Drawer, Tabs, type TabsProps } from "antd";
import type { ReactNode } from "react";
import type { Contribution } from "@mamep2026/plugin-api";
import { KeyboardShortcutsTable } from "./KeyboardShortcutsTable";
import { DocumentationPanel } from "./DocumentationPanel";
import {
  renderMarkdown,
  type DocumentationContribution,
} from "./documentation-markdown";
import {
  resolveHelpContent,
  type HelpTabId,
} from "../help/help-content";

/** 动态正文页（标题走 i18n，正文按语言解析 markdown）。 */
const CONTENT_TABS: ReadonlyArray<{ key: string; tabId: HelpTabId; i18nKey: string }> = [
  { key: "getting-started", tabId: "getting-started", i18nKey: "help.tabGettingStarted" },
  { key: "connection", tabId: "connection", i18nKey: "help.tabConnection" },
  { key: "register-table", tabId: "register-table", i18nKey: "help.tabRegisterTable" },
  { key: "read-write", tabId: "read-write", i18nKey: "help.tabReadWrite" },
  { key: "workspace", tabId: "workspace", i18nKey: "help.tabWorkspace" },
  { key: "settings-theme", tabId: "settings-theme", i18nKey: "help.tabSettings" },
  { key: "plugins", tabId: "plugins", i18nKey: "help.tabPlugins" },
] as const;

export function HelpDrawer({
  open,
  onClose,
  documentationContributions,
}: {
  open: boolean;
  onClose: () => void;
  documentationContributions: readonly Contribution<DocumentationContribution>[];
}): ReactNode {
  const { t, i18n } = useTranslation();

  const items: TabsProps["items"] = [
    ...CONTENT_TABS.map(({ key, tabId, i18nKey }) => ({
      key,
      label: t(i18nKey),
      children: renderMarkdown(resolveHelpContent(tabId, i18n.language)),
    })),
    {
      key: "shortcuts",
      label: t("help.tabShortcuts"),
      children: <KeyboardShortcutsTable />,
    },
    ...(documentationContributions.length > 0
      ? [
          {
            key: "plugin-docs",
            label: t("help.tabPluginDocs"),
            children: (
              <DocumentationPanel
                contributions={documentationContributions}
                titleResolver={(key, fallback) =>
                  i18n.exists(key) ? t(key) : fallback
                }
              />
            ),
          },
        ]
      : []),
    {
      key: "about",
      label: t("help.tabAbout"),
      children: renderMarkdown(resolveHelpContent("about", i18n.language)),
    },
  ];

  return (
    <Drawer
      title={t("help.title")}
      placement="right"
      size={1100}
      open={open}
      onClose={onClose}
      className="help-drawer"
    >
      <Tabs className="help-drawer__tabs" defaultActiveKey="getting-started" items={items} />
    </Drawer>
  );
}
