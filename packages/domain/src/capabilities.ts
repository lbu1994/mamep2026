/**
 * 平台能力矩阵（docs/TECH_DESIGN.md §7）。
 * 平台不支持的能力必须明确声明；UI 不得通过捕获运行时异常判断能力。
 */
export type SerialPortCapability =
  "browser-picker" | "enumerated" | "unsupported";
/** 文件持久化能力：limited=受限（浏览器 IndexedDB / 客户端文件选择）、
 * full=主进程应用数据目录版本化 JSON 文件仓储（Electron）、unsupported=不支持（VSCode 骨架）。 */
export type FilesystemCapability = "limited" | "full" | "unsupported";
/** 通信日志 CSV 导出的落盘方式（PRD §8.3 P1）：download=浏览器 Blob 下载、save-dialog=桌面端保存对话框、unsupported=不支持。 */
export type LogExportCapability = "download" | "save-dialog" | "unsupported";
/** 工作区导入的文件来源（PRD §8.3 P1）：file=桌面端文件对话框读取（Electron/VSCode）、upload=浏览器端文件选择后客户端读取、unsupported=不支持。 */
export type WorkspaceImportCapability = "file" | "upload" | "unsupported";
/** 工作区导出的落盘方式（PRD §8.3 P1）：download=浏览器 Blob 下载、save-dialog=桌面端保存对话框、unsupported=不支持。 */
export type WorkspaceExportCapability =
  "save-dialog" | "download" | "unsupported";
/** 插件安装的文件来源（PRD §8.3 P1）：upload=浏览器端文件选择后客户端读取、file=桌面端文件对话框读取（Electron/VSCode）、unsupported=不支持。 */
export type PluginInstallCapability = "file" | "upload" | "unsupported";

export interface PlatformCapabilities {
  readonly modbusRtu: boolean;
  readonly modbusTcp: boolean;
  readonly serialPorts: SerialPortCapability;
  readonly filesystem: FilesystemCapability;
  /** 系统剪贴板 API 是否装配；运行时权限失败仍由调用结果表达。 */
  readonly clipboard: boolean;
  readonly nodePlugins: boolean;
  readonly webPlugins: boolean;
  readonly logExport: LogExportCapability;
  readonly workspaceImport: WorkspaceImportCapability;
  readonly workspaceExport: WorkspaceExportCapability;
  /** 插件安装入口的文件来源（PRD §8.3 P1）。 */
  readonly pluginInstall: PluginInstallCapability;
  /** 可执行插件（Web/WASM 插件代码执行）。 */
  readonly executablePlugins: boolean;
  /** Host 插件（Node 主进程 / Extension Host 执行）；浏览器与 Android 为 false。 */
  readonly hostPlugins: boolean;
  /** 应用前后台生命周期桥（轮询/Trace 暂停与恢复）。 */
  readonly backgroundLifecycle: boolean;
  /** 持续通信期间保持屏幕常亮。 */
  readonly keepAwake: boolean;
  /** 硬件返回键订阅（移动端）。 */
  readonly hardwareBack: boolean;
  /** 已注册协议扩展 ID（如 ["yaskawa-memobus"]）。 */
  readonly protocolExtensions: readonly string[];
  /** 已注册表类型 ID（含核心 "holding-register"）。 */
  readonly tableTypes: readonly string[];
}

/** 浏览器端能力：RTU 支持、TCP 不支持、串口走浏览器授权、无 Node.js 插件；
 * 日志导出走浏览器 Blob 下载（logExport: "download"）；
 * 工作区导入走客户端文件选择（workspaceImport: "upload"）、导出走 Blob 下载（workspaceExport: "download"）；
 * 插件安装走客户端文件选择（pluginInstall: "upload"）；
 * 可执行插件/表类型如实声明（executablePlugins=true；
 * hostPlugins 维持 false（浏览器不加载 Host 插件，TECH_DESIGN §23.2）。
 * 插件一律由用户手动安装，故协议扩展 / 表类型此处仅列**核心**值；
 * 插件贡献由各 Host 读取注册表后经 `deriveCapabilities` 叠加（能力矩阵仍如实声明）。 */
export const browserCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: false,
  serialPorts: "browser-picker",
  filesystem: "limited",
  clipboard: true,
  nodePlugins: false,
  webPlugins: true,
  logExport: "download",
  workspaceImport: "upload",
  workspaceExport: "download",
  pluginInstall: "upload",
  executablePlugins: true,
  hostPlugins: false,
  backgroundLifecycle: true,
  keepAwake: false,
  hardwareBack: false,
  // 协议扩展 / 表类型：仅列核心能力；插件贡献由 Host 经 deriveCapabilities 叠加。
  protocolExtensions: [
    // 基础表 codec：coil/discrete-input/input-register，RTU 承载（核心能力）。
    "modbus-basic-tables:coil",
    "modbus-basic-tables:discrete-input",
    "modbus-basic-tables:input-register",
  ],
  tableTypes: ["holding-register", "coil", "discrete-input", "input-register"],
});
