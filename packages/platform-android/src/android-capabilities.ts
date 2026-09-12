/**
 * Android 平台能力矩阵（ADR-050 §6）。
 *
 * **如实声明**（docs/AGENTS.md §8.4）：
 * - Phase 1（2026-09-10）：仅 Modbus TCP；
 * - Phase 2（2026-09-10）：追加 USB-RS485（USB Host + 枚举 + 授权 + detach），
 *   故 `modbusRtu:true` / `serialPorts:"enumerated"`。真机 USB 闭环验证状态见
 *   docs/adr-050-验证记录.md（用户自行实机测试，代码侧已完整实现）。
 *
 * 放在平台层（而非 domain）与 `electronCapabilities` / `vscodeCapabilities` 一致：能力常量随各端装配声明。
 */
import type { PlatformCapabilities } from "@mamep2026/domain";

export const androidCapabilities: PlatformCapabilities = Object.freeze({
  // Phase 2（USB-RS485）已落地（2026-09-10）。
  modbusRtu: true,
  modbusTcp: true,
  // USB Host 枚举（下拉选择，ADR-050 Phase 2）。
  serialPorts: "enumerated",
  // WebView 原生支持 IndexedDB（与浏览器端同路径），文件通道属 Phase 4。
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
  // 文件导出/导入/插件安装入口属 Phase 4（Capacitor Filesystem + SAF/分享）。
  logExport: "unsupported",
  workspaceImport: "unsupported",
  workspaceExport: "unsupported",
  pluginInstall: "unsupported",
  // 第三方脚本插件（Blob Worker）待 WebView 版本门控后另行确认（Phase 5）。
  executablePlugins: false,
  hostPlugins: false,
  // 与共享 UI 同源（同一份 web 产物）：此处仅列**核心**协议扩展/表类型；插件贡献
  // （安川 / 自定义功能码等）由 Host 读取注册表后经 deriveCapabilities 叠加（ADR-054）。
  protocolExtensions: [
    "modbus-basic-tables:coil",
    "modbus-basic-tables:discrete-input",
    "modbus-basic-tables:input-register",
  ],
  tableTypes: [
    "holding-register",
    "coil",
    "discrete-input",
    "input-register",
  ],
});
