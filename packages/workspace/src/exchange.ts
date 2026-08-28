/**
 * 工作区公开交换格式辅助（2026-08-29，PRD §8.3 P1 工作区导入和导出）。
 *
 * 交换格式 = 版本化 JSON：直接复用 workspaceSchema 的 serializeWorkspace / parseWorkspace
 * （含 v1→v4 迁移与断链检测），本模块只提供文件名等展示/落盘辅助（纯函数）。
 * 文件内容字段不得依赖界面语言（docs/AGENTS.md §26）。
 */

/** 非法文件名字符（Windows 与常见跨平台保留）：`< > : " / \ | ? *` 与控制字符。 */
// eslint-disable-next-line no-control-regex -- 控制字符必须被过滤（文件系统非法），属必要豁免。
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** 导出文件名的最大 name 段长度（超长截断，避免超出文件系统限制）。 */
const MAX_NAME_SEGMENT_LENGTH = 64;

/**
 * 清洗工作区名使其可作为文件名片段（不可用时回退 "workspace"）。
 * 仅用于导出文件名展示/落盘，不改变工作区 name 字段本身。
 */
export function sanitizeWorkspaceNameForFile(name: string): string {
  const cleaned = name
    .replace(ILLEGAL_FILENAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_SEGMENT_LENGTH);
  return cleaned.length > 0 ? cleaned : "workspace";
}

/**
 * 工作区导出文件名：`mamep-workspace-<name>-<YYYYMMDD-HHmmss>.json`。
 * name 经 sanitizeWorkspaceNameForFile 清洗（空名回退 "workspace"）。
 */
export function workspaceExportFileName(
  workspaceName: string,
  now = Date.now(),
): string {
  const name = sanitizeWorkspaceNameForFile(workspaceName);
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `mamep-workspace-${name}-${stamp}.json`;
}
