/**
 * Web Serial 最小授权（docs/adr/ADR-017：Electron MVP 复用浏览器 Web Serial 路径；
 * 2026-08-21 扩展：Electron 端串口改为下拉框选择）。
 * 与 ipc.ts 同风格的可测纯逻辑：外部能力（Session）经参数注入，单测用 fake session 验证
 * 权限判定与端口选择，不 mock electron 运行时。
 *
 * 安全取舍（MVP/开发阶段）：仅对本应用 origin 放行 serial 权限（最小授权）；
 * select-serial-port 默认不再自动选择，而是把端口列表转发给渲染进程（onPortsAvailable）、
 * 由用户在应用内下拉框选择，选择结果经安全 IPC（select-serial-port invoke）回传后再
 * callback(portId)（空串 = 用户取消）。设置 selectPort 策略则回到「自动选择」模式
 * （供测试/无人值守场景）。后续 Node Serial Adapter 落地后由主进程接管枚举/连接。
 */

/** select-serial-port 端口列表项（Electron 提供的字段子集）。 */
export interface SerialPortChoice {
  readonly portId: string;
  readonly portName?: string | undefined;
  readonly displayName?: string | undefined;
}

/** 转发给渲染进程的可序列化端口选项。 */
export interface SerialPortOption {
  readonly portId: string;
  readonly label: string;
}

/** 可注入的最小 Session 面（与 Electron Session 结构兼容；单测用 fake 替代）。 */
export interface SerialPermissionSession {
  on(
    event: "select-serial-port",
    listener: (
      event: { preventDefault(): void },
      portList: SerialPortChoice[],
      webContents: unknown,
      callback: (portId: string) => void,
    ) => void,
  ): unknown;
  setPermissionCheckHandler(
    handler:
      | ((
          webContents: unknown,
          permission: string,
          requestingOrigin: string,
          details: { securityOrigin?: string; isMainFrame: boolean },
        ) => boolean)
      | null,
  ): void;
  setDevicePermissionHandler(
    handler:
      | ((details: {
          deviceType: string;
          origin: string;
          device: unknown;
        }) => boolean)
      | null,
  ): void;
}

export interface SerialPermissionOptions {
  /** 允许 serial 权限的 origin（不含尾部斜杠）；其他 origin 一律拒绝。 */
  readonly allowedOrigins: readonly string[];
  /**
   * 端口列表可用时的通知（默认延迟选择模式）：select-serial-port 事件触发时把
   * 可序列化的端口列表转发给调用方（主进程据此发送 serial-ports-available 事件）。
   */
  readonly onPortsAvailable?: ((ports: SerialPortOption[]) => void) | undefined;
  /** 端口选择策略；设置则进入自动选择模式（不转发、不等待渲染进程）。 */
  readonly selectPort?:
    ((portList: readonly SerialPortChoice[]) => string) | undefined;
}

/** 已安装的权限处理句柄：渲染进程回传选择结果时由主进程调用。 */
export interface SerialPermissionHandlers {
  /**
   * 解析挂起的串口选择：以用户选择的 portId（空串 = 取消）调用主进程持有的
   * select-serial-port callback。仅接受与该挂起请求同源的发送者；无挂起请求返回 false。
   */
  resolvePendingSelection(portId: string, sender: unknown): boolean;
}

/** 派生允许的 origin：开发加载 dev server URL 页面；生产 loadFile（file:// 协议）。 */
export function deriveAllowedOrigins(
  isPackaged: boolean,
  devServerUrl: string | undefined,
): string[] {
  if (!isPackaged && devServerUrl !== undefined && devServerUrl.length > 0) {
    return [new URL(devServerUrl).origin];
  }
  // file:// 页面：permissionCheck 的 details.securityOrigin 为 "file:///"，\n  // devicePermission 的 details.origin 为 "file://"（Electron 官方示例）。
  return ["file://", "file:///"];
}

/**
 * 归一化 origin：仅对 http(s) 用 new URL().origin 规范化（去尾斜杠/默认端口等）。
 * 背景（2026-08-22 实测）：dev 下 permissionCheck 上报 details.securityOrigin 为
 * `http://localhost:5173/`（带尾斜杠），而 deriveAllowedOrigins 生成的是
 * `new URL().origin`（无尾斜杠），直接精确匹配会把 serial 权限误拒（刷不出串口）。
 * file://（file:///）保持原样：allowlist 已含两个变体，且 URL API 会把 file origin
 * 归为 "null"，不能走 URL 归一化。
 */
export function normalizeOrigin(
  origin: string | undefined,
): string | undefined {
  if (origin === undefined) return undefined;
  if (origin.startsWith("http://") || origin.startsWith("https://")) {
    try {
      return new URL(origin).origin;
    } catch {
      return origin;
    }
  }
  return origin;
}

/** MVP 端口选择策略：自动选第一个可用端口；无可用设备返回空串（取消请求）。 */
export function selectFirstPort(portList: readonly SerialPortChoice[]): string {
  return portList[0]?.portId ?? "";
}

/** 端口列表 → 可序列化选项（label 优先 portName，其次 displayName，最后 portId）。 */
export function toPortOptions(
  portList: readonly SerialPortChoice[],
): SerialPortOption[] {
  return portList.map((port) => ({
    portId: port.portId,
    label: port.portName ?? port.displayName ?? port.portId,
  }));
}

/**
 * 安装 Web Serial 最小授权：
 * - select-serial-port：event.preventDefault() 后默认「延迟选择」——把端口列表经
 *   onPortsAvailable 转发给渲染进程，挂起 callback 等待渲染进程经安全 IPC 回传选择
 *   （resolvePendingSelection；空串 = 取消）；设置 selectPort 则自动选择。
 * - setPermissionCheckHandler / setDevicePermissionHandler：仅对本应用 origin 放行 serial；
 * - 不注册 serial-port-added/removed（官方文档：仅选择回调挂起期间触发，本项目无实时 picker UI）。
 *
 * 注：disable-serial-blocklist 默认不启用（Modbus 常用 USB 适配器 FTDI/CH340/CP210x 不在
 * Chromium 黑名单）；如需可在 app.whenReady 前 app.commandLine.appendSwitch("disable-serial-blocklist")。
 */
export function installSerialPermissionHandlers(
  session: SerialPermissionSession,
  options: SerialPermissionOptions,
): SerialPermissionHandlers {
  const allowed = options.allowedOrigins;
  // 比较前归一化（去尾部斜杠）：dev 下 securityOrigin/origin 带尾斜杠，
  // 与 new URL().origin 生成的 allowlist 精确匹配会失败。
  const isAllowedOrigin = (origin: string | undefined): boolean => {
    const normalized = normalizeOrigin(origin);
    return normalized !== undefined && allowed.includes(normalized);
  };
  const selectPort = options.selectPort;
  // 同一时刻仅一个挂起选择（单窗口）；渲染进程重枚举前会先取消旧请求，正常路径不重叠。
  let pending: { callback: (portId: string) => void; sender: unknown } | null =
    null;

  session.setPermissionCheckHandler(
    (_webContents, permission, _requestingOrigin, details) => {
      if (permission !== "serial") return false;
      return isAllowedOrigin(details.securityOrigin);
    },
  );

  session.setDevicePermissionHandler((details) => {
    if (details.deviceType !== "serial") return false;
    return isAllowedOrigin(details.origin);
  });

  session.on("select-serial-port", (event, portList, webContents, callback) => {
    event.preventDefault();
    if (selectPort !== undefined) {
      // 自动选择模式（测试/无人值守场景）。
      callback(selectPort(portList));
      return;
    }
    // 延迟选择模式：转发端口列表给渲染进程，挂起 callback 等待用户选择。
    pending = { callback, sender: webContents };
    options.onPortsAvailable?.(toPortOptions(portList));
  });

  return {
    resolvePendingSelection(portId: string, sender: unknown): boolean {
      if (pending === null || pending.sender !== sender) return false;
      const callback = pending.callback;
      pending = null;
      callback(portId);
      return true;
    },
  };
}
