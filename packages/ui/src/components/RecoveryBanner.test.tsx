/**
 * RecoveryBanner（PRD §8.3 / TECH_DESIGN §19.7）。
 * 仅测试渲染三态；纯信息、无按钮。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { initI18n } from "../i18n";
import {
  createEmptyWorkspace,
  ok,
  fail,
  createMamepError,
} from "@mamep2026/domain";
import type { WorkspaceRecoveryInfo } from "@mamep2026/domain";
import { useAppStore } from "../app-store";
import { makeHost } from "../test/make-app-host";
import { RecoveryBanner } from "./RecoveryBanner";

beforeEach(() => {
  initI18n();
});

describe("RecoveryBanner", () => {
  it("source=none（正常恢复）：不渲染", () => {
    const { container } = render(
      <RecoveryBanner
        recovery={{
          recovered: false,
          source: "none",
          recoveredAt: 1000,
          backupTimestamp: null,
          errorCode: null,
        }}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("recovery=null：不渲染", () => {
    const { container } = render(<RecoveryBanner recovery={null} />);
    expect(container.textContent).toBe("");
  });

  it("source=backup：渲染「从备份恢复」提示（含时间）", () => {
    render(
      <RecoveryBanner
        recovery={{
          recovered: true,
          source: "backup",
          recoveredAt: new Date("2026-09-04T00:00:00Z").getTime(),
          backupTimestamp: 900,
          errorCode: null,
        }}
      />,
    );
    expect(screen.getByTestId("recovery-banner")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "recovered from backup",
    );
  });

  it("source=fresh：渲染「恢复失败重置为空」提示", () => {
    render(
      <RecoveryBanner
        recovery={{
          recovered: true,
          source: "fresh",
          recoveredAt: 1000,
          backupTimestamp: null,
          errorCode: "WORKSPACE_SCHEMA_INVALID",
        }}
      />,
    );
    expect(screen.getByTestId("recovery-banner")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("restore failed");
  });
  it("previews and cancels without restoring; exports before explicit confirmation", async () => {
    const workspace = { ...createEmptyWorkspace(), name: "Recovered backup" };
    const recovery: WorkspaceRecoveryInfo = {
      recovered: true,
      pending: true,
      source: "fresh",
      recoveredAt: 1000,
      backupTimestamp: null,
      errorCode: null,
      archiveId: "archive",
      preview: {
        name: workspace.name,
        sheets: 1,
        rows: 50,
        connections: 0,
        schemaVersion: workspace.schemaVersion,
      },
    };
    const recoverWorkspace = vi.fn(async () => ok(workspace));
    const exportWorkspaceRecovery = vi.fn(async () =>
      ok("original bytes envelope"),
    );
    const saveTextFile = vi.fn(async () =>
      ok({ saved: false, filePath: null }),
    );
    const host = {
      ...makeHost().host,
      recoverWorkspace,
      exportWorkspaceRecovery,
      saveTextFile,
      getWorkspaceRecoveryInfo: () => ({
        ...recovery,
        pending: false,
        source: "backup" as const,
      }),
    };
    useAppStore.setState({ host });
    render(<RecoveryBanner recovery={recovery} />);
    fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
    expect(screen.getByText("Recovered backup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(recoverWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Export original data" }),
    );
    await waitFor(() =>
      expect(saveTextFile).toHaveBeenCalledWith(
        expect.objectContaining({ content: "original bytes envelope" }),
      ),
    );
    expect(recoverWorkspace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /Restore this backup/ })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Restore this backup/ }),
    );
    await waitFor(() =>
      expect(useAppStore.getState().workspace.name).toBe("Recovered backup"),
    );
    expect(recoverWorkspace).toHaveBeenCalledTimes(1);
  });

  it("retains the live workspace and shows the error when restore fails", async () => {
    const before = useAppStore.getState().workspace;
    const recovery: WorkspaceRecoveryInfo = {
      recovered: true,
      pending: true,
      source: "fresh",
      recoveredAt: 1000,
      backupTimestamp: null,
      errorCode: null,
      archiveId: "archive",
      preview: {
        name: "Backup",
        sheets: 1,
        rows: 1,
        connections: 0,
        schemaVersion: 10,
      },
    };
    useAppStore.setState({
      host: {
        ...makeHost().host,
        getWorkspaceRecoveryInfo: () => recovery,
        recoverWorkspace: async () =>
          fail(
            createMamepError({
              code: "PERSISTENCE_RECOVERY_FAILED",
              category: "persistence",
              userMessageKey: "errors.persistenceError",
              technicalMessage: "Disk full",
            }),
          ),
      },
    });
    render(<RecoveryBanner recovery={recovery} />);
    fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Restore this backup/ }),
    );
    await screen.findByText(
      "Recovery action failed: PERSISTENCE_RECOVERY_FAILED",
    );
    expect(useAppStore.getState().workspace).toBe(before);
    expect(useAppStore.getState().workspaceRecovery?.pending).toBe(true);
  });

  it("disables restore when archiving failed or no valid backup exists", () => {
    render(
      <RecoveryBanner
        recovery={{
          recovered: true,
          pending: true,
          source: "fresh",
          recoveredAt: 1000,
          backupTimestamp: null,
          errorCode: "PERSISTENCE_RECOVERY_PREPARE_FAILED",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review recovery" }));
    expect(
      screen
        .getByRole("button", { name: /Restore this backup/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/No valid backup/)).toBeTruthy();
  });
});
