/**
 * Node 平台 Host（docs/TECH_DESIGN.md §6.1、§9.3、§34.3.16）。
 * Electron 主进程与 VSCode Extension Host 共用本 Host：枚举 / 打开串口传输。
 * 本实现为原型（ADR-020），生产接线时由 electronCapabilities / vscodeCapabilities 翻转能力矩阵，
 * 串口选择由各端 UI picker 承担。
 */
import type {
  PlatformCapabilities,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import { createMamepError, createTcpConnectionProfile, fail, ok } from "@mamep2026/domain";
import type { Clock, TransportPort } from "@mamep2026/communication";
import type { PlatformHost, SerialDeviceHandle } from "@mamep2026/platform-api";
import type {
  SerialPortFactoryLike,
  SerialPortInfoLike,
} from "./serial-port-like";
import { RealSerialPortFactory } from "./real-serial-port";
import { NodeSerialTransport } from "./node-serial-transport";
import type { NetFactoryLike } from "./socket-like";
import { RealNetFactory } from "./real-socket";
import { NodeTcpTransport } from "./node-tcp-transport";
import {
  toSerialPortOpenLike,
  validateSerialParameters,
} from "./serial-config";
import {
  describeNodeSerialCapabilities,
  type NodeSerialCapabilities,
} from "./serial-capabilities";
import {
  describeNodeTcpCapabilities,
  type NodeTcpCapabilities,
} from "./tcp-capabilities";
import { mapSerialError } from "./error-mapping";
import { nodeClock } from "./real-clock";

/** 默认能力声明（不写入生产能力矩阵；生产接线时翻转 electron/vscode 能力常量）。
 * modbusTcp:true——Node TCP Adapter 已落地（2026-08-23 两端 TCP 接线）。 */
export const nodeHostCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: true,
  serialPorts: "enumerated",
  filesystem: "unsupported",
  nodePlugins: false,
  webPlugins: false,
});

export interface NodePlatformHostOptions {
  factory?: SerialPortFactoryLike | undefined;
  netFactory?: NetFactoryLike | undefined;
  clock?: Clock | undefined;
  capabilities?: PlatformCapabilities | undefined;
  serialCapabilities?: NodeSerialCapabilities | undefined;
  tcpCapabilities?: NodeTcpCapabilities | undefined;
}

/** 由枚举信息派生显示标签（与真实路径分离，§34.3.2/§34.3.4）。 */
export function displayLabel(info: SerialPortInfoLike): string {
  if (info.manufacturer !== undefined && info.manufacturer.length > 0) {
    return `${info.manufacturer} (${info.path})`;
  }
  return info.path;
}

export class NodePlatformHost implements PlatformHost {
  readonly capabilities: PlatformCapabilities;
  readonly clock: Clock;
  readonly serialCapabilities: NodeSerialCapabilities;
  readonly tcpCapabilities: NodeTcpCapabilities;
  private readonly factory: SerialPortFactoryLike;
  private readonly netFactory: NetFactoryLike;

  constructor(options: NodePlatformHostOptions = {}) {
    this.factory = options.factory ?? new RealSerialPortFactory();
    this.netFactory = options.netFactory ?? new RealNetFactory();
    this.capabilities = options.capabilities ?? nodeHostCapabilities;
    this.clock = options.clock ?? nodeClock;
    this.serialCapabilities =
      options.serialCapabilities ??
      describeNodeSerialCapabilities({
        platform: typeof process !== "undefined" ? process.platform : "unknown",
        library: "serialport",
        libraryVersion: "13",
      });
    this.tcpCapabilities =
      options.tcpCapabilities ??
      describeNodeTcpCapabilities({
        libraryVersion:
          typeof process !== "undefined" ? process.versions.node : "unknown",
      });
  }

  /** 枚举系统串口（§34.3.2）：原始路径作 id，显示名独立 label；失败返回结构化错误。 */
  async enumerateSerialPorts(): Promise<Result<SerialDeviceHandle[]>> {
    try {
      const ports = await this.factory.list();
      return ok(
        ports.map((info) => ({ id: info.path, label: displayLabel(info) })),
      );
    } catch (cause) {
      return fail(mapSerialError(cause));
    }
  }

  /**
   * 原型语义：枚举后返回列表中的第一个端口（无端口返回 null）。
   * 正式接线由各端 UI picker（HostMessage v1 select-serial-port）承担。
   */
  async requestSerialPort(): Promise<Result<SerialDeviceHandle | null>> {
    const result = await this.enumerateSerialPorts();
    if (!result.ok) return fail(result.error);
    return ok(result.value[0] ?? null);
  }

  async openSerialTransport(
    handle: SerialDeviceHandle,
    profile: RtuConnectionProfile,
  ): Promise<Result<TransportPort>> {
    const validation = validateSerialParameters(profile);
    if (!validation.ok) {
      return fail(
        createMamepError({
          code: "SERIAL_PARAMETER_UNSUPPORTED",
          category: "validation",
          retryable: false,
          userMessageKey: "errors.serialParameterUnsupported",
          technicalMessage: validation.reason,
        }),
      );
    }
    const port = this.factory.create(toSerialPortOpenLike(handle.id, profile));
    return ok(new NodeSerialTransport(port));
  }

  /**
   * 打开 TCP 传输（Node TCP Adapter）。边界校验 profile（host/port/unitId，
   * unitId 范围 0~255，用户决策）；host/port 原样透传给 Node net（§34.3.4）。
   */
  async openTcpTransport(
    profile: TcpConnectionProfile,
  ): Promise<Result<TransportPort>> {
    const validation = createTcpConnectionProfile(profile);
    if (!validation.ok) {
      return fail(validation.error);
    }
    const socket = this.netFactory.connect({
      host: profile.host,
      port: profile.port,
    });
    return ok(new NodeTcpTransport(socket));
  }
}
