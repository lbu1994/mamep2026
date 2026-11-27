import type { Workspace, WorkspaceRecoveryInfo } from "@mamep2026/domain";

/** Summarize a validated backup without exposing its register values. */
export function recoveryPreview(
  workspace: Workspace,
): NonNullable<WorkspaceRecoveryInfo["preview"]> {
  return {
    name: workspace.name,
    sheets: workspace.sheets.length,
    rows: workspace.sheets.reduce(
      (count, sheet) => count + sheet.rows.length,
      0,
    ),
    connections: workspace.connectionProfiles.length,
    schemaVersion: workspace.schemaVersion,
  };
}
