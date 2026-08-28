/**
 * 工作区导入/导出操作（2026-08-29，PRD §8.3 P1）。
 * 渲染在 Settings 弹窗内（MamepApp 的 <AntApp> 之内），故可用 App.useApp()（antd message）。
 * - 导出：serializeWorkspace（packages/workspace 纯函数）→ host.saveTextFile 落盘/下载；
 * - 导入：桌面端（workspaceImport === "file"）经 host.openTextFile 系统对话框读取；
 *   浏览器端（"upload"）隐藏 <input type="file"> 客户端读取（浏览器原生能力，不走 HostMessage）；
 *   读取文本 → parseWorkspace（含迁移与校验）→ 成功置 workspaceImportDraft（预览 Modal 确认）；
 *   失败 message + 底部消息，当前工作区不被破坏。
 * 组件保持薄：序列化/解析在 packages/workspace；替换工作区在 store.applyWorkspaceImport。
 */
import { useRef } from "react";
import { App as AntApp, Button, Space, Tooltip } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@mamep2026/domain";
import {
  parseWorkspace,
  serializeWorkspace,
  workspaceExportFileName,
} from "@mamep2026/workspace";
import {
  useAppStore,
  type WorkspaceImportPreview,
} from "../app-store";

export function WorkspaceFileActions(): React.ReactNode {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const host = useAppStore((s) => s.host);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const setWorkspaceImportDraft = useAppStore((s) => s.setWorkspaceImportDraft);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const summarizeImport = (workspace: Workspace): WorkspaceImportPreview => ({
    name: workspace.name,
    sheets: workspace.sheets.length,
    rows: workspace.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    connections: workspace.connectionProfiles.length,
    schemaVersion: workspace.schemaVersion,
  });

  const handleImportedText = (text: string): void => {
    let data: unknown;
    try {
      // parseWorkspace 期望已解析的对象（与仓储加载路径一致，indexeddb-repository 先 JSON.parse）。
      data = JSON.parse(text);
    } catch {
      void message.open({ type: "error", content: t("workspace.importFailed") });
      appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: "errors.workspaceSchemaInvalid",
        detail: "invalid JSON",
      });
      return;
    }
    const parsed = parseWorkspace(data);
    if (!parsed.ok) {
      void message.open({ type: "error", content: t("workspace.importFailed") });
      appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: parsed.error.userMessageKey ?? "workspace.importFailed",
        params: { detail: parsed.error.code },
        detail: parsed.error.code,
      });
      return;
    }
    // 导入前仅展示预览，不替换工作区（替换在预览确认后）。
    setWorkspaceImportDraft({
      workspace: parsed.value,
      preview: summarizeImport(parsed.value),
    });
  };

  const handleImportWorkspace = (): void => {
    if (host === null || host === undefined) return;
    if (host.capabilities.workspaceImport === "file") {
      // 桌面端：经 HostMessage open-text-file 弹系统打开对话框读取。
      void host
        .openTextFile({ suggestedName: "mamep-workspace.json" })
        .then((result) => {
          if (result.ok) {
            if (result.value.content === null) {
              void message.open({
                type: "info",
                content: t("workspace.importCancelled"),
              });
            } else {
              handleImportedText(result.value.content);
            }
          } else {
            void message.open({
              type: "error",
              content: t("workspace.importFailed"),
            });
            appendMessage({
              timestamp: Date.now(),
              level: "error",
              messageKey:
                result.error.userMessageKey ?? "workspace.importFailed",
              params: { detail: result.error.code },
              detail: result.error.code,
            });
          }
        });
    } else if (host.capabilities.workspaceImport === "upload") {
      // 浏览器端：客户端文件选择读取（浏览器原生能力，不走 HostMessage）。
      importFileInputRef.current?.click();
    }
  };

  const handleExportWorkspace = (): void => {
    if (host === null || host === undefined) return;
    // 导出使用当前最新工作区（点击时读取，不订阅以避免行数据更新触发级联重渲染）。
    const workspace = useAppStore.getState().workspace;
    const content = serializeWorkspace(workspace);
    void host
      .saveTextFile({
        suggestedName: workspaceExportFileName(workspace.name),
        content,
        mimeType: "application/json",
      })
      .then((result) => {
        if (result.ok) {
          if (result.value.saved) {
            void message.open({
              type: "success",
              content: t("workspace.exportSuccess"),
            });
          } else {
            void message.open({
              type: "info",
              content: t("workspace.exportCancelled"),
            });
          }
        } else {
          void message.open({
            type: "error",
            content: t("workspace.exportFailed"),
          });
          appendMessage({
            timestamp: Date.now(),
            level: "error",
            messageKey:
              result.error.userMessageKey ?? "workspace.exportFailed",
            params: { detail: result.error.code },
            detail: result.error.code,
          });
        }
      });
  };

  const handleImportFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    // 重置 input.value：允许同一文件重复导入（onChange 需要变化触发）。
    event.target.value = "";
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        handleImportedText(reader.result);
      }
    };
    reader.onerror = () => {
      void message.open({ type: "error", content: t("workspace.importFailed") });
    };
    reader.readAsText(file, "utf-8");
  };

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
