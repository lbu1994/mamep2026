/**
 * 工作区导入预览/确认弹窗（PRD §8.3 P1）。
 * 解析通过的导入草稿（workspaceImportDraft）在此展示摘要 + 覆盖风险提示，
 * 确认后经 store.applyWorkspaceImport 替换当前工作区（清空撤销栈、触发自动保存）。
 * 组件保持薄：文件读取/解析/错误提示在 MamepApp 入口处理。
 */
import { useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import Descriptions from "antd/es/descriptions";
import Modal from "antd/es/modal";
import Space from "antd/es/space";
import Typography from "antd/es/typography";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../app-store";
import { cancelWorkspaceImportPreparation } from "../workspace-transfer";

export function WorkspaceImportModal(): React.ReactNode {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const draft = useAppStore((s) => s.workspaceImportDraft);
  const setWorkspaceImportDraft = useAppStore((s) => s.setWorkspaceImportDraft);
  const applyWorkspaceImport = useAppStore((s) => s.applyWorkspaceImport);
  const [committing, setCommitting] = useState(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) {
        clearTimeout(commitTimerRef.current);
      }
    },
    [],
  );

  const handleOk = (): void => {
    if (draft === null || committing) return;
    // 确认按钮只启动提交；1000 行工作区替换和表格重渲染进入下一任务，关闭动画
    // 仍可先绘制。取消会清空草稿，使排队提交因草稿版本不匹配而失效。
    setCommitting(true);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      applyWorkspaceImport(draft);
      setCommitting(false);
      message.open({
        type: "success",
        content: t("workspace.importSuccess"),
      });
    }, 0);
  };

  const handleCancel = (): void => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    cancelWorkspaceImportPreparation();
    setCommitting(false);
    setWorkspaceImportDraft(null);
  };

  return (
    <Modal
      title={t("workspace.importConfirmTitle")}
      open={draft !== null}
      confirmLoading={committing}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={t("workspace.importOk")}
      cancelText={t("connection.cancel")}
    >
      {draft !== null ? (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label={t("workspace.previewName")}>
              {draft.preview.name}
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.previewSchemaVersion")}>
              {draft.preview.schemaVersion}
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.previewSheets")}>
              {draft.preview.sheets}
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.previewRows")}>
              {draft.preview.rows}
            </Descriptions.Item>
            <Descriptions.Item label={t("workspace.previewConnections")}>
              {draft.preview.connections}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Paragraph type="warning">
            {t("workspace.importConfirmContent")}
          </Typography.Paragraph>
        </Space>
      ) : null}
    </Modal>
  );
}
