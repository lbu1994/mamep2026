import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import type { WorkspaceRecoveryInfo } from "@mamep2026/domain";

/**
 * 工作区恢复提示横幅（PRD §8.3 / TECH_DESIGN §19.7）：
 * 加载时发生「从备份恢复」或「恢复失败已重建为空工作区」时在主体区顶部展示；
 * `source:"none"`（正常恢复）不渲染；纯信息、无操作按钮（重置仍走 Settings）。
 */
export function RecoveryBanner({
  recovery,
}: {
  recovery: WorkspaceRecoveryInfo | null;
}): React.ReactNode {
  const { t } = useTranslation();
  if (recovery === null || !recovery.recovered || recovery.source === "none") {
    return null;
  }
  const time = new Date(recovery.recoveredAt).toLocaleString();
  if (recovery.source === "backup") {
    return (
      <div className="mamep-recovery-banner" data-testid="recovery-banner">
        <Alert
          type="info"
          showIcon
          banner
          title={t("recovery.recoveredBackup", { time })}
        />
      </div>
    );
  }
  // source === "fresh"：主+备份均不可用，应用以空工作区保持可操作。
  return (
    <div className="mamep-recovery-banner" data-testid="recovery-banner">
      <Alert
        type="warning"
        showIcon
        banner
        title={t("recovery.recoveredFresh", {
          detail: recovery.errorCode ?? "",
        })}
      />
    </div>
  );
}
