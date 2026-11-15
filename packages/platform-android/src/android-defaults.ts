/**
 * Android 端默认连接参数覆盖。
 *
 * 默认 50ms 对 Android 多一跳 WebView 桥的余量很小（对端人为延迟 30ms 时总耗时已达
 * ~47ms），因此 Android 使用更宽容的默认值。
 *
 * 覆盖语义（显式且可解释）：**仅当 profile 处于库默认值时**替换为 Android 默认；
 * 用户在连接设置里改过的值原样保留。不做「无条件覆盖」（会吞掉用户配置），
 * 也不改全局 `defaultConfig`（会影响三端）。
 */
import { defaultConfig, type TcpConnectionProfile } from "@mamep2026/domain";

/** Android 默认请求超时（默认 50ms 对桥接传输余量过小）。 */
export const ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS = 300;
/** Android 默认重试次数（默认 1）。 */
export const ANDROID_TCP_DEFAULT_RETRY_COUNT = 2;

/** 按上述语义返回生效 profile（不修改入参）。 */
export function applyAndroidTcpDefaults(
  profile: TcpConnectionProfile,
): TcpConnectionProfile {
  const timeout =
    profile.requestTimeoutMs === defaultConfig.tcp.requestTimeoutMs
      ? ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS
      : profile.requestTimeoutMs;
  const retryCount =
    profile.retryCount === defaultConfig.tcp.retryCount
      ? ANDROID_TCP_DEFAULT_RETRY_COUNT
      : profile.retryCount;

  if (
    timeout === profile.requestTimeoutMs &&
    retryCount === profile.retryCount
  ) {
    return profile;
  }
  return { ...profile, requestTimeoutMs: timeout, retryCount };
}
