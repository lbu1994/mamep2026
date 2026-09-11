import { useEffect, useMemo, useRef } from "react";
import type { AddressTransform, RowId } from "@mamep2026/domain";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { CommunicationLogEvent } from "@mamep2026/communication";
import {
  createCodecRegistry,
  formatBytesHex,
  registerBasicTablesCodecs,
} from "@mamep2026/communication";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import type { ApplicationMessage } from "@mamep2026/logging";
import { createAddressTransformRegistry } from "@mamep2026/plugin-api";
import {
  applyPollResult,
  buildPollingTargets,
} from "@mamep2026/register-table";
import {
  EXAMPLE_PANEL_PLUGIN_ID,
  examplePanelManifest,
} from "@mamep2026/example-panel";
import {
  ADDRESS_ADJUST_PLUGIN_ID,
  addressAdjustManifest,
  createAddressAdjustRuntime,
} from "@mamep2026/address-adjust";
import {
  YASKAWA_MEMOBUS_PLUGIN_ID,
  yaskawaMemobusManifest,
  createYaskawaRuntime,
} from "@mamep2026/yaskawa-memobus-67h-010dh-010eh";
import {
  CUSTOM_FUNCTION_PLUGIN_ID,
  customFunctionManifest,
  createCustomFunctionRuntime,
} from "@mamep2026/custom-function-code";
import {
  BrowserPlatformHost,
  createIdbKeyValueStore,
  IndexedDBWorkspaceRepository,
} from "@mamep2026/platform-web";
import { MamepApp, useAppStore, type AppHost } from "@mamep2026/ui";
import { isAndroidPlatform } from "@mamep2026/platform-android";
import { createCapacitorTransportBridge } from "@mamep2026/platform-android/capacitor";
import { createCapacitorAppLifecycleBridge } from "@mamep2026/platform-android/capacitor-app";
import { BrowserAppHost, type BundledPluginEntry } from "./AppHost";
import { AndroidAppHost } from "./android-app-host";
import { ElectronAppHost } from "./electron-app-host";
import { VscodeAppHost } from "./vscode-app-host";
import { IndexedDBPluginStore } from "./indexeddb-plugin-store";

const MOCK_FLAG = "mockTransport";
const COMPAT_MISS_FLAG = "compatMiss";

function isMockMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(MOCK_FLAG) === "1"
  );
}

/** dev 门控覆盖开关（沿用 ?mockTransport=1 先例）：强制把检测输入置为「无 Web Serial」，
 * 供 e2e 确定性触发浏览器兼容性提示（PRD §8.3 / §15.7）。 */
function isCompatMissMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(COMPAT_MISS_FLAG) === "1"
  );
}

// UI 层日志自增序号：作为 Listy 稳定 rowKey（与 logging store 的 seq 独立，各自领域内唯一）。
let nextCommLogSeq = 0;

function toCommLogEntry(event: CommunicationLogEvent) {
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

export default function App(): React.ReactNode {
  const hostRef = useRef<AppHost | null>(null);
  const setHost = useAppStore((s) => s.setHost);
  const setDataTypeResolver = useAppStore((s) => s.setDataTypeResolver);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const setLoaded = useAppStore((s) => s.setLoaded);
  const setConnectionModalOpen = useAppStore((s) => s.setConnectionModalOpen);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const appendCommLog = useAppStore((s) => s.appendCommLog);
  const setSaveStatus = useAppStore((s) => s.setSaveStatus);
  const setWorkspaceRecovery = useAppStore((s) => s.setWorkspaceRecovery);
  const updateRow = useAppStore((s) => s.updateRow);
  const setConnectionState = useAppStore((s) => s.setConnectionState);

  const mockTransport = useMemo(() => isMockMode(), []);
  // 地址变换解析（2026-09-02 插件外部化）：跨 effect 共享（装配效应用例与工作区订阅副作用），
  // 初始 no-op 兜底，effect 内装配后指向随包 address-adjust 插件注册表。
  const resolveTransformRef = useRef<
    (transformId: string) => AddressTransform | null
  >(() => null);

  // 启动装配（一次）。宿主 renderer 由 preload / vscode-bridge 暴露 window.mamepHost
  // （白名单桥），按 platform 判别窄化分支装配：VSCode Webview → VscodeAppHost、
  // Electron → ElectronAppHost；Capacitor（Android，ADR-050）→ AndroidAppHost；
  // 否则按浏览器 Host 装配（Web Serial + IndexedDB）。
  useEffect(() => {
    const bridge = window.mamepHost;
    // Android 平台探测：读 globalThis.Capacitor.getPlatform()（不调用任何插件）。
    const android = bridge === undefined && isAndroidPlatform(globalThis);
    // 应用生命周期桥（ADR-050 Phase 3）：返回键（宿主）与前后台（下方 effect）共用同一实例。
    const appLifecycle = android ? createCapacitorAppLifecycleBridge() : null;
    // codec 注册表（ADR-041 决策 A）：随包插件 activate 填充，connect 按活动表协议路由。
    const codecRegistry = createCodecRegistry();
    // 基础表 codec（ADR-043 E-2）：coil/discrete-input/input-register，三端共享装配。
    registerBasicTablesCodecs(codecRegistry);
    // 地址变换注册表（ADR-042）+ 数据类型解析器（ADR-043 E-3）：随包插件 activate 注入，
    // 装配后经闭包传宿主/插件；地址变换解析按表应用（2026-09-02 插件外部化）。
    const transformRegistry = createAddressTransformRegistry();
    const dataTypeResolver = createDataTypeResolver();
    const resolveAddressTransform = (transformId: string) =>
      transformRegistry.get(transformId) ?? null;
    resolveTransformRef.current = resolveAddressTransform;
    // 随应用分发的插件（2026-09-02 插件外部化）：manifest + 同进程 runtime 工厂。
    // 首次启动由 host.startPlugins() 一次性安装（installed + 持久化），重启经 hydrate +
    // attachRuntime 恢复同步能力；插件包代码位于 plugins/ 目录，核心不再内置任何插件。
    const bundledPlugins: BundledPluginEntry[] = [
      {
        pluginId: EXAMPLE_PANEL_PLUGIN_ID,
        manifest: examplePanelManifest,
        createRuntime: () => undefined,
      },
      {
        pluginId: ADDRESS_ADJUST_PLUGIN_ID,
        manifest: addressAdjustManifest,
        createRuntime: () => createAddressAdjustRuntime({ transformRegistry }),
      },
      {
        pluginId: YASKAWA_MEMOBUS_PLUGIN_ID,
        manifest: yaskawaMemobusManifest,
        createRuntime: () => createYaskawaRuntime({ codecRegistry }),
      },
      {
        pluginId: CUSTOM_FUNCTION_PLUGIN_ID,
        manifest: customFunctionManifest,
        createRuntime: () =>
          createCustomFunctionRuntime({ codecRegistry, dataTypeResolver }),
      },
    ];
    const host: AppHost =
      bridge !== undefined
        ? bridge.platform === "vscode"
          ? new VscodeAppHost(bridge, {
              bundledPlugins,
              resolveAddressTransform,
            })
          : new ElectronAppHost(bridge, {
              codecRegistry,
              bundledPlugins,
              resolveAddressTransform,
            })
        : android
          ? (() => {
              // Android（Capacitor，ADR-050）：本地混合宿主——通用能力委托 BrowserAppHost，
              // TCP 走本地 TcpSessionHost + CapacitorTcpTransport（原生 socket 经桥）。
              // 工作区与插件存储复用浏览器 IndexedDB 路径（WebView 原生支持）。
              const kv = createIdbKeyValueStore();
              return new AndroidAppHost({
                bridge: createCapacitorTransportBridge(),
                // 生命周期（备返键 / 前后台，ADR-050 Phase 3）：硬件返回键先关移动端覆盖层
                // （overlay-close 栈，见 MamepApp），无覆盖层时由宿主最小化应用。
                appLifecycle,
                repository: new IndexedDBWorkspaceRepository(kv),
                pluginStore: new IndexedDBPluginStore(kv),
                codecRegistry,
                bundledPlugins,
                resolveAddressTransform,
                mockTransport,
              });
            })()
          : (() => {
            const serial = navigator.serial;
            const compatMiss = isCompatMissMode();
            const platformHost =
              serial !== undefined
                ? new BrowserPlatformHost({ serial })
                : new BrowserPlatformHost({});
            // 工作区与插件存储共享同一 IndexedDB KV（不同 key：workspace / plugins）。
            const kv = createIdbKeyValueStore();
            return new BrowserAppHost({
              platform: platformHost,
              // 浏览器兼容性检测（PRD §8.3 / §15.7）：默认真实环境；?compatMiss=1 强制缺失。
              compatibilityEnv: compatMiss
                ? { serial: undefined, isSecureContext: true }
                : { serial, isSecureContext: window.isSecureContext === true },
              repository: new IndexedDBWorkspaceRepository(kv),
              mockTransport,
              // 插件持久化（2026-08-30，ADR-038）：IndexedDB 独立 key。
              pluginStore: new IndexedDBPluginStore(kv),
              // codec 注册表（ADR-041 决策 A）。
              codecRegistry,
              // 随应用分发插件 + 地址变换解析（2026-09-02 插件外部化）。
              bundledPlugins,
              resolveAddressTransform,
            });
          })();
    hostRef.current = host;
    // 插件系统启动（2026-09-02 插件外部化）：首次一次性安装随包插件；重启恢复 runtime。
    void host.startPlugins();
    // 数据类型解析器注入 store，单元格解析/读取格式化/CSV 白名单经它转发。
    setDataTypeResolver(dataTypeResolver);
    setHost(host);

    // 日志/保存/连接状态/轮询结果接线。
    host.subscribeCommLog((event) => appendCommLog(toCommLogEntry(event)));
    host.subscribeMessage((message: ApplicationMessage) =>
      appendMessage(message),
    );
    host.subscribeSaveStatus((status) => setSaveStatus(status));
    host.subscribeConnectionState((state) => setConnectionState(state));
    host.subscribePollResult((key, address, result) => {
      // 轮询/全表读取逐行结果 → 三态状态点：成功清失败/编辑完成态（不产生成功点）；
      // 失败幂等写失败态（同因子返回原引用，设备掉线时 store 零更新）。
      useAppStore.getState().recordPollResult(key as RowId, result);
      if (!result.ok) return;
      const state = useAppStore.getState();
      // 应用层纯函数完成 generation 校验与按 Type 格式化（§17）；
      // 地址变换按各行所属 sheet 应用（ADR-042 表级 Address Adjust；2026-09-02 插件外部化：
      // 变换经随包 address-adjust 插件注册表解析，核心不再内置）。
      const updated = applyPollResult(
        state.workspace.sheets,
        key,
        address,
        result.value,
        { resolveAddressTransform: resolveTransformRef.current },
      );
      if (updated !== null) updateRow(key as RowId, () => updated);
    });

    // 启动：加载工作区。
    void host
      .loadWorkspace()
      .then((result) => {
        if (result.ok) {
          setWorkspace(result.value);
        } else {
          // 恢复失败给出明确提示（§16.5.6），应用以空工作区保持可操作。
          appendMessage({
            timestamp: Date.now(),
            level: "error",
            messageKey: "messages.loadFailed",
            params: { detail: result.error.code },
            detail: result.error.code,
          });
          if (host.isMockMode && host instanceof BrowserAppHost) {
            // mock 模式：恢复失败同样预填分类寄存器，保证测试环境一致。
            setWorkspace(host.createFreshWorkspace());
          }
        }
        // 恢复提示（ADR-049）：加载后把恢复元数据写入 store，供主体顶部横幅展示。
        setWorkspaceRecovery(host.getWorkspaceRecoveryInfo());
        setLoaded();
        appendMessage({
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
              appendMessage({
                timestamp: Date.now(),
                level: "error",
                messageKey: "messages.connectFailed",
                detail: connectResult.error.technicalMessage,
              });
            }
          });
        } else {
          // 非 Mock 模式：启动自动弹出 Connection Settings。
          setConnectionModalOpen(true);
        }
      })
      .catch(() => {
        setLoaded();
        if (!host.isMockMode) {
          setConnectionModalOpen(true);
        }
      });

    // 关闭/页面隐藏前 flush（ADR-049 崩溃后状态恢复）：把待写快照落盘，减少 debounce
    // 窗口内编辑在关闭/崩溃时的丢失。**仅**用 visibilitychange→hidden：
    // - 关闭窗口/切后台时页面会先进入 hidden（仍存活），IndexedDB/IPC 写入能可靠完成；
    // - 而 pagehide（页面卸载）会中断异步 IndexedDB 写入（e2e 验证），且 reload 也触发
    //   pagehide，会破坏「清工作区→reload」的测试隔离（把已清空的工作区又写回）。
    // pending 被清空故幂等；崩溃无 graceful 时机，由 autosave（500ms）兜底。
    const onVisibilityChange = (): void => {
      const hidden = document.visibilityState === "hidden";
      // 后台暂停轮询/追踪（移动端生命周期，ADR-050 Phase 3）：配置保留在会话宿主内，
      // 回前台按原配置恢复。非 Android 平台同样受益（切标签页/最小化时不再空转总线）。
      host.setBackgroundSuspended?.(hidden);
      if (hidden) {
        void host.flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Android 前后台状态（`@capacitor/app`，ADR-050 Phase 3）：部分 OEM 上 WebView 的
    // visibilitychange 在进程被冻结时不可靠，故用原生 appStateChange 兑底。两条路径都调用
    // 幂等的 setBackgroundSuspended（已挂起再挂起 / 未挂起时恢复均为空操作），可安全重复。
    let appStateDisposed = false;
    let unsubscribeAppState: (() => void) | null = null;
    if (appLifecycle !== null) {
      void appLifecycle
        .onAppStateChange((isActive) => {
          host.setBackgroundSuspended?.(!isActive);
        })
        .then((off) => {
          if (appStateDisposed) {
            off();
            return;
          }
          unsubscribeAppState = off;
        })
        .catch(() => {
          // 桥不可用（插件未注册）：保持 visibilitychange 单路径，不阻断启动。
        });
    }

    return () => {
      appStateDisposed = true;
      unsubscribeAppState?.();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // 释放 host（断开会话 + 退订桥事件 + 清空订阅），避免 StrictMode 双挂载下旧 host
      // 残留订阅导致事件重复投递（comm-log 一条变两条，2026-08-23）。
      void host.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工作区变更 -> 自动保存；WP 轮询目标同步（Address Adjust 应用于轮询地址）。
  // 用 store 命令式订阅代替 React 选择器 + useEffect：行数据更新（编辑/WP 轮询）
  // 不再触发 App 与 <MamepApp/> 的级联重渲染（性能优化）；仅 workspace 引用变化时执行副作用。
  useEffect(() => {
    return useAppStore.subscribe((state, prevState) => {
      if (state.workspace === prevState.workspace) return;
      const host = hostRef.current;
      if (host === null) return;
      if (state.workspace.sheets.length === 0) return;
      host.scheduleSave(state.workspace);

      // 应用层纯函数构建轮询目标（含表级地址变换偏移与地址 0 跳过；ADR-042 按 sheet；
      // 2026-09-02 插件外部化：变换经随包插件注册表解析）。
      host.updatePollingTargets(
        buildPollingTargets(state.workspace.sheets, {
          resolveAddressTransform: resolveTransformRef.current,
        }),
      );
    });
  }, []);

  return <MamepApp />;
}
