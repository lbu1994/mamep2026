/** UI 侧 Host 契约入口；具体子契约见 `host-contracts.ts`。 */
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
} from "./host-contracts";
