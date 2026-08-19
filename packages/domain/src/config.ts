/**
 * 集中默认配置（docs/AGENTS.md §42）。
 * 禁止在组件、Host 或 Adapter 中散落硬编码默认值。
 */
export const defaultConfig = {
  rtu: {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off",
    requestTimeoutMs: 1000,
    retryCount: 1,
    /** Rx Delay：请求间隔，兼作 WP 轮询间隔（ADR-013） */
    interRequestDelayMs: 50,
    /** Address Adjust：默认 OFF（ON 时发送地址 = 用户地址 − 1） */
    addressAdjust: "off",
  },
  registerTable: {
    /** Register 地址列进制：默认 DEC（按表独立，ADR-014） */
    addressRadix: "dec",
    /** Slave Address 默认值：1（按表独立设置，2026-08-19） */
    slaveAddress: 1,
    /** 新建寄存器表默认填充的行数（2026-08-15） */
    defaultRowCount: 50,
  },
  polling: {
    /** 每行最多一个等待中的轮询任务（内部值，不提供用户配置） */
    maxPendingPollingTasks: 1,
  },
  logging: {
    maxCommunicationLogEntries: 10000,
    maxApplicationMessages: 2000,
  },
  autosave: {
    debounceMs: 500,
  },
  trace: {
    /** Buffer Size = Continue 时的环形缓冲区硬上限 */
    maxContinueEntries: 10000,
    /** Speed 滑块映射的采样间隔范围（Quick..Slow） */
    speedMinMs: 100,
    speedMaxMs: 2000,
  },
} as const;

export type DefaultConfig = typeof defaultConfig;
