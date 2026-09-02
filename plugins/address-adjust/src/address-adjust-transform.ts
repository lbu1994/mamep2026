/**
 * Address Adjust 地址变换（2026-09-02，插件外部化：自 packages/register-table/src/address.ts 移出）。
 * 保留现名（用户决策 2026-09-02）：transformId "builtin.address-adjust" 不变（工作区数据零迁移）。
 * 语义：ON 时发送地址 = 用户地址 − 1，0 下溢报错（ADR-042 决策）。
 */
import {
  BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID,
  createMamepError,
  fail,
  ok,
  type AddressTransform,
} from "@mamep2026/domain";

/** 表级 Address Adjust 变换（发送 = 用户 − 1，0 下溢报错）。 */
export const ADDRESS_ADJUST_TRANSFORM: AddressTransform = {
  id: BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID,
  protocol: "rtu",
  titleKey: "table.addressAdjust",
  defaultConfig: { enabled: false },
  apply(userAddress) {
    if (userAddress === 0) {
      return fail(
        createMamepError({
          code: "ADDRESS_ADJUST_UNDERFLOW",
          category: "validation",
          userMessageKey: "errors.addressAdjustUnderflow",
          technicalMessage: "address 0 cannot be adjusted by -1",
        }),
      );
    }
    return ok(userAddress - 1);
  },
  validate(userAddress) {
    if (userAddress === 0) {
      return fail(
        createMamepError({
          code: "ADDRESS_ADJUST_UNDERFLOW",
          category: "validation",
          userMessageKey: "errors.addressAdjustUnderflow",
          technicalMessage: "address 0 cannot be adjusted by -1",
        }),
      );
    }
    return ok(null);
  },
};

/** 解析 Address Adjust 变换（按 id）；未知 id 返回 null。 */
export function resolveAddressAdjustTransform(
  transformId: string,
): AddressTransform | null {
  return transformId === BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID
    ? ADDRESS_ADJUST_TRANSFORM
    : null;
}

/** 运行时解析器（供会话/host 注入，与插件 AddressTransformRegistry 一致）。 */
export function createAddressAdjustResolver(): (
  transformId: string,
) => AddressTransform | null {
  return (transformId) => resolveAddressAdjustTransform(transformId);
}
