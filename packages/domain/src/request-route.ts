/**
 * 设备请求的不可变路由上下文。
 *
 * protocol 是实际会话协议标识：内置 Modbus RTU/TCP，或插件 codec ID。
 * unitAddress 在 RTU 中为从站地址，在 TCP 中为 MBAP Unit ID。
 */
export interface RequestRoute {
  readonly unitAddress: number;
  readonly protocol: string;
}
