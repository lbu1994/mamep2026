/**
 * Node TCP 平台宿主（仅 TCP，Electron 主进程用）。
 *
 * `NodePlatformHost` 会静态引入 serialport 原生绑定
 * （`real-serial-port.ts` → `@serialport/bindings-cpp`，运行时用 `__dirname` 加载
 * `.node`），若被 Vite 打进 Electron 主进程 ESM bundle，会在模块初始化时抛
 * `ReferenceError: __dirname is not defined in ES module scope`。而 Electron 主进程
 * 仅承载 Modbus TCP 会话（RTU 在 Renderer，Web Serial），根本不需要串口。
 *
 * 因此本类只提供 TCP 打开能力（`openTcpTransport`）+ 时钟 + 能力声明，不引用任何
 * serialport 代码；经 `@mamep2026/platform-node/tcp` 子路径导出（package.json
 * `exports` 单独入口），避免把 serialport 拉进 Electron 主进程 bundle。
 * VSCode 侧仍用 `NodePlatformHost`（扩展宿主按原生模块处理 serialport）。
 */
import type { Clock, TransportPort } from "@mamep2026/communication";
import {
  createTcpConnectionProfile,
  fail,
  ok,
  type PlatformCapabilities,
  type Result,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type { NetFactoryLike } from "./socket-like";
import { RealNetFactory } from "./real-socket";
import { NodeTcpTransport } from "./node-tcp-transport";
import { nodeClock } from "./real-clock";

/** 仅 TCP 的能力声明（Electron 主进程矩阵由 electronCapabilities 承担，本值备用/测试）。
 * hostPlugins:true——Node 侧宿主插件执行面（`@mamep2026/platform-node/plugin`）。 */
export const nodeTcpHostCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: false,
  modbusTcp: true,
  serialPorts: "unsupported",
  filesystem: "unsupported",
  nodePlugins: false,
  webPlugins: false,
  logExport: "unsupported",
  workspaceImport: "unsupported",
  workspaceExport: "unsupported",
  pluginInstall: "unsupported",
  executablePlugins: false,
  hostPlugins: true,
  protocolExtensions: [],
  tableTypes: ["holding-register"],
});

export interface NodeTcpPlatformHostOptions {
  /** 注入式 net 工厂（测试用 fake；默认 RealNetFactory）。 */
  netFactory?: NetFactoryLike | undefined;
  clock?: Clock | undefined;
  capabilities?: PlatformCapabilities | undefined;
}

/** 仅 TCP 的 Node 平台宿主：与 NodePlatformHost.openTcpTransport 同构，但零 serialport 依赖。 */
export class NodeTcpPlatformHost {
  readonly clock: Clock;
  readonly capabilities: PlatformCapabilities;
  private readonly netFactory: NetFactoryLike;

  constructor(options: NodeTcpPlatformHostOptions = {}) {
    this.netFactory = options.netFactory ?? new RealNetFactory();
    this.clock = options.clock ?? nodeClock;
    this.capabilities = options.capabilities ?? nodeTcpHostCapabilities;
  }

  /**
   * 打开 TCP 传输（Node TCP Adapter）。边界校验 profile（host/port/unitId，
   * unitId 范围 0~255，用户决策）；host/port 原样透传给 Node net。
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
