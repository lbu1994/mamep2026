/**
 * 工作区导入/导出逻辑（键盘快捷键复用）。
 * WorkspaceFileActions（Settings 弹窗按钮）与 AppShortcutLayer（Ctrl+Shift+S 导出 /
 * Ctrl+Alt+O 导入）共用同一 hook，避免两处复制。
 * 要求调用方位于 antd <App> context 内（App.useApp() 的 message）。
 *
 * - 导出：serializeWorkspace（packages/workspace 纯函数）→ host.saveTextFile 落盘/下载；
 * - 导入：桌面端（workspaceImport === "file"）经 host.openTextFile 系统对话框读取；
 *   浏览器端（"upload"）隐藏 <input type="file"> 客户端读取（浏览器原生能力，不走 HostMessage）；
 *   读取文本 → 可取消 Worker 解析（含 JSON/迁移/Schema 校验）→ 成功置
 *   workspaceImportDraft（预览 Modal 确认）；
 *   失败 message + 底部消息，当前工作区不被破坏。
 */
import { useRef } from "react";
import { App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import type { Result, Workspace } from "@mamep2026/domain";
import { useAppStore, type WorkspaceImportPreview } from "./app-store";
import { loadWorkspaceImportModalModule } from "./overlay-modules";

let workspaceTransferModule:
  Promise<typeof import("@mamep2026/workspace")> | undefined;

interface WorkspaceImportJob {
  readonly controller: AbortController;
  reader: FileReader | null;
}

let activeImportJob: WorkspaceImportJob | null = null;

function beginWorkspaceImport(): WorkspaceImportJob {
  if (activeImportJob !== null) {
    activeImportJob.controller.abort();
    activeImportJob.reader?.abort();
  }
  const job: WorkspaceImportJob = {
    controller: new AbortController(),
    reader: null,
  };
  activeImportJob = job;
  return job;
}

function finishWorkspaceImport(job: WorkspaceImportJob): void {
  if (activeImportJob === job) activeImportJob = null;
}

function isCurrentImport(job: WorkspaceImportJob): boolean {
  return activeImportJob === job && !job.controller.signal.aborted;
}

/** 取消仍在读取/解析的导入；已经展示的草稿由 Modal 的取消按钮单独清除。 */
export function cancelWorkspaceImportPreparation(): void {
  if (activeImportJob === null) return;
  activeImportJob.controller.abort();
  activeImportJob.reader?.abort();
  activeImportJob = null;
}

function loadWorkspaceTransferModule(): Promise<
  typeof import("@mamep2026/workspace")
> {
  workspaceTransferModule ??= import("@mamep2026/workspace");
  return workspaceTransferModule;
}

export interface WorkspaceTransfer {
  handleExportWorkspace: () => void;
  handleImportWorkspace: () => void;
  handleImportFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useWorkspaceTransfer(): WorkspaceTransfer {
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

  const handleImportedText = async (
    text: string,
    job: WorkspaceImportJob,
  ): Promise<void> => {
    if (!isCurrentImport(job)) return;
    const parser = useAppStore.getState().workspaceImportParser;
    let parsed: Result<Workspace>;
    try {
      if (parser !== null) {
        parsed = await parser(text, job.controller.signal);
      } else {
        // UI 单测/无组合根注回退：行为与旧路径一致；生产由 Worker 解析器接管。
        const workspaceModule = await loadWorkspaceTransferModule();
        parsed = workspaceModule.parseWorkspace(JSON.parse(text));
      }
    } catch (error) {
      if (!isCurrentImport(job)) return;
      void message.open({
        type: "error",
        content: t("workspace.importFailed"),
      });
      appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: "workspace.importFailed",
        detail: error instanceof Error ? error.message : String(error),
      });
      finishWorkspaceImport(job);
      return;
    }
    if (!isCurrentImport(job)) return;
    if (!parsed.ok) {
      if (parsed.error.code === "WORKSPACE_PARSE_ABORTED") {
        finishWorkspaceImport(job);
        return;
      }
      void message.open({
        type: "error",
        content: t("workspace.importFailed"),
      });
      appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: parsed.error.userMessageKey ?? "workspace.importFailed",
        params: { detail: parsed.error.code },
        detail: parsed.error.code,
      });
      finishWorkspaceImport(job);
      return;
    }
    // 导入前仅展示预览，不替换工作区（替换在预览确认后）。
    setWorkspaceImportDraft({
      workspace: parsed.value,
      preview: summarizeImport(parsed.value),
    });
    void loadWorkspaceImportModalModule();
    finishWorkspaceImport(job);
  };

  const handleImportWorkspace = (): void => {
    if (host === null || host === undefined) return;
    if (host.capabilities.workspaceImport === "file") {
      const job = beginWorkspaceImport();
      void loadWorkspaceImportModalModule();
      // 桌面端：经 HostMessage open-text-file 弹系统打开对话框读取。
      void host
        .openTextFile({ suggestedName: "mamep-workspace.json" })
        .then((result) => {
          if (!isCurrentImport(job)) return;
          if (result.ok) {
            if (result.value.content === null) {
              finishWorkspaceImport(job);
              void message.open({
                type: "info",
                content: t("workspace.importCancelled"),
              });
            } else {
              void handleImportedText(result.value.content, job);
            }
          } else {
            finishWorkspaceImport(job);
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
        })
        .catch((error: unknown) => {
          if (!isCurrentImport(job)) return;
          finishWorkspaceImport(job);
          void message.open({
            type: "error",
            content: t("workspace.importFailed"),
          });
          appendMessage({
            timestamp: Date.now(),
            level: "error",
            messageKey: "workspace.importFailed",
            detail: error instanceof Error ? error.message : String(error),
          });
        });
    } else if (host.capabilities.workspaceImport === "upload") {
      const job = beginWorkspaceImport();
      void loadWorkspaceImportModalModule();
      // 浏览器端：客户端文件选择读取（浏览器原生能力，不走 HostMessage）。
      const input = importFileInputRef.current;
      if (input === null) {
        finishWorkspaceImport(job);
        return;
      }
      input.click();
    } else {
      // 能力不支持（如 Android 在接入 SAF / 文件选择前）：**必须给出反馈**，
      // 否则用户点了按钮毫无反应（静默无操作会被当成 bug 实测）。
      void message.open({
        type: "warning",
        content: t("errors.workspaceImportUnsupported"),
      });
    }
  };

  const handleExportWorkspace = (): void => {
    if (host === null || host === undefined) return;
    if (host.capabilities.workspaceExport === "unsupported") {
      // 同上：能力不支持时给提示，不做静默无操作。
      void message.open({
        type: "warning",
        content: t("errors.workspaceExportUnsupported"),
      });
      return;
    }
    void loadWorkspaceTransferModule()
      .then(({ serializeWorkspace, workspaceExportFileName }) => {
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
              return;
            }
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
          });
      })
      .catch(() => {
        void message.open({
          type: "error",
          content: t("workspace.exportFailed"),
        });
      });
  };

  const handleImportFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    // 重置 input.value：允许同一文件重复导入（onChange 需要变化触发）。
    event.target.value = "";
    if (file === undefined) return;
    const job =
      activeImportJob !== null && !activeImportJob.controller.signal.aborted
        ? activeImportJob
        : beginWorkspaceImport();
    const reader = new FileReader();
    job.reader = reader;
    reader.onload = () => {
      if (isCurrentImport(job) && typeof reader.result === "string") {
        void handleImportedText(reader.result, job);
      }
    };
    reader.onerror = () => {
      if (!isCurrentImport(job)) return;
      finishWorkspaceImport(job);
      void message.open({
        type: "error",
        content: t("workspace.importFailed"),
      });
    };
    reader.readAsText(file, "utf-8");
  };

  return {
    handleExportWorkspace,
    handleImportWorkspace,
    handleImportFileChange,
    importFileInputRef,
  };
}
