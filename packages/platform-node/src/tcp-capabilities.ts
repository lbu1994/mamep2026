/**
 * Node TCP Adapter 能力描述（docs/TECH_DESIGN.md §34.3.18 模式）。
 * 只用于 UI 展示与配置校验，不得绕过真实打开结果：即使声明支持某特性，
 * 具体网络/设备仍可能拒绝，连接流程必须处理实际失败。
 */
export interface NodeTcpCapabilities {
  readonly host: "node";
  readonly library: string;
  readonly libraryVersion: string;
  readonly ipv4: boolean;
  readonly ipv6: boolean;
  readonly tls: boolean;
  /** MBAP 单元标识范围（用户决策：0~255 全范围）。 */
  readonly unitIdMin: number;
  readonly unitIdMax: number;
  readonly portRange: readonly [number, number];
}

export interface DescribeNodeTcpCapabilitiesOptions {
  readonly libraryVersion?: string | undefined;
}

/**
 * 描述 Node TCP Adapter 能力。libraryVersion 由调用方注入（生产接线时传入
 * process.versions.node）；默认值用于纯测试。
 */
export function describeNodeTcpCapabilities(
  options: DescribeNodeTcpCapabilitiesOptions = {},
): NodeTcpCapabilities {
  return {
    host: "node",
    library: "node:net",
    libraryVersion: options.libraryVersion ?? "unknown",
    ipv4: true,
    ipv6: true,
    tls: false,
    unitIdMin: 0,
    unitIdMax: 255,
    portRange: Object.freeze([1, 65535]),
  };
}
