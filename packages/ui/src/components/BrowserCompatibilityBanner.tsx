import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import type { BrowserCompatibility } from "@mamep2026/domain";

/**
 * 浏览器兼容性提示横幅（PRD §8.3 / §15.7）：
 * Web Serial 缺失或非安全上下文时在主体区顶部提示 + 替代方案；
 * 桌面端（null）/ mock 传输 / 全部可用时不渲染。
 */
export function BrowserCompatibilityBanner({
  compatibility,
  isMock,
}: {
  compatibility: BrowserCompatibility | null;
  isMock: boolean;
}): React.ReactNode {
  const { t } = useTranslation();
  if (compatibility === null || isMock || compatibility.usable) return null;
  const lines: string[] = [];
  if (compatibility.issues.includes("web-serial-missing")) {
    lines.push(t("compat.webSerialMissing"));
  }
  if (compatibility.issues.includes("insecure-context")) {
    lines.push(t("compat.insecureContext"));
  }
  return (
    <div className="mamep-compat-banner" data-testid="browser-compat-banner">
      <Alert
        type="warning"
        showIcon
        banner
        title={t("compat.title")}
        description={
          <>
            <span>{lines.join(" ")}</span>
            <br />
            <span>{t("compat.alternative")}</span>
          </>
        }
      />
    </div>
  );
}
