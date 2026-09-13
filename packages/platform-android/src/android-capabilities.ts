/**
 * Android 平台能力矩阵（ADR-050 §6、ADR-056）。
 *
 * **如实声明**（docs/AGENTS.md §8.4）：
 * - Phase 1（2026-09-10）：仅 Modbus TCP；
 * - Phase 2（2026-09-10）：追加 USB-RS485（USB Host + 枚举 + 授权 + detach），
 *   故 `modbusRtu:true` / `serialPorts:"enumerated"`。真机 USB 闭环验证状态见
 *   docs/adr-050-验证记录.md（用户自行实机测试，代码侧已完整实现）；
 * - Phase 5（2026-09-13，ADR-056）：插件安装入口（WebView `<input type="file">` 经
 *   Capacitor `BridgeWebChromeClient.onShowFileChooser` 走系统文件选择器）与插件执行能力。
 *   **执行能力不可静态声明**——Android WebView 能力随系统 WebView 版本变化，故
 *   `executablePlugins` 由装配期运行时探测（`probePluginExecutionSupport`）决定，
 *   经 {@link resolveAndroidCapabilities} 覆盖；本常量的 `false` 是 **fail-closed 基线**
 *   （装配层未探测 / 探测失败时如实保持不可执行）。
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
  // 文件导出/导入属 Phase 4（Capacitor Filesystem + SAF/分享）。
  logExport: "unsupported",
  workspaceImport: "unsupported",
  workspaceExport: "unsupported",
  // 插件安装（Phase 5，ADR-056）：WebView 文件选择器可用（隐藏 input + 客户端读取文件文本，
  // 与浏览器端同路径，无需 Capacitor Filesystem）。
  pluginInstall: "upload",
  // 见文件头：由探针覆盖（fail-closed 基线）。
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

/**
 * 用运行时探测结果覆盖 Android 基础能力（ADR-056）。
 *
 * 目前只有 `executablePlugins` 需要运行时判定（Blob Worker + Worker 内 blob entry 动态
 * `import()` 是否可用）；探测结果必须**如实**反映，不可乐观翻转。
 */
export function resolveAndroidCapabilities(input: {
  /** Blob Worker 插件执行是否可用（`probePluginExecutionSupport()` 结果）。 */
  blobWorkerSupported: boolean;
}): PlatformCapabilities {
  return {
    ...androidCapabilities,
    executablePlugins: input.blobWorkerSupported,
  };
}

