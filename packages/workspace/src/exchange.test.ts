/**
 * 工作区公开交换格式辅助测试（2026-08-29，PRD §8.3 P1）。
 */
import { describe, expect, it } from "vitest";
import {
  sanitizeWorkspaceNameForFile,
  workspaceExportFileName,
} from "./exchange";

describe("sanitizeWorkspaceNameForFile", () => {
  it("replaces illegal filename characters and collapses whitespace", () => {
    expect(sanitizeWorkspaceNameForFile('a<b>:"c/d\\e|f?g*h')).toBe("abcdefgh");
  });

  it("trims surrounding whitespace and control characters", () => {
    expect(sanitizeWorkspaceNameForFile("  My\u0000Workspace  ")).toBe(
      "MyWorkspace",
    );
  });

  it("falls back to 'workspace' when the name is empty or only illegal chars", () => {
    expect(sanitizeWorkspaceNameForFile("")).toBe("workspace");
    expect(sanitizeWorkspaceNameForFile('<>:"/\\|?*')).toBe("workspace");
  });

  it("truncates over-long names to 64 chars", () => {
    const long = "x".repeat(200);
    expect(sanitizeWorkspaceNameForFile(long)).toHaveLength(64);
  });
});

describe("workspaceExportFileName", () => {
  const now = new Date(2026, 7, 29, 10, 20, 30).getTime(); // 2026-08-29 10:20:30

  it("builds mamep-workspace-<name>-<timestamp>.json", () => {
    expect(workspaceExportFileName("My Workspace", now)).toBe(
      "mamep-workspace-My Workspace-20260829-102030.json",
    );
  });

  it("sanitizes the name inside the file name", () => {
    expect(workspaceExportFileName("a/b", now)).toBe(
      "mamep-workspace-ab-20260829-102030.json",
    );
    expect(workspaceExportFileName("", now)).toBe(
      "mamep-workspace-workspace-20260829-102030.json",
    );
  });

  it("pads month/day/hour/minute/second to two digits", () => {
    const early = new Date(2026, 0, 5, 9, 7, 3).getTime();
    expect(workspaceExportFileName("W", early)).toBe(
      "mamep-workspace-W-20260105-090703.json",
    );
  });
});
