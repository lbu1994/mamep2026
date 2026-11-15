/**
 * WorkspaceFileActions 导入/导出交互测试（jsdom）。
 * 组件用 App.useApp()（antd message），渲染必须包 <AntApp>（与 BottomPanel 测试同模式，
 * 用 fireEvent + @testing-library/waitFor 断言异步 message）。
 * 覆盖：导出调用 saveTextFile（序列化 + 建议文件名）、成功/取消/失败提示；
 * 导入 file 能力（openTextFile）与 upload 能力（隐藏 input）两条路径；坏文件不破坏当前工作区。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import {
  createEmptyWorkspace,
  type PlatformCapabilities,
} from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import type { AppHost } from "../host";
import { WorkspaceFileActions } from "./WorkspaceFileActions";

function makeHost(caps: Partial<PlatformCapabilities> = {}): AppHost {
  const capabilities = {
    modbusRtu: true,
    modbusTcp: false,
    serialPorts: "browser-picker" as const,
    filesystem: "limited" as const,
    nodePlugins: false,
    webPlugins: true,
    logExport: "download" as const,
    workspaceImport: "upload" as const,
    workspaceExport: "download" as const,
    ...caps,
  };
  return {
    capabilities,
    saveTextFile: vi.fn(async () => ({
      ok: true as const,
      value: { saved: true, filePath: null },
    })),
    openTextFile: vi.fn(async () => ({
      ok: true as const,
      value: { content: null },
    })),
  } as unknown as AppHost;
}

/** 构造一个合法的工作区交换 JSON（经 serializeWorkspace，与真实导出路径一致）。 */
function validWorkspaceJson(name: string): string {
  const ws = createEmptyWorkspace();
  ws.name = name;
  return serializeWorkspace(ws);
}

function renderActions(): void {
  render(
    <AntApp>
      <WorkspaceFileActions />
    </AntApp>,
  );
}

function draftName(): string | undefined {
  return useAppStore.getState().workspaceImportDraft?.preview.name;
}

beforeEach(() => {
  initI18n();
  useAppStore.setState({
    host: makeHost(),
    workspace: createEmptyWorkspace(),
    workspaceImportDraft: null,
    loaded: true,
  });
});

describe("WorkspaceFileActions 导出", () => {
  it("导出调用 saveTextFile（序列化 + mamep-workspace-<name> 文件名 + application/json）", async () => {
    const ws = createEmptyWorkspace();
    ws.name = "My Workspace";
    useAppStore.setState({ workspace: ws });
    const host = useAppStore.getState().host as AppHost;
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Export Workspace" }));
    await waitFor(() => {
      expect(host.saveTextFile).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(host.saveTextFile).mock.calls[0]?.[0] as {
      suggestedName: string;
      content: string;
      mimeType: string;
    };
    expect(call.suggestedName).toMatch(
      /^mamep-workspace-My Workspace-\d{8}-\d{6}\.json$/,
    );
    expect(call.mimeType).toBe("application/json");
    expect(JSON.parse(call.content).schemaVersion).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(screen.getByText("Workspace exported.")).toBeTruthy();
    });
  });

  it("导出用户取消（saved:false）提示已取消而非错误", async () => {
    const host = makeHost();
    (
      host.saveTextFile as unknown as {
        mockResolvedValue: (v: unknown) => void;
      }
    ).mockResolvedValue({
      ok: true as const,
      value: { saved: false, filePath: null },
    });
    useAppStore.setState({ host });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Export Workspace" }));
    await waitFor(() => {
      expect(screen.getByText("Export cancelled.")).toBeTruthy();
    });
  });

  it("导出失败提示错误", async () => {
    const host = makeHost();
    (
      host.saveTextFile as unknown as {
        mockResolvedValue: (v: unknown) => void;
      }
    ).mockResolvedValue({
      ok: false as const,
      error: {
        code: "SAVE_TEXT_FILE_FAILED",
        category: "persistence",
        severity: "error",
        retryable: false,
        userMessageKey: "workspace.exportFailed",
        technicalMessage: "boom",
      },
    });
    useAppStore.setState({ host });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Export Workspace" }));
    await waitFor(() => {
      expect(screen.getByText("Export failed.")).toBeTruthy();
    });
  });
});

describe("WorkspaceFileActions 导入（file 能力，桌面端）", () => {
  it("经 openTextFile 读取文本并置入导入草稿", async () => {
    const host = makeHost({ workspaceImport: "file" });
    (
      host.openTextFile as unknown as {
        mockResolvedValue: (v: unknown) => void;
      }
    ).mockResolvedValue({
      ok: true as const,
      value: { content: validWorkspaceJson("Imported") },
    });
    useAppStore.setState({ host });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Import Workspace" }));
    await waitFor(() => {
      expect(host.openTextFile).toHaveBeenCalledWith({
        suggestedName: "mamep-workspace.json",
      });
    });
    await waitFor(() => {
      expect(draftName()).toBe("Imported");
    });
    // 预览阶段不替换工作区。
    expect(useAppStore.getState().workspace.name).not.toBe("Imported");
  });

  it("openTextFile 用户取消（content:null）提示已取消且不置草稿", async () => {
    const host = makeHost({ workspaceImport: "file" });
    useAppStore.setState({ host });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Import Workspace" }));
    await waitFor(() => {
      expect(screen.getByText("Import cancelled.")).toBeTruthy();
    });
    expect(useAppStore.getState().workspaceImportDraft).toBeNull();
  });
});

describe("WorkspaceFileActions 能力不支持（如 Android Phase 4 接入文件选择前）", () => {
  it("导入能力 unsupported：给出能力提示，不调 openTextFile、不置草稿（不静默无操作）", async () => {
    const host = makeHost({ workspaceImport: "unsupported" });
    useAppStore.setState({ host });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Import Workspace" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Importing a workspace file is not supported in this environment.",
        ),
      ).toBeTruthy();
    });
    expect(host.openTextFile).not.toHaveBeenCalled();
    expect(useAppStore.getState().workspaceImportDraft).toBeNull();
  });

  it("导出能力 unsupported：给出能力提示，不调 saveTextFile", async () => {
    const host = makeHost({ workspaceExport: "unsupported" });
    useAppStore.setState({ host });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Export Workspace" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Exporting a workspace file is not supported in this environment.",
        ),
      ).toBeTruthy();
    });
    expect(host.saveTextFile).not.toHaveBeenCalled();
  });
});

describe("WorkspaceFileActions 导入（upload 能力，浏览器端）", () => {
  function selectFile(file: File): void {
    const input = document.querySelector<HTMLInputElement>(
      'input[data-testid="workspace-import-file"]',
    );
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input as HTMLInputElement);
  }

  it("隐藏文件选择读取文本并置入导入草稿", async () => {
    const file = new File([validWorkspaceJson("Uploaded")], "upload.json", {
      type: "application/json",
    });
    renderActions();
    selectFile(file);
    await waitFor(() => {
      expect(draftName()).toBe("Uploaded");
    });
  });

  it("坏文件（非法 JSON）报错且不置草稿、不破坏当前工作区", async () => {
    const before = useAppStore.getState().workspace;
    const file = new File(["not-json{{{"], "bad.json", {
      type: "application/json",
    });
    renderActions();
    selectFile(file);
    await waitFor(() => {
      expect(useAppStore.getState().workspaceImportDraft).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText("Import failed.")).toBeTruthy();
    });
    expect(useAppStore.getState().workspace).toBe(before);
  });
});
