import { useTranslation } from "react-i18next";
import { AppIcon } from "./assets/AppIcon";
import { useAppStore } from "./runtime";

/**
 * 首屏骨架的轻量入口：不依赖 antd，也不导入完整 MamepApp。
 *
 * 主题与语言已由 `main.tsx` 在 React 首次渲染前同步写到 `<html>`；
 * 此处只提交品牌和加载状态，让浏览器先获得可绘制、可读的界面。
 */
export function AppStartupBootstrap(): React.ReactNode {
  const { t } = useTranslation();
  const cachedPrimary = useAppStore((state) => state.themeColorSeed);
  return (
    <div
      className="ant-app app-startup"
      style={
        {
          "--ant-color-primary": cachedPrimary ?? "#1677ff",
        } as React.CSSProperties
      }
      data-testid="app-startup"
      role="status"
      aria-live="polite"
      aria-label={t("app.loading")}
    >
      <span className="app-startup__brand-icon">
        <AppIcon size={32} />
      </span>
      <span className="app-startup__title">{t("app.title")}</span>
      <span className="app-startup__spinner" aria-hidden="true" />
      <span className="app-startup__hint">{t("app.loading")}</span>
    </div>
  );
}
