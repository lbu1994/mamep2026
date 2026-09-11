/**
 * Settings 弹窗（2026-09-11 构建产物代码分割：自 MamepApp 抽出为独立组件，
 * 由 MamepApp 经 `React.lazy` 按需加载）。
 *
 * 内容与行为与抽出前完全一致：
 * - 主题明暗（`settings.themeLight/Dark`）；
 * - 主题色预设下拉（ADR-047/048：内置默认蓝 + 各启用插件注册色）；
 * - 界面语言（随工作区偏好持久化）；
 * - 重置工作区（ADR-049，Popconfirm 二次确认）；
 * - 工作区导入/导出入口（ADR-033，WorkspaceFileActions）；
 * - 插件 settings 贡献分区（ADR-039，声明式标题占位）。
 *
 * 组件自读 store（`settingsModalOpen` 等），仅需 `host` 读取插件贡献与重置工作区；
 * 主题装配链（基础主题 + 所选预设 merge）仍由 MamepApp 负责，不影响 ConfigProvider。
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Divider,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Typography,
} from "antd";
import type { AppHost } from "../host";
import { useAppStore } from "../app-store";
import { usePluginContributions } from "../plugin/use-contributions";
import {
  buildThemeColorOptions,
  DEFAULT_THEME_COLOR_ID,
  themeColorTitle,
  type ThemeContribution,
} from "../plugin/theme-contributions";
import type { SettingsContribution } from "../plugin/plugin-registries";
import { WorkspaceFileActions } from "./WorkspaceFileActions";

/** 主题色选项 label：色块 + 名称（ADR-047）。 */
function themeColorOptionLabel(title: string, color: string): ReactNode {
  return (
    <Space size={4}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
        }}
      />
      {title}
    </Space>
  );
}

export function SettingsModal({
  host,
}: {
  host: AppHost | null;
}): React.ReactNode {
  const { t, i18n } = useTranslation();
  const open = useAppStore((s) => s.settingsModalOpen);
  const setOpen = useAppStore((s) => s.setSettingsModalOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  // 所选主题色预设（ADR-047）：null=内置 Ant Design 默认蓝；插件色=`<pluginId>:<colorId>`。
  const themePrimary = useAppStore((s) => s.themePrimary);
  const setThemePrimary = useAppStore((s) => s.setThemePrimary);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const appendMessage = useAppStore((s) => s.appendMessage);
  // 插件主题贡献（ADR-047）：仅需选项列表（是否应用由 MamepApp 装配；禁用/卸载后选项消失）。
  const themeContributions = usePluginContributions<ThemeContribution>(
    host,
    "theme",
  );
  const themeColorOptions = useMemo(
    () => buildThemeColorOptions(themeContributions),
    [themeContributions],
  );
  // settings 贡献消费方（ADR-039）：Settings 弹窗分区（声明式标题占位）。
  const settingsContributions = usePluginContributions<SettingsContribution>(
    host,
    "settings",
  );

  const handleResetWorkspace = (): void => {
    if (host === null || host === undefined) return;
    void host.resetWorkspace().then((result) => {
      if (result.ok) {
        setWorkspace(result.value);
        appendMessage({
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.workspaceReset",
          detail: null,
        });
      } else {
        appendMessage({
          timestamp: Date.now(),
          level: "error",
          messageKey: "messages.resetFailed",
          params: { detail: result.error.code },
          detail: result.error.code,
        });
      }
    });
  };

  return (
    <Modal
      title={t("settings.title")}
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
    >
      <Space orientation="vertical" style={{ width: "100%" }}>
        <div>
          <Typography.Text>{t("settings.theme")}</Typography.Text>
          <Segmented
            style={{ marginLeft: 8 }}
            value={theme}
            onChange={(value) => setTheme(value as "light" | "dark")}
            options={[
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
          />
        </div>
        <div>
          <Typography.Text>{t("settings.themeColor")}</Typography.Text>
          <Select
            size="small"
            style={{ marginLeft: 8, minWidth: 160 }}
            aria-label={t("settings.themeColor")}
            value={themePrimary ?? DEFAULT_THEME_COLOR_ID}
            onChange={(value) =>
              setThemePrimary(value === DEFAULT_THEME_COLOR_ID ? null : value)
            }
            options={[
              {
                value: DEFAULT_THEME_COLOR_ID,
                label: t("settings.themeColorDefault"),
              },
              ...themeColorOptions.map((option) => ({
                value: option.id,
                label: themeColorOptionLabel(
                  themeColorTitle(option, i18n.language, t),
                  option.colorPrimary,
                ),
              })),
            ]}
          />
        </div>
        <div>
          <Typography.Text type="secondary">{t("app.title")}</Typography.Text>{" "}
          <Select
            size="small"
            value={i18n.language}
            style={{ width: 100, marginLeft: 8 }}
            onChange={(value) => {
              // 语言切换：立即生效 + 记入工作区偏好（随自动保存持久化）。
              const language = value as "en-US" | "zh-CN";
              setLanguage(language);
              void i18n.changeLanguage(language);
            }}
            options={[
              { value: "en-US", label: "English" },
              { value: "zh-CN", label: "中文" },
            ]}
          />
        </div>
        <div>
          <Popconfirm
            title={t("settings.resetConfirmTitle")}
            description={t("settings.resetConfirmContent")}
            okText={t("settings.resetOk")}
            cancelText={t("connection.cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleResetWorkspace()}
          >
            <Button danger size="small">
              {t("settings.resetWorkspace")}
            </Button>
          </Popconfirm>
        </div>
        <div>
          <WorkspaceFileActions />
        </div>
        {settingsContributions.length > 0 && (
          <div className="plugin-settings" data-testid="plugin-settings">
            {settingsContributions.map((contribution) => (
              <div key={contribution.payload.id}>
                <Divider titlePlacement="left" plain>
                  {t(contribution.payload.titleKey)}
                </Divider>
                <Typography.Text type="secondary">
                  {t("plugins.settingsPlaceholder")}
                </Typography.Text>
              </div>
            ))}
          </div>
        )}
        <Typography.Paragraph type="secondary">
          {t("settings.aboutText")}
        </Typography.Paragraph>
      </Space>
    </Modal>
  );
}
