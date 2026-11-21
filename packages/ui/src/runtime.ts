/**
 * 组合根轻量运行时入口。
 *
 * 不重新导出 `MamepApp`，避免 workspace 装配、宿主读取和工作区订阅所在的启动 chunk
 * 静态拉入完整界面及 antd 依赖。完整界面经公开子路径按需加载。
 */
export {
  useAppStore,
  type AppStoreState,
  type BufferSizeOption,
  type HostStatus,
  type TraceWindowModel,
} from "./app-store";
export {
  hasPlatformCapability,
  type AppHost,
  type BooleanPlatformCapability,
  type ClipboardHost,
  type CommProperties,
  type CommunicationHost,
  type FileHost,
  type HostIdentity,
  type LoggingHost,
  type PlatformLifecycleHost,
  type PluginHost,
  type PollingHost,
  type TraceHost,
  type TraceSampleEvent,
  type WorkspaceHost,
} from "./host";
export { requestProtocolResolver, requestRouteForSheet } from "./request-route";
export {
  applyLanguage,
  i18nResources,
  initI18n,
  type AppLanguage,
  type TranslationResources,
} from "./i18n";
export {
  type FieldPerformanceCacheMode,
  type FieldPerformanceNetworkProfile,
  type FieldPerformanceSettings,
  type FieldPerformanceZoomPercent,
} from "./local-performance-settings";
