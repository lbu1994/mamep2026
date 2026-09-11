/**
 * Android 平台 Host（`PlatformHost`，ADR-050 §3、§6）。
 *
 * 与 `NodePlatformHost` / `BrowserPlatformHost` 平级：只提供平台能力与传输打开，
 * 不含任何 Modbus 语义；会话编排由 `packages/application` 的共享宿主承担。
 *
 * Phase 1：TCP（原生 socket）。Phase 2：USB-RS485（USB Host + 枚举 + 打开），
 * 能力矩阵相应翻转为 `modbusRtu:true` / `serialPorts:"enumerated"`。
 *
 * 枚举结果会在本类内**缓存**，`selectSerialPort(portId)` 从缓存取 handle（Android 无浏览器式 picker，
 * 也不需要用户手势）；缓存未命中（如页面重载）时重新枚举一次，仍无则返回 `ok(null)`。
 */
import type {
  PlatformCapabilities,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import { createTcpConnectionProfile, fail, ok } from "@mamep2026/domain";
import type { Clock, TransportPort } from "@mamep2026/communication";
import type {
  PlatformHost,
  SerialDeviceHandle,
  SerialPortOption,
} from "@mamep2026/platform-api";
import { androidCapabilities } from "./android-capabilities";
import { CapacitorTcpTransport } from "./capacitor-tcp-transport";
import { CapacitorUsbSerialTransport } from "./capacitor-usb-serial-transport";
import type { MamepTransportBridge } from "./bridge";
import {
  bridgeKeepScreenOnParamsSchema,
  bridgeListSerialPortsResultSchema,
  bridgeOpenSerialParamsSchema,
  buildBridgeParams,
  parseBridgePayload,
} from "./bridge-contract";
import { androidClock } from "./clock";
import {
  mapAndroidNativeError,
  serialParameterUnsupportedError,
  toNativeBridgeError,
} from "./error-mapping";
import { validateSerialParameters } from "./serial-parameters";

export interface AndroidPlatformHostOptions {
  /** 传输桥（生产 = `createCapacitorTransportBridge()`；测试注入 fake）。 */
  bridge: MamepTransportBridge;
  capabilities?: PlatformCapabilities | undefined;
  clock?: Clock | undefined;
}

export class AndroidPlatformHost implements PlatformHost {
  readonly capabilities: PlatformCapabilities;
  readonly clock: Clock;
  private readonly bridge: MamepTransportBridge;
  /** 最近一次枚举结果（portId → handle），供 `selectSerialPort` 使用。 */
  private serialHandles = new Map<string, SerialDeviceHandle>();

  constructor(options: AndroidPlatformHostOptions) {
    this.bridge = options.bridge;
    this.capabilities = options.capabilities ?? androidCapabilities;
    this.clock = options.clock ?? androidClock;
  }

  /**
   * 枚举 USB 串口（`serialPorts: "enumerated"` 的能力实现，ADR-050 Phase 2）。
   * 回包一律经 Zod 校验；枚举失败按「串口打开」上下文映射（权限/驱动异常等）。
   */
  async listSerialPorts(): Promise<Result<SerialPortOption[]>> {
    let payload: unknown;
    try {
      payload = await this.bridge.listSerialPorts();
    } catch (cause) {
      return fail(
        mapAndroidNativeError(toNativeBridgeError(cause), "serial-open"),
      );
    }
    const parsed = parseBridgePayload(
      bridgeListSerialPortsResultSchema,
      payload,
      "listSerialPorts",
    );
    if (!parsed.ok) return fail(parsed.error);

    const handles = new Map<string, SerialDeviceHandle>();
    const options: SerialPortOption[] = parsed.value.ports.map((port) => {
      const label = port.label.length > 0 ? port.label : port.deviceName;
      handles.set(port.deviceName, { id: port.deviceName, label });
      return { portId: port.deviceName, label };
    });
    this.serialHandles = handles;
    return ok(options);
  }

  /**
   * 按 portId 选择端口（enumerated 平台语义，与 Electron/VSCode 一致）。
   * `null`/空串 = 取消当前选择（返回 `ok(null)`）；缓存未命中时重新枚举一次后仍未命中则 `ok(null)`。
   */
  async selectSerialPort(
    portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>> {
    if (portId === undefined || portId === null || portId.length === 0) {
      return ok(null);
    }
    if (!this.serialHandles.has(portId)) {
      const listed = await this.listSerialPorts();
      if (!listed.ok) return fail(listed.error);
    }
    return ok(this.serialHandles.get(portId) ?? null);
  }

  /**
   * `PlatformHost` 契约方法：浏览器弹 picker、enumerated 平台取首个。
   * Android UI 走 `listSerialPorts` + `selectSerialPort`（下拉），此方法仅保持接口语义完整。
   * 无设备时返回 `ok(null)`（非错误，与 Node 宿主一致）。
   */
  async requestSerialPort(): Promise<Result<SerialDeviceHandle | null>> {
    const listed = await this.listSerialPorts();
    if (!listed.ok) return fail(listed.error);
    const first = listed.value[0];
    if (first === undefined) return ok(null);
    return ok(this.serialHandles.get(first.portId) ?? null);
  }

  /**
   * 打开 USB 串口传输：先校验链路参数（不受支持 → 参数错误，不发请求），
   * 再映射为桥参数（形状校验），最后交给 `CapacitorUsbSerialTransport`。
   */
  async openSerialTransport(
    handle: SerialDeviceHandle,
    profile: RtuConnectionProfile,
  ): Promise<Result<TransportPort>> {
    const validation = validateSerialParameters(profile);
    if (!validation.ok) {
      return fail(serialParameterUnsupportedError(validation.reason));
    }
    const params = buildBridgeParams(
      bridgeOpenSerialParamsSchema,
      {
        deviceName: handle.id,
        baudRate: profile.baudRate,
        dataBits: profile.dataBits,
        stopBits: profile.stopBits,
        parity: profile.parity,
        flowControl: profile.flowControl,
      },
      "openSerial",
    );
    if (!params.ok) return fail(params.error);

    return ok(
      new CapacitorUsbSerialTransport({ bridge: this.bridge, params: params.value }),
    );
  }

  /**
   * 打开 TCP 传输。连接参数边界校验复用 domain 的 `createTcpConnectionProfile`
   * （host/port/unitId 规则单一事实源，与 Node 端同源），再交给 Capacitor 传输。
   */
  async openTcpTransport(
    profile: TcpConnectionProfile,
  ): Promise<Result<TransportPort>> {
    const validation = createTcpConnectionProfile(profile);
    if (!validation.ok) return fail(validation.error);

    return ok(
      new CapacitorTcpTransport({
        bridge: this.bridge,
        host: profile.host,
        port: profile.port,
        connectTimeoutMs: profile.connectTimeoutMs,
      }),
    );
  }

  /**
   * 屏幕常亮（KeepAwake，ADR-050 Phase 3）：由 UI 依据「是否存在持续轮询/追踪」驱动。
   * 幂等；失败不抛出（屏幕常亮属体验优化，不应影响通信主流程）。
   */
  setKeepScreenOn(enabled: boolean): void {
    const params = buildBridgeParams(
      bridgeKeepScreenOnParamsSchema,
      { enabled },
      "setKeepScreenOn",
    );
    if (!params.ok) return;
    void this.bridge.setKeepScreenOn(params.value).catch(() => undefined);
  }
}
