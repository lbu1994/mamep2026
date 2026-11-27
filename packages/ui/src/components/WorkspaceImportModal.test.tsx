/**
 * WorkspaceImportModal 预览/确认测试（jsdom）。
 * 组件用 App.useApp()（antd message），渲染必须包 <AntApp>。
 * 断言：草稿摘要展示、OK 应用导入（清空草稿 + 替换工作区）、取消清除草稿、无草稿不展示。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntApp, ConfigProvider } from "antd";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyWorkspace,
} from "@mamep2026/domain";
import { initI18n } from "../i18n";
import { useAppStore } from "../app-store";
import { WorkspaceImportModal } from "./WorkspaceImportModal";
import { makeHost } from "../test/make-app-host";

function renderModal(): void {
  render(
    <ConfigProvider>
      <AntApp>
        <WorkspaceImportModal />
      </AntApp>
    </ConfigProvider>,
  );
}

describe("WorkspaceImportModal", () => {
  beforeEach(() => {
    initI18n();
    useAppStore.setState({
      host: null,
      workspace: createEmptyWorkspace(),
      workspaceImportDraft: null,
    });
  });

  it.each(["browser", "electron", "vscode", "android"] as const)(
    "warns about incompatible profiles on %s and preserves all imported values",
    async (platform) => {
      const user = userEvent.setup();
      const { host } = makeHost(
        { modbusTcp: platform !== "browser" },
        { platform },
      );
      const imported = createEmptyWorkspace();
      imported.connectionProfiles = [
        {
          ...createDefaultRtuProfile("Software flow"),
          flowControl: "xon-xoff",
        },
        { ...createDefaultTcpProfile("Remote PLC"), host: "192.168.1.42" },
      ];
      useAppStore.setState({
        host,
        workspaceImportDraft: {
          workspace: imported,
          preview: {
            name: imported.name,
            sheets: 1,
            rows: 0,
            connections: 2,
            schemaVersion: imported.schemaVersion,
          },
        },
      });
      renderModal();
      const warning = screen.queryByText(/Some connections cannot be used/);
      expect(warning !== null).toBe(
        platform === "browser" || platform === "electron",
      );
      await user.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() =>
        expect(useAppStore.getState().workspaceImportDraft).toBeNull(),
      );
      expect(useAppStore.getState().workspace.connectionProfiles).toEqual(
        imported.connectionProfiles,
      );
      expect(host.connect).not.toHaveBeenCalled();
      expect(host.connectTcp).not.toHaveBeenCalled();
    },
  );

  it("无草稿时不展示预览内容", () => {
    renderModal();
    expect(screen.queryByText("Import Workspace")).toBeNull();
  });

  it("有草稿时展示摘要与覆盖提示，确认后替换工作区并清空草稿", async () => {
    const user = userEvent.setup();
    const imported = createEmptyWorkspace();
    imported.name = "Imported Workspace";
    useAppStore.setState({
      workspaceImportDraft: {
        workspace: imported,
        preview: {
          name: "Imported Workspace",
          sheets: 1,
          rows: 2,
          connections: 1,
          schemaVersion: 4,
        },
      },
    });
    renderModal();

    // 摘要展示（工作表名 / 行数 / 格式版本）。
    expect(screen.getByText("Imported Workspace")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    // 覆盖风险提示。
    expect(screen.getByText(/replace the current workspace/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(useAppStore.getState().workspaceImportDraft).toBeNull(),
    );
    expect(useAppStore.getState().workspace.name).toBe("Imported Workspace");
  });

  it("取消仅清除草稿，不替换工作区", async () => {
    const user = userEvent.setup();
    const imported = createEmptyWorkspace();
    imported.name = "Imported Workspace";
    useAppStore.setState({
      workspaceImportDraft: {
        workspace: imported,
        preview: {
          name: "Imported Workspace",
          sheets: 1,
          rows: 0,
          connections: 1,
          schemaVersion: 4,
        },
      },
    });
    renderModal();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useAppStore.getState().workspaceImportDraft).toBeNull();
    expect(useAppStore.getState().workspace.name).not.toBe(
      "Imported Workspace",
    );
  });

  it("确认提交排队期间草稿被取消，则提交失效且不覆盖工作区", () => {
    vi.useFakeTimers();
    try {
      const before = useAppStore.getState().workspace;
      const imported = createEmptyWorkspace();
      imported.name = "Should Not Commit";
      useAppStore.setState({
        workspaceImportDraft: {
          workspace: imported,
          preview: {
            name: imported.name,
            sheets: 1,
            rows: 0,
            connections: 1,
            schemaVersion: 5,
          },
        },
      });
      renderModal();

      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      // 排队提交持有草稿引用；关闭预览（或外部取消）清除草稿后，旧提交必须 no-op。
      useAppStore.getState().setWorkspaceImportDraft(null);
      act(() => vi.runAllTimers());

      expect(useAppStore.getState().workspace).toBe(before);
      expect(useAppStore.getState().workspaceImportDraft).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
