/**
 * 设备请求的不可变路由上下文。
 *
 * protocol 是实际会话协议标识：内置 Modbus RTU/TCP，或插件 codec ID。
 * unitAddress 在 RTU 中为从站地址，在 TCP 中为 MBAP Unit ID。
 */
import type { AddressTransformConfig } from "./workspace-model";

export interface RequestRoute {
  readonly unitAddress: number;
  readonly protocol: string;
  /** Electron TCP table configuration captured before crossing the host bridge. */
  readonly addressTransform?: AddressTransformConfig | null | undefined;
}

/** Copy nested scalar parameters before a task waits, retries or crosses a bridge. */
export function snapshotRequestRoute(route: RequestRoute): RequestRoute {
  const config = route.addressTransform;
  return Object.freeze({
    ...route,
    ...(config !== undefined
      ? {
          addressTransform:
            config === null
              ? null
              : Object.freeze({
                  ...config,
                  ...(config.parameters !== undefined
                    ? { parameters: Object.freeze({ ...config.parameters }) }
                    : {}),
                }),
        }
      : {}),
  });
}
