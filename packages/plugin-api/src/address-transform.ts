/**
 * 地址变换注册表（插件）。
 *
 * addressTransform 贡献点 payload 为声明式数据（id/protocol/titleKey/defaultConfig，
 * 可 JSON 序列化）；`apply`/`validate` 是函数，不能进 payload，由插件 `activate`
 * 时经本注册表注册（仿 codec 注册模式）。核心开箱即用的内置变换
 * `builtin.address-adjust`（发送地址 = 用户地址 − 1）的逻辑定义于 register-table/address.ts，
 * 由应用装配点
 * （apps/web App.tsx）注册进本注册表。
 */
import {
  createMamepError,
  fail,
  ok,
  type AddressTransform,
  type Result,
} from "@mamep2026/domain";

export interface AddressTransformRegistry {
  /** 注册运行时地址变换；同 id 重复注册返回错误（不覆盖）。 */
  register(transform: AddressTransform): Result<void>;
  /** 按 id 取变换；未注册返回 undefined。 */
  get(id: string): AddressTransform | undefined;
  /** 全部已注册变换（注册顺序）。 */
  list(): AddressTransform[];
}

/** 建注册表（Map 存储，注册顺序保留）。 */
export function createAddressTransformRegistry(): AddressTransformRegistry {
  const transforms = new Map<string, AddressTransform>();
  return {
    register(transform) {
      if (transforms.has(transform.id)) {
        return fail(
          createMamepError({
            code: "PLUGIN_TRANSFORM_ALREADY_REGISTERED",
            category: "plugin",
            severity: "error",
            retryable: false,
            userMessageKey: "plugins.transformAlreadyRegistered",
            technicalMessage: `address transform already registered: ${transform.id}`,
          }),
        );
      }
      transforms.set(transform.id, transform);
      return ok(undefined);
    },
    get(id) {
      return transforms.get(id);
    },
    list() {
      return [...transforms.values()];
    },
  };
}
