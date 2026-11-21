/**
 * 本地 Web 性能采样的平台无关控制契约。
 *
 * 浏览器组合根负责 Event Timing / PerformanceObserver 与本地存储；共享 UI 只渲染
 * 开关、场景元数据和导出/清空动作。具体实现不得把工作区行内容、寄存器地址、
 * 设备报文或插件私有数据放进该契约。
 */
export type FieldPerformanceCacheMode = "cold" | "warm";

export type FieldPerformanceZoomPercent = 100 | 125 | 150;

export type FieldPerformanceNetworkProfile =
  "local" | "wifi" | "fast-4g" | "slow-4g" | "3g";

export interface FieldPerformanceSettings {
  /** 默认关闭；关闭后浏览器组合根必须停止全部性能观察器。 */
  enabled: boolean;
  /** 本次加载按冷缓存还是热缓存执行；由测试者在刷新前声明。 */
  cacheMode: FieldPerformanceCacheMode;
  /** 测试者声明的浏览器缩放比例；实际视口与 DPR 另行自动记录。 */
  zoomPercent: FieldPerformanceZoomPercent;
  /** 测试者声明的网络条件；应用不会主动测速，也不会上报该字段。 */
  networkProfile: FieldPerformanceNetworkProfile;
  /** 已保存在本机的完整采样会话数（不含尚未落盘的当前会话）。 */
  sessionCount: number;
  setEnabled(enabled: boolean): void;
  setCacheMode(mode: FieldPerformanceCacheMode): void;
  setZoomPercent(percent: FieldPerformanceZoomPercent): void;
  setNetworkProfile(profile: FieldPerformanceNetworkProfile): void;
  exportReport(): void;
  clearSessions(): void;
}
