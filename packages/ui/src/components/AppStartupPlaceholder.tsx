import { Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { AppIcon } from "../assets/AppIcon";

/**
 * 启动骨架屏（2026-09-13）。
 *
 * 场景：宿主实现（Electron / VSCode / Android / 浏览器）按运行时平台动态加载（见
 * `apps/web/src/host-assembly.ts`），装配完成前 `host` 为空。此时显示轻量占位，替代
 * 「渲染空壳再跳变」的观感。
 *
 * 边界：**只覆盖 Host 装配阶段**（模块加载 + 宿主构造）——工作区加载、连接设置自动弹出
 * 等仍由真实外壳承担（`hostStatus === "ready"` 后即切换）。装配失败（`"failed"`）不占位：
 * 应用以「无 Host」保持可操作，错误经消息栏提示（`messages.hostLoadFailed`）。
 *
 * 由 `MamepApp` 在 `<ConfigProvider>` + `<AntApp>` 内渲染，故主题令牌（含 VSCode 完整
 * 令牌映射）与暗色算法均生效，深色下不会白屏闪烁。
 */
export function AppStartupPlaceholder(): React.ReactNode {
  const { t } = useTranslation();
  return (
    <div
      className="app-startup"
      data-testid="app-startup"
      role="status"
      aria-live="polite"
      aria-label={t("app.loading")}
    >
      <span className="app-startup__brand-icon">
        <AppIcon size={32} />
      </span>
      <Typography.Text className="app-startup__title">
        {t("app.title")}
      </Typography.Text>
      <Spin size="small" />
      <Typography.Text type="secondary" className="app-startup__hint">
        {t("app.loading")}
      </Typography.Text>
    </div>
  );
}
