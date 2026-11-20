/**
 * 工作区导入/导出操作（键盘快捷键复用）。
 * 渲染在 Settings 弹窗内（MamepApp 的 <AntApp> 之内），故可用 App.useApp()（antd message）。
 * 逻辑统一在 useWorkspaceTransfer（。/workspace-transfer）：与 AppShortcutLayer
 * （Ctrl+Shift+S 导出 / Ctrl+Alt+O 导入）共用同一套序列化/解析/落盘/提示。
 * 组件保持薄：序列化/解析在 packages/workspace；替换工作区在 store.applyWorkspaceImport。
 */
import Button from "antd/es/button";
import Space from "antd/es/space";
import Tooltip from "antd/es/tooltip";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useWorkspaceTransfer } from "../workspace-transfer";

export function WorkspaceFileActions(): React.ReactNode {
  const { t } = useTranslation();
  const {
    handleExportWorkspace,
    handleImportWorkspace,
    handleImportFileChange,
    importFileInputRef,
  } = useWorkspaceTransfer();

  return (
    <>
      <Space wrap>
        <Tooltip title={t("workspace.exportHint")}>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExportWorkspace}
            aria-label={t("workspace.export")}
          >
            {t("workspace.export")}
          </Button>
        </Tooltip>
        <Tooltip title={t("workspace.importHint")}>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={handleImportWorkspace}
            aria-label={t("workspace.import")}
          >
            {t("workspace.import")}
          </Button>
        </Tooltip>
      </Space>
      {/* 浏览器端工作区导入的隐藏文件选择（workspaceImport === "upload" 时使用）。 */}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleImportFileChange}
        data-testid="workspace-import-file"
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
