/**
 * 应用装配编排。
 *
 * ## 为什么有这一层
 * 宿主实现按运行时平台加载，避免四端首屏都加载三端 Host 代码与 `@capacitor/core`：
 * 浏览器（三端 inner 同源）保持静态装配，Electron / VSCode / Android 各自一个懒 chunk
 * （经动态 `import()` 按平台加载）。
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
 *   表现为通信日志一条变两条（已修 bug 的回归防护）。
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
import { decodeFloatWords, isFloatType } from "@mamep2026/data-conversion";
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
import {
  applyPollResult,
  pollResultTargetMatches,
} from "@mamep2026/register-table";
import type { SaveStatus } from "@mamep2026/workspace";
import type { AppHost, HostStatus } from "@mamep2026/ui";
import { hasPlatformCapability, requestRouteForSheet } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";
import { loadPlatformHostFactory as loadHostFactoryForBuildTarget } from "./host-factories/loader";
import {
  scheduleAfterPaint,
  type AfterPaintScheduler,
} from "./main-thread-scheduler";
import type { AppPlatformName } from "./platform-detect";
import type { PlatformHostContext } from "./platform-context";
import { markStartup } from "./startup-performance";

/**
 * 平台 Host 工厂：用组合根上下文构造宿主实现。
 * 加载已由 loader 完成；**允许返回 Promise**（Android 端在构造前需 await 插件执行能力探测，
 * ），`startAppHost` 统一 await 并保留取消语义。
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

/**
 * 默认加载器。Vite 生产构建按 mode 把 `host-factories/loader` 别名到目标平台入口；
 * 开发服务器使用默认入口，按运行时桥 / Capacitor 探测结果加载。
 */
export const loadPlatformHostFactory: PlatformHostFactoryLoader =
  loadHostFactoryForBuildTarget;

/** 装配编排写入 UI 的唯一端口（由 composition root 用 store 动作实现，见 `store-sinks.ts`）。 */
export interface HostAssemblySinks {
  /** 置 Host 装配状态（`"ready"` / `"failed"`；启动骨架据此切换）。
   *  起 `"ready"` 的含义是「宿主装配 + 工作区加载 + 插件就绪」（见 `wireHost` 的就绪门）：
   * 外壳的侧栏 / 底部面板 / 已打开 Tab / 表与行全部派生自工作区，必须等它就位再渲染，否则首屏闪烁。 */
  setHostStatus(status: HostStatus): void;
  /**
   * 置插件注册表就绪（`host.startPlugins()` 落定后调用）。
   * 主题装配链据此区分「插件尚未加载」与「插件已禁用/卸载」（见 `resolveThemeColorSeed`）。
   */
  setPluginsReady(ready: boolean): void;
  /** 注册 host 到 store（UI 经 `host` 读取能力/会话）。 */
  setHost(host: AppHost): void;
  /** 登记活动 host（工作区变更订阅据其调用 `scheduleSave` / `updatePollingTargets`）。 */
  setActiveHost(host: AppHost): void;
  /** 注入数据类型解析器。 */
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
  /**
   * 启动外壳就绪门超时（ms，默认 5000）：仓储 / 桥异常挂起时强制切换到真实外壳，
   * 避免骨架常驻。供单测注入短超时。
   */
  shellReadyTimeoutMs?: number;
  /** visibilitychange 监听目标（默认 `document`；测试注入，node 环境无 DOM）。 */
  documentRef?: VisibilityDocument;
  /**
   * 首屏后的调度器（默认等待一次真实绘制）。插件恢复、通信日志/轮询结果接线和
   * 页面生命周期监听经它延后，避免与工作区恢复及主界面首次 React commit 合并成长任务。
   */
  scheduleAfterPaint?: AfterPaintScheduler;
}

/** visibilitychange 监听面（结构类型：便于 node 环境单测注入）。 */
export interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * 装配并启动宿主：加载工厂 → 构造宿主 → 必需接线 → 加载工作区 → 首屏可交互。
 *
 * 插件恢复、通信日志/轮询结果接线在首屏绘制后另行调度；它们不再阻塞主界面。
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
    markStartup("host-load-start");
    const factory = await load(deps.platform);
    markStartup("host-loaded");
    if (signal.aborted) return null;
    // 工厂可异步（Android：构造前 await 能力探测）；await 后重新校验取消。
    host = await factory({ context, bridge: deps.bridge, signal });
    markStartup("host-constructed");
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
  /**
   * 首屏后的清理函数。插件恢复可能仍在进行时页面被卸载，所以订阅必须独立于
   * 首屏接线登记，并在 abort 时释放。
   */
  const backgroundCleanups = new Set<() => void>();
  // 数据类型解析器注入 store，单元格解析/读取格式化/CSV 白名单经它转发。
  sinks.setDataTypeResolver(context.dataTypeResolver);
  sinks.setHost(host);
  sinks.setActiveHost(host);

  // 首屏必需接线：消息、保存状态和连接状态。通信日志与轮询结果不影响初始界面，
  // 在首屏绘制后再订阅（恢复工作区保持离线，期间不会产生设备请求）。
  host.subscribeMessage((message) => sinks.appendMessage(message));
  host.subscribeSaveStatus((status) => sinks.setSaveStatus(status));
  host.subscribeConnectionState((state) => sinks.setConnectionState(state));

  // 释放（页面卸载 / StrictMode 重复挂载清理）：退订监听 + 释放 host（断开会话、退订桥事件、
  // 清空订阅），避免旧 host 残留订阅导致事件重复投递。
  signal.addEventListener(
    "abort",
    () => {
      for (const cleanup of backgroundCleanups) cleanup();
      backgroundCleanups.clear();
      void host.dispose();
    },
    { once: true },
  );

  // 主界面就绪门只等待 Host 已接线且工作区完整加载/校验完成。工作区仍是外壳布局、
  // Tab、表和行的唯一事实源，所以它必须在首次显示真实外壳前落定；插件恢复不再阻塞。
  // 超时兜底：仓储/桥挂起时按上限强制切换，避免骨架常驻。取消后不再写 UI。
  const workspaceSettled = applyWorkspace(host, sinks);
  void gateWithTimeout(
    workspaceSettled,
    deps.shellReadyTimeoutMs ?? SHELL_READY_TIMEOUT_MS,
  ).then((timedOutAfterMs) => {
    if (signal.aborted) return;
    markStartup("interactive");
    sinks.setHostStatus("ready");
    if (timedOutAfterMs !== null) {
      sinks.appendMessage({
        timestamp: Date.now(),
        level: "warning",
        messageKey: "messages.startupTimeout",
        detail: `timeout=${timedOutAfterMs}ms`,
      });
    }
    if (!host.isMockMode) {
      // 弹窗不依赖插件恢复完成，只需确保连接动作读取最新 pluginsReady。
      // 与插件恢复并行调度，避免其表单代码在插件落定后才形成最后一轮长任务。
      const cancelModal = (deps.scheduleAfterPaint ?? scheduleAfterPaint)(
        () => {
          if (!signal.aborted) sinks.setConnectionModalOpen(true);
        },
      );
      backgroundCleanups.add(cancelModal);
    }
    const cancelBackground = (deps.scheduleAfterPaint ?? scheduleAfterPaint)(
      () => {
        void startDeferredServices(host, deps, signal, backgroundCleanups);
      },
    );
    backgroundCleanups.add(cancelBackground);
  });
}

/**
 * 首屏绘制后的非关键阶段：
 * 1. 接入通信日志、轮询结果和页面生命周期；
 * 2. 恢复已安装插件（逐插件等待宿主让出主线程）；
 * 3. 成功、失败或异常都发布插件就绪，结束主题过渡态。
 */
async function startDeferredServices(
  host: AppHost,
  deps: HostAssemblyDeps,
  signal: AbortSignal,
  cleanups: Set<() => void>,
): Promise<void> {
  if (signal.aborted) return;
  markStartup("deferred-start");
  const { context, sinks } = deps;

  cleanups.add(
    host.subscribeCommLog((event) =>
      sinks.appendCommLog(toCommLogEntry(event)),
    ),
  );
  cleanups.add(
    host.subscribePollResult((pollResult) => {
      const sheets = sinks.getWorkspaceSheets();
      const sheet = sheets.find(
        (candidate) => candidate.sheetId === pollResult.sheetId,
      );
      if (sheet === undefined) return;
      const currentRoute = requestRouteForSheet(host, sheet);
      if (
        currentRoute.unitAddress !== pollResult.route.unitAddress ||
        currentRoute.protocol !== pollResult.route.protocol
      ) {
        return;
      }
      if (
        !pollResultTargetMatches(sheets, pollResult, {
          resolveAddressTransform: context.resolveAddressTransform,
          resolveProtocol: () => currentRoute.protocol,
        })
      ) {
        return;
      }
      // 轮询/全表读取逐行结果 → 三态状态点：成功清失败/编辑完成态（不产生成功点）；
      // 失败幂等写失败态（同因子返回原引用，设备掉线时 store 零更新）。
      const row = sheet.rows.find((candidate) => candidate.rowId === pollResult.key);
      if (pollResult.result.ok && row !== undefined && isFloatType(row.dataType)) {
        const raw = pollResult.result.value;
        const decoded = decodeFloatWords(Array.isArray(raw) ? raw : [raw], row.dataType);
        if (!decoded.ok) {
          sinks.recordPollResult(pollResult.key as RowId, decoded);
          return;
        }
      }
      sinks.recordPollResult(pollResult.key as RowId, pollResult.result);
      if (!pollResult.result.ok) return;
      const updated = applyPollResult(
        sheets,
        pollResult,
        pollResult.result.value,
        { resolveAddressTransform: context.resolveAddressTransform },
      );
      if (updated !== null) {
        sinks.updateRow(pollResult.key as RowId, () => updated);
      }
    }),
  );

  // 关闭/页面隐藏前 flush（崩溃后状态恢复）：把待写快照落盘，减少 debounce 窗口内
  // 编辑在关闭/崩溃时的丢失。**仅**用 visibilitychange→hidden：
  // - 关闭窗口/切后台时页面会先进入 hidden（仍存活），IndexedDB/IPC 写入能可靠完成；
  // - 而 pagehide（页面卸载）会中断异步 IndexedDB 写入（e2e 验证），且 reload 也触发 pagehide，
  //   会破坏「清工作区→reload」的测试隔离（把已清空的工作区又写回）。
  // pending 被清空故幂等；崩溃无 graceful 时机，由 autosave（500ms）兜底。
  const doc = deps.documentRef ?? document;
  const onVisibilityChange = (): void => {
    const hidden = doc.visibilityState === "hidden";
    // 后台暂停轮询/追踪：配置保留在会话宿主内，回前台按原配置恢复。
    // 是否由页面生命周期驱动本地会话必须由能力矩阵明确声明。
    if (hasPlatformCapability(host.capabilities, "backgroundLifecycle")) {
      host.setBackgroundSuspended?.(hidden);
    }
    if (hidden) {
      void host.flush();
    }
  };
  doc.addEventListener("visibilitychange", onVisibilityChange);
  cleanups.add(() => {
    doc.removeEventListener("visibilitychange", onVisibilityChange);
  });

  try {
    await host.startPlugins();
  } catch (error) {
    if (!signal.aborted) {
      const detail = error instanceof Error ? error.message : String(error);
      sinks.appendMessage({
        timestamp: Date.now(),
        level: "error",
        messageKey: "messages.pluginLoadFailed",
        params: { detail },
        detail,
      });
    }
  } finally {
    // fail-open：插件成功、失败或异常都结束主题过渡态；取消后的旧流程不得写 UI。
    if (!signal.aborted) {
      markStartup("plugins-settled");
      sinks.setPluginsReady(true);
    }
  }
}

/** 启动外壳就绪门超时（ms）：仓储 / 桥异常挂起时强制切换外壳，避免骨架常驻。 */
const SHELL_READY_TIMEOUT_MS = 5000;

/**
 * 就绪门竞速：`settled` 落定返回 `null`；超时返回超时毫秒数（调用方据此提示）。
 * 落定后清除计时器，不留悬挂 timer。
 */
function gateWithTimeout(
  settled: Promise<unknown>,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(timeoutMs), timeoutMs);
    void settled.then(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * 加载并应用工作区（启动外壳就绪门的一半）：成功 / 失败 / 异常**都必须落定**，否则骨架常驻
 * （由 `wireHost` 的超时兜底）。包含 mock 模式的自动连接（等它落定，否则首帧是 Connect
 * 随后跳 Disconnect）与非 mock 的启动弹窗（与外壳同一批更新，不再「外壳先出现、弹窗后弹」）。
 */
async function applyWorkspace(
  host: AppHost,
  sinks: HostAssemblySinks,
): Promise<void> {
  try {
    markStartup("workspace-start");
    const result = await host.loadWorkspace();
    markStartup("workspace-settled");
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
    // 恢复提示：加载后把恢复元数据写入 store，供主体顶部横幅展示。
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
      const connectResult = await host.connect(rtuProfile, null);
      if (!connectResult.ok) {
        sinks.appendMessage({
          timestamp: Date.now(),
          level: "error",
          messageKey: "messages.connectFailed",
          detail: connectResult.error.technicalMessage,
        });
      }
    }
  } catch {
    sinks.setLoaded();
  }
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
