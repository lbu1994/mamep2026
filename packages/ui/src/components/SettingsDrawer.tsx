/**
 * Settings 抽屉（右侧 Drawer，侧滑展开）。
 *
 * 构建产物代码分割时自 MamepApp 抽出为独立组件（`React.lazy` 按需加载）：
 * - 主题明暗（`settings.themeLight/Dark`）；
 * - 主题色预设下拉（内置默认蓝 + 各启用插件注册色）；
 * - 界面语言（随工作区偏好持久化）；
 * - 重置工作区（Popconfirm 二次确认）；
 * - 工作区导入/导出入口（WorkspaceFileActions）；
 * - 插件 settings 贡献分区（声明式标题占位）。
 *
 *  抽屉体使用 `Tabs`（`General` / `Plugins`），
 * `Plugins` 页签 = 插件管理区块（`PluginManagerSection`）+ 插件 settings 贡献分区；
 * `General` 为上述设置项。
 *
 * 组件自读 store（`settingsModalOpen` 等），仅需 `host` 读取插件贡献与重置工作区；
 * 主题装配链（基础主题 + 所选预设 merge）仍由 MamepApp 负责，不影响 ConfigProvider。
 *
 * 宽度策略：Drawer 的 `width`/`height` 在 antd v6 已弃用（且非纯数字字符串会触发
 * rc-drawer 的「Invalid value type of width or height」警告），故用数值 `size={420}`，
 * 窄屏兜底交给 `.settings-drawer` 的 CSS `max-width: 100vw`（apps/web/src/index.css）。
 *
 * 类名用 `rootClassName`（而非 `className`）：antd v6 的 `className` 落在内容面板
 * （`.ant-drawer-section`）上，而开合类 `.ant-drawer-open`、`.ant-drawer-mask`、
 * `.ant-drawer-content-wrapper` 都在**根元素**上；用根级类才能同时限定遮罩、宽度与开合态
 * （e2e 断言 `.settings-drawer.ant-drawer-open`）。
 *
 * 关闭方式：右上角关闭按钮 / `Esc` / 点击遮罩（antd 默认行为，与改造前 Modal 一致）。
 */
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Button from "antd/es/button";
import Divider from "antd/es/divider";
import Drawer from "antd/es/drawer";
import Popconfirm from "antd/es/popconfirm";
import Segmented from "antd/es/segmented";
import Select from "antd/es/select";
import Space from "antd/es/space";
import Tabs from "antd/es/tabs";
import Typography from "antd/es/typography";
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

let pluginManagerModule:
  Promise<typeof import("./PluginManagerSection")> | undefined;

function loadPluginManagerSection(): Promise<
  typeof import("./PluginManagerSection")
> {
  pluginManagerModule ??= import("./PluginManagerSection");
  return pluginManagerModule;
}

const PluginManagerSection = lazy(() =>
  loadPluginManagerSection().then((module) => ({
    default: module.PluginManagerSection,
  })),
);

/** 主题色选项 label：色块 + 名称。 */
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

export function SettingsDrawer({
  host,
}: {
  host: AppHost | null;
}): React.ReactNode {
  const { t, i18n } = useTranslation();
  const open = useAppStore((s) => s.settingsModalOpen);
  const setOpen = useAppStore((s) => s.setSettingsModalOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  // 所选主题色预设：null=内置 Ant Design 默认蓝；插件色=`<pluginId>:<colorId>`。
  const themePrimary = useAppStore((s) => s.themePrimary);
  const setThemePrimary = useAppStore((s) => s.setThemePrimary);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const appendMessage = useAppStore((s) => s.appendMessage);
  // 插件主题贡献：仅需选项列表（是否应用由 MamepApp 装配；禁用/卸载后选项消失）。
  const themeContributions = usePluginContributions<ThemeContribution>(
    host,
    "theme",
  );
  const themeColorOptions = useMemo(
    () => buildThemeColorOptions(themeContributions),
    [themeContributions],
  );
  // settings 贡献消费方：设置分区（声明式标题占位）。
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

  // 常规页签（内容与顺序零改动）。
  const generalTab = (
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
      <Typography.Paragraph type="secondary">
        {t("settings.aboutText")}
      </Typography.Paragraph>
    </Space>
  );

  // 插件页签（入口整合）：插件管理区块（安装/启停/卸载/恢复）
  // + 插件 settings 贡献分区。
  const pluginsTab = (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Suspense
        fallback={
          <Typography.Text type="secondary">{t("app.loading")}</Typography.Text>
        }
      >
        <PluginManagerSection />
      </Suspense>
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
    </Space>
  );

  return (
    <Drawer
      title={t("settings.title")}
      placement="right"
      size={420}
      open={open}
      onClose={() => setOpen(false)}
      rootClassName="settings-drawer"
    >
      <Tabs
        items={[
          {
            key: "general",
            label: t("settings.tabGeneral"),
            children: generalTab,
          },
          {
            key: "plugins",
            label: (
              <span
                onPointerEnter={() => void loadPluginManagerSection()}
                onFocus={() => void loadPluginManagerSection()}
              >
                {t("settings.tabPlugins")}
              </span>
            ),
            children: pluginsTab,
          },
        ]}
      />
    </Drawer>
  );
}
