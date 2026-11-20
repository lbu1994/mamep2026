/**
 * 工作区导入预览/确认弹窗（PRD §8.3 P1）。
 * 解析通过的导入草稿（workspaceImportDraft）在此展示摘要 + 覆盖风险提示，
 * 确认后经 store.applyWorkspaceImport 替换当前工作区（清空撤销栈、触发自动保存）。
 * 组件保持薄：文件读取/解析/错误提示在 MamepApp 入口处理。
 */
import { App as AntApp } from "antd";
import Descriptions from "antd/es/descriptions";
import Modal from "antd/es/modal";
import Space from "antd/es/space";
import Typography from "antd/es/typography";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../app-store";

export function WorkspaceImportModal(): React.ReactNode {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const draft = useAppStore((s) => s.workspaceImportDraft);
  const setWorkspaceImportDraft = useAppStore((s) => s.setWorkspaceImportDraft);
  const applyWorkspaceImport = useAppStore((s) => s.applyWorkspaceImport);

  const handleOk = (): void => {
    if (draft === null) return;
    applyWorkspaceImport();
    message.open({ type: "success", content: t("workspace.importSuccess") });
  };

  return (
    <Modal
      title={t("workspace.importConfirmTitle")}
      open={draft !== null}
      onOk={handleOk}
      onCancel={() => setWorkspaceImportDraft(null)}
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
