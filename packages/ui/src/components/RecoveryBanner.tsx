import { useRef, useState } from "react";
import Button from "antd/es/button";
import Descriptions from "antd/es/descriptions";
import Modal from "antd/es/modal";
import Space from "antd/es/space";
import { useAppStore } from "../app-store";
import Alert from "antd/es/alert";
import { useTranslation } from "react-i18next";
import type { WorkspaceRecoveryInfo } from "@mamep2026/domain";

/**
 * 工作区恢复提示横幅（PRD §8.3 / TECH_DESIGN §19.7）：
 * 加载时发生「从备份恢复」或「恢复失败已重建为空工作区」时在主体区顶部展示；
 * Pending recovery exposes preview, export and confirmation; normal loads show no banner.
 */
export function RecoveryBanner({
  recovery,
}: {
  recovery: WorkspaceRecoveryInfo | null;
}): React.ReactNode {
  const { t } = useTranslation();
  const host = useAppStore((state) => state.host);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);

  const run = async (action: "restore" | "export" | "retry"): Promise<void> => {
    if (host === null || active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action === "export") {
        const result = await host.exportWorkspaceRecovery?.();
        if (result === undefined)
          throw new Error("PERSISTENCE_RECOVERY_UNAVAILABLE");
        if (!result.ok) throw new Error(result.error.code);
        const saved = await host.saveTextFile({
          suggestedName: "mamep-workspace-original.json",
          content: result.value,
          mimeType: "application/json",
        });
        if (!saved.ok) throw new Error(saved.error.code);
      } else {
        const result =
          action === "restore"
            ? await host.recoverWorkspace?.()
            : await host.loadWorkspace();
        useAppStore
          .getState()
          .setWorkspaceRecovery(host.getWorkspaceRecoveryInfo());
        if (result === undefined)
          throw new Error("PERSISTENCE_RECOVERY_UNAVAILABLE");
        if (!result.ok) throw new Error(result.error.code);
        if (action === "restore" || !host.getWorkspaceRecoveryInfo()?.pending) {
          useAppStore.getState().setWorkspace(result.value);
          setOpen(false);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      active.current = false;
      setBusy(false);
    }
  };

  if (recovery?.pending) {
    const preview = recovery.preview;
    return (
      <div className="mamep-recovery-banner" data-testid="recovery-banner">
        <Alert
          type="warning"
          showIcon
          banner
          title={t("recovery.pending")}
          description={
            recovery.archiveId
              ? t("recovery.archived")
              : t("recovery.archiveFailed")
          }
          action={
            <Button onClick={() => setOpen(true)}>
              {t("recovery.review")}
            </Button>
          }
        />
        <Modal
          title={t("recovery.review")}
          open={open}
          onCancel={() => {
            if (!active.current) setOpen(false);
          }}
          footer={
            <Space wrap>
              <Button disabled={busy} onClick={() => setOpen(false)}>
                {t("connection.cancel")}
              </Button>
              <Button disabled={busy} onClick={() => void run("retry")}>
                {t("recovery.retry")}
              </Button>
              <Button
                disabled={
                  busy || host?.capabilities.workspaceExport === "unsupported"
                }
                onClick={() => void run("export")}
              >
                {t("recovery.exportOriginal")}
              </Button>
              <Button
                type="primary"
                loading={busy}
                disabled={
                  busy ||
                  preview === undefined ||
                  recovery.archiveId === undefined
                }
                onClick={() => void run("restore")}
              >
                {t("recovery.confirm")}
              </Button>
            </Space>
          }
        >
          <p>{t("recovery.confirmDescription")}</p>
          {preview ? (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t("workspace.previewName")}>
                {preview.name}
              </Descriptions.Item>
              <Descriptions.Item label={t("workspace.previewSchemaVersion")}>
                {preview.schemaVersion}
              </Descriptions.Item>
              <Descriptions.Item label={t("workspace.previewSheets")}>
                {preview.sheets}
              </Descriptions.Item>
              <Descriptions.Item label={t("workspace.previewRows")}>
                {preview.rows}
              </Descriptions.Item>
              <Descriptions.Item label={t("workspace.previewConnections")}>
                {preview.connections}
              </Descriptions.Item>
              <Descriptions.Item label={t("recovery.backupTime")}>
                {recovery.backupTimestamp === null
                  ? t("recovery.unknownTime")
                  : new Date(recovery.backupTimestamp).toLocaleString()}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <p>{t("recovery.noBackup")}</p>
          )}
          <p>{t("recovery.exportDescription")}</p>
          {host?.capabilities.workspaceExport === "unsupported" && (
            <p>{t("recovery.exportUnsupported")}</p>
          )}
          {error !== null && (
            <Alert
              type="error"
              title={t("recovery.actionFailed", { detail: error })}
            />
          )}
        </Modal>
      </div>
    );
  }
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
