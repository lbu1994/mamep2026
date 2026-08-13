/**
 * 平台能力矩阵（docs/TECH_DESIGN.md §7）。
 * 平台不支持的能力必须明确声明；UI 不得通过捕获运行时异常判断能力。
 */
export type SerialPortCapability =
  "browser-picker" | "enumerated" | "unsupported";
export type FilesystemCapability = "limited" | "full" | "unsupported";

export interface PlatformCapabilities {
  readonly modbusRtu: boolean;
  readonly modbusTcp: boolean;
  readonly serialPorts: SerialPortCapability;
  readonly filesystem: FilesystemCapability;
  readonly nodePlugins: boolean;
  readonly webPlugins: boolean;
}

/** 浏览器端能力：RTU 支持、TCP 不支持、串口走浏览器授权、无 Node.js 插件。 */
export const browserCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: false,
  serialPorts: "browser-picker",
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
});
