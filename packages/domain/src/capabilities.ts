/**
 * 平台能力矩阵（docs/TECH_DESIGN.md §7）。
 * 平台不支持的能力必须明确声明；UI 不得通过捕获运行时异常判断能力。
 */
export type SerialPortCapability =
  "browser-picker" | "enumerated" | "unsupported";
export type FilesystemCapability = "limited" | "full" | "unsupported";
/** 外部连接对象配置文件（ADR-023）的加载方式：file=读文件（Electron/VSCode）、import=导入/URL（浏览器）、unsupported=不支持。 */
export type ConnectionConfigCapability = "file" | "import" | "unsupported";
/** 通信日志 CSV 导出的落盘方式（2026-08-28，PRD §8.3 P1）：download=浏览器 Blob 下载、save-dialog=桌面端保存对话框、unsupported=不支持。 */
export type LogExportCapability = "download" | "save-dialog" | "unsupported";

export interface PlatformCapabilities {
  readonly modbusRtu: boolean;
  readonly modbusTcp: boolean;
  readonly serialPorts: SerialPortCapability;
  readonly filesystem: FilesystemCapability;
  readonly nodePlugins: boolean;
  readonly webPlugins: boolean;
  readonly connectionConfig: ConnectionConfigCapability;
  readonly logExport: LogExportCapability;
}

/** 浏览器端能力：RTU 支持、TCP 不支持、串口走浏览器授权、无 Node.js 插件；
 * 外部连接配置走「导入 JSON / URL 参数」（浏览器无文件系统，ADR-023）；
 * 日志导出走浏览器 Blob 下载（logExport: "download"）。 */
export const browserCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: false,
  serialPorts: "browser-picker",
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
  connectionConfig: "import",
  logExport: "download",
});
