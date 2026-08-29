/**
 * 平台能力矩阵（docs/TECH_DESIGN.md §7）。
 * 平台不支持的能力必须明确声明；UI 不得通过捕获运行时异常判断能力。
 */
export type SerialPortCapability =
  "browser-picker" | "enumerated" | "unsupported";
/** 文件持久化能力（2026-08-30，ADR-036）：limited=受限（浏览器 IndexedDB / 客户端文件选择）、
 * full=主进程应用数据目录版本化 JSON 文件仓储（Electron）、unsupported=不支持（VSCode 骨架）。 */
export type FilesystemCapability = "limited" | "full" | "unsupported";
/** 通信日志 CSV 导出的落盘方式（2026-08-28，PRD §8.3 P1）：download=浏览器 Blob 下载、save-dialog=桌面端保存对话框、unsupported=不支持。 */
export type LogExportCapability = "download" | "save-dialog" | "unsupported";
/** 工作区导入的文件来源（2026-08-29，PRD §8.3 P1）：file=桌面端文件对话框读取（Electron/VSCode）、upload=浏览器端文件选择后客户端读取、unsupported=不支持。 */
export type WorkspaceImportCapability = "file" | "upload" | "unsupported";
/** 工作区导出的落盘方式（2026-08-29，PRD §8.3 P1）：download=浏览器 Blob 下载、save-dialog=桌面端保存对话框、unsupported=不支持。 */
export type WorkspaceExportCapability = "save-dialog" | "download" | "unsupported";

export interface PlatformCapabilities {
  readonly modbusRtu: boolean;
  readonly modbusTcp: boolean;
  readonly serialPorts: SerialPortCapability;
  readonly filesystem: FilesystemCapability;
  readonly nodePlugins: boolean;
  readonly webPlugins: boolean;
  readonly logExport: LogExportCapability;
  readonly workspaceImport: WorkspaceImportCapability;
  readonly workspaceExport: WorkspaceExportCapability;
}

/** 浏览器端能力：RTU 支持、TCP 不支持、串口走浏览器授权、无 Node.js 插件；
 * 日志导出走浏览器 Blob 下载（logExport: "download"）；
 * 工作区导入走客户端文件选择（workspaceImport: "upload"）、导出走 Blob 下载（workspaceExport: "download"）。 */
export const browserCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: false,
  serialPorts: "browser-picker",
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
  logExport: "download",
  workspaceImport: "upload",
  workspaceExport: "download",
});
