/**
 * 应用装配编排（2026-09-13）。
 *
 * ## 为什么有这一层
 * 宿主实现此前在 `App.tsx` 内**静态 import**，导致四端产物首屏都加载三端 Host 代码与
 * `@capacitor/core`（浏览器构建实测：入口 384.54 kB，且 `@capacitor/core` 被
 * `<link rel="modulepreload">` 预加载）。现改为**按运行时平台动态 `import()`**：
 * 浏览器（三端 inner 同源）保持静态装配，Electron / VSCode / Android 各自一个懒 chunk
 * （实测口径：桩替换后入口 334.64 kB，−13%）。
 *
 * ## 职责
 * 装配 + 接线 + 启动 + 释放的全部副作用集中在此，并只经 `HostAssemblySinks` 写 UI：
 * - 因此本模块**不 import UI store / React**，可在 node 环境单测（取消竞态、失败兜底、接线顺序）；
 * - `App.tsx` 退化为「探测平台 → 建上下文 → 调用本模块 → 取消时 abort」。
 *
 * ## 取消语义（关键）
 * 装配是异步的（懒 chunk 加载），而 React StrictMode 会双挂载、页面可能随时卸载：
 * - 取消用 `AbortSignal`；`await` 与工厂调用后**各查一次 `signal.aborted`**，已取消则丢弃
 *   （已构造的 host 立即 `dispose()`，**不接线**）——否则旧 host 的订阅会与新 host 并存活，
 *   表现为通信日志一条变两条（2026-08-23 已修 bug 的回归防护）。
 * - 释放由本模块的 abort 监听统一负责（退订 visibilitychange + `host.dispose()`）。
 */
import type {
  RegisterRow,
  RegisterSheet,
  Result,
  RowId,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type {
  CommunicationLogEvent,
  ConnectionState,
} from "@mamep2026/communication";
import { formatBytesHex } from "@mamep2026/communication";
import type {
  ApplicationMessage,
  CommunicationLogEntry,
} from "@mamep2026/logging";
import type { MamepHostApi, VscodeHostApi } from "@mamep2026/platform-api";
import { applyPollResult } from "@mamep2026/register-table";
import type { SaveStatus } from "@mamep2026/workspace";
import type { AppHost, HostStatus } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";
import { createBrowserHost } from "./host-factories/browser";
import type { AppPlatformName } from "./platform-detect";
import type { PlatformHostContext } from "./platform-context";

/**
 * 平台 Host 工厂：用组合根上下文构造宿主实现。
 * 加载已由 loader 完成；**允许返回 Promise**（Android 端在构造前需 await 插件执行能力探测，
 * ADR-056），`startAppHost` 统一 await 并保留取消语义。
 */
export type PlatformHostFactory = (input: {
  context: PlatformHostContext;
  /** 宿主白名单桥（非浏览器平台必有；浏览器/Android 为 undefined）。 */
  bridge: MamepHostApi | VscodeHostApi | undefined;
  /** 本平台装配的取消信号（Android 前后台订阅据此退订）。 */
  signal: AbortSignal;
}) => AppHost | Promise<AppHost>;

/** 工厂加载器：平台 → 工厂（默认实现按平台动态 `import()`；测试注入假工厂）。 */
export type PlatformHostFactoryLoader = (
  platform: AppPlatformName,
) => Promise<PlatformHostFactory>;

/** 装配编排写入 UI 的唯一端口（由 composition root 用 store 动作实现，见 `store-sinks.ts`）。 */
export interface HostAssemblySinks {
  /** 置 Host 装配状态（`"ready"` / `"failed"`；启动骨架据此切换）。 */
  setHostStatus(status: HostStatus): void;
  /** 注册 host 到 store（UI 经 `host` 读取能力/会话）。 */
  setHost(host: AppHost): void;
  /** 登记活动 host（工作区变更订阅据其调用 `scheduleSave` / `updatePollingTargets`）。 */
  setActiveHost(host: AppHost): void;
  /** 注入数据类型解析器（ADR-043 E-3）。 */
  setDataTypeResolver(resolver: PlatformHostContext["dataTypeResolver"]): void;
  setWorkspace(workspace: Workspace): void;
  setLoaded(): void;
  setConnectionModalOpen(open: boolean): void;
  setSaveStatus(status: SaveStatus): void;
  setConnectionState(state: ConnectionState): void;
  setWorkspaceRecovery(info: WorkspaceRecoveryInfo | null): void;
  appendMessage(message: ApplicationMessage): void;
  appendCommLog(entry: CommunicationLogEntry): void;
  /** 轮询/全表读取逐行结果（三态状态点）。 */
  recordPollResult(key: RowId, result: Result<number | number[]>): void;
  updateRow(key: RowId, updater: (row: RegisterRow) => RegisterRow): void;
  /** 当前工作区表快照（`applyPollResult` 需要）。 */
  getWorkspaceSheets(): RegisterSheet[];
}

export interface HostAssemblyDeps {
  platform: AppPlatformName;
  context: PlatformHostContext;
  sinks: HostAssemblySinks;
  /** 宿主白名单桥（`window.mamepHost`）。 */
  bridge: MamepHostApi | VscodeHostApi | undefined;
  /** 工厂加载器（默认真实动态 import）。 */
  loadHostFactory?: PlatformHostFactoryLoader;
  /** visibilitychange 监听目标（默认 `document`；测试注入，node 环境无 DOM）。 */
  documentRef?: VisibilityDocument;
}

/** visibilitychange 监听面（结构类型：便于 node 环境单测注入）。 */
export interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * 默认工厂加载器：浏览器静态装配，其余平台各自动态 `import()`（产物各成一个懒 chunk，
 * 平台专属依赖——`@capacitor/core` 等——只在其 chunk 内可达）。
 */
export const loadPlatformHostFactory: PlatformHostFactoryLoader = async (
  platform,
) => {
  switch (platform) {
    case "browser":
      // 三端 inner 同源（BrowserAppHost 也是 Electron/Android 的 inner），无收益且会引入额外异步跳。
      return createBrowserHost;
    case "electron": {
      const module = await import("./host-factories/electron");
      return module.createElectronHost;
    }
    case "vscode": {
      const module = await import("./host-factories/vscode");
      return module.createVscodeHost;
    }
    case "android": {
      const module = await import("./host-factories/android");
      return module.createAndroidHost;
    }
    default:
      // 穷尽守卫：平台联合类型新增分支时必须在此显式处理（不得静默回退浏览器路径）。
      throw new Error(`Unsupported platform: ${String(platform)}`);
  }
};

/**
 * 装配并启动宿主：加载工厂 → 构造宿主 → 接线 → 启动插件 → 加载工作区。
 *
 * 返回构造出的 host（已接线且未取消）；被取消或装配失败返回 `null`：
 * - **失败**（懒 chunk 加载失败 / 工厂拒绝 / 接线抛错）：提示 `messages.hostLoadFailed` 并置
 *   `hostStatus: "failed"`，应用以「无 Host」保持可操作（PRD §15.7 同类语义，不白屏）；
 * - **取消**：不接线、已构造的 host 立即释放，不写任何 UI 状态。
 */
export async function startAppHost(
  deps: HostAssemblyDeps,
  signal: AbortSignal,
): Promise<AppHost | null> {
  const { context, sinks } = deps;
  let host: AppHost | null = null;
  try {
    const load = deps.loadHostFactory ?? loadPlatformHostFactory;
    const factory = await load(deps.platform);
    if (signal.aborted) return null;
    // 工厂可异步（Android：构造前 await 能力探测，ADR-056）；await 后重新校验取消。
    host = await factory({ context, bridge: deps.bridge, signal });
    if (signal.aborted) {
      // 装配期间被取消（StrictMode 双挂载 / 卸载）：立即释放且不接线。
      void host.dispose();
      return null;
    }
    wireHost(host, deps, signal);
    return host;
  } catch (error) {
    if (host !== null) void host.dispose();
    reportHostLoadFailure(sinks, error);
    return null;
  }
}

/** 接线 + 启动（仅在未取消时调用一次）。 */
function wireHost(
  host: AppHost,
  deps: HostAssemblyDeps,
  signal: AbortSignal,
): void {
  const { context, sinks } = deps;
  // 插件系统启动（ADR-054）：加载用户手动安装的插件并装配执行面。
  void host.startPlugins();
  // 数据类型解析器注入 store，单元格解析/读取格式化/CSV 白名单经它转发。
  sinks.setDataTypeResolver(context.dataTypeResolver);
  sinks.setHost(host);
  sinks.setActiveHost(host);

  // 日志/保存/连接状态/轮询结果接线。
  host.subscribeCommLog((event) => sinks.appendCommLog(toCommLogEntry(event)));
  host.subscribeMessage((message) => sinks.appendMessage(message));
  host.subscribeSaveStatus((status) => sinks.setSaveStatus(status));
  host.subscribeConnectionState((state) => sinks.setConnectionState(state));
  host.subscribePollResult((key, address, result) => {
    // 轮询/全表读取逐行结果 → 三态状态点：成功清失败/编辑完成态（不产生成功点）；
    // 失败幂等写失败态（同因子返回原引用，设备掉线时 store 零更新）。
    sinks.recordPollResult(key as RowId, result);
    if (!result.ok) return;
    // 应用层纯函数完成 generation 校验与按 Type 格式化（§17）；地址变换按各行所属 sheet
    // 应用（ADR-042 表级 Address Adjust；2026-09-02 插件外部化：变换经插件注册表解析）。
    const updated = applyPollResult(
      sinks.getWorkspaceSheets(),
      key,
      address,
      result.value,
      { resolveAddressTransform: context.resolveAddressTransform },
    );
    if (updated !== null) sinks.updateRow(key as RowId, () => updated);
  });

  // 关闭/页面隐藏前 flush（ADR-049 崩溃后状态恢复）：把待写快照落盘，减少 debounce 窗口内
  // 编辑在关闭/崩溃时的丢失。**仅**用 visibilitychange→hidden：
  // - 关闭窗口/切后台时页面会先进入 hidden（仍存活），IndexedDB/IPC 写入能可靠完成；
  // - 而 pagehide（页面卸载）会中断异步 IndexedDB 写入（e2e 验证），且 reload 也触发 pagehide，
  //   会破坏「清工作区→reload」的测试隔离（把已清空的工作区又写回）。
  // pending 被清空故幂等；崩溃无 graceful 时机，由 autosave（500ms）兜底。
  const doc = deps.documentRef ?? document;
  const onVisibilityChange = (): void => {
    const hidden = doc.visibilityState === "hidden";
    // 后台暂停轮询/追踪（移动端生命周期，ADR-050 Phase 3）：配置保留在会话宿主内，回前台按原
    // 配置恢复。非 Android 平台同样受益（切标签页/最小化时不再空转总线）。
    host.setBackgroundSuspended?.(hidden);
    if (hidden) {
      void host.flush();
    }
  };
  doc.addEventListener("visibilitychange", onVisibilityChange);

  // 释放（页面卸载 / StrictMode 重复挂载清理）：退订监听 + 释放 host（断开会话、退订桥事件、
  // 清空订阅），避免旧 host 残留订阅导致事件重复投递。
  signal.addEventListener(
    "abort",
    () => {
      doc.removeEventListener("visibilitychange", onVisibilityChange);
      void host.dispose();
    },
    { once: true },
  );

  // 启动骨架只覆盖 Host 装配阶段：接线完成即切换真实外壳，工作区仍随后异步加载。
  sinks.setHostStatus("ready");

  // 启动：加载工作区。
  void host
    .loadWorkspace()
    .then((result) => {
      if (result.ok) {
        sinks.setWorkspace(result.value);
      } else {
        // 恢复失败给出明确提示（§16.5.6），应用以空工作区保持可操作。
        sinks.appendMessage({
          timestamp: Date.now(),
          level: "error",
          messageKey: "messages.loadFailed",
          params: { detail: result.error.code },
          detail: result.error.code,
        });
        if (host.isMockMode && host instanceof BrowserAppHost) {
          // mock 模式：恢复失败同样预填分类寄存器，保证测试环境一致。
          sinks.setWorkspace(host.createFreshWorkspace());
        }
      }
      // 恢复提示（ADR-049）：加载后把恢复元数据写入 store，供主体顶部横幅展示。
      sinks.setWorkspaceRecovery(host.getWorkspaceRecoveryInfo());
      sinks.setLoaded();
      sinks.appendMessage({
        timestamp: Date.now(),
        level: "info",
        messageKey: "messages.appStarted",
        detail: null,
      });
      if (host.isMockMode) {
        // Mock 模式：跳过 Connection Settings，用默认 RTU 配置直接连接模拟设备。
        const profile =
          (result.ok ? result.value.connectionProfiles[0] : undefined) ??
          createDefaultRtuProfile();
        // Mock 模式仅浏览器（RTU 连接）；工作区若存了 TCP profile 则回退默认 RTU。
        const rtuProfile =
          profile.protocol === "rtu" ? profile : createDefaultRtuProfile();
        void host.connect(rtuProfile, null).then((connectResult) => {
          if (!connectResult.ok) {
            sinks.appendMessage({
              timestamp: Date.now(),
              level: "error",
              messageKey: "messages.connectFailed",
              detail: connectResult.error.technicalMessage,
            });
          }
        });
      } else {
        // 非 Mock 模式：启动自动弹出 Connection Settings。
        sinks.setConnectionModalOpen(true);
      }
    })
    .catch(() => {
      sinks.setLoaded();
      if (!host.isMockMode) {
        sinks.setConnectionModalOpen(true);
      }
    });
}

/** 装配失败：提示可读原因 + 置失败态（应用继续以「无 Host」运行，连接等入口自然不可用）。 */
function reportHostLoadFailure(sinks: HostAssemblySinks, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  sinks.setHostStatus("failed");
  sinks.appendMessage({
    timestamp: Date.now(),
    level: "error",
    messageKey: "messages.hostLoadFailed",
    params: { detail },
    detail,
  });
}

// UI 层日志自增序号：作为 Listy 稳定 rowKey（与 logging store 的 seq 独立，各自领域内唯一）。
let nextCommLogSeq = 0;

/** 通信日志事件 → UI 行模型（仅字节 + 元数据，PRD §11）。 */
function toCommLogEntry(event: CommunicationLogEvent): CommunicationLogEntry {
  return {
    seq: nextCommLogSeq++,
    timestamp: event.timestamp,
    direction: event.direction,
    bytesHex: formatBytesHex(event.bytes),
    protocol: event.protocol,
    slaveAddress: event.slaveAddress,
    functionCode: event.functionCode,
    userAddress: event.userAddress,
    sentAddress: event.sentAddress,
    quantity: event.quantity,
    attempt: event.attempt,
    status: event.status,
    errorCode: event.errorCode,
    exceptionCode: event.exceptionCode,
    source: event.source,
    durationMs: event.durationMs,
  };
}
