/**
 * 数据类型注册表（ADR-043 E-3）。
 *
 * dataType 贡献点 payload 为声明式数据（id/titleKey，可 JSON 序列化）；
 * `parse`/`format` 是函数，不能进 payload，由插件 `activate` 时经本注册表注册
 * （仿 AddressTransformRegistry 模式，ADR-042）。范围收敛：仅单寄存器插件类型。
 */
import {
  createMamepError,
  fail,
  ok,
  type Result,
} from "@mamep2026/domain";

/** 插件数据类型运行时处理函数（单寄存器：registerCount 恒 1）。 */
export interface PluginDataTypeHandlers {
  /** 解析单元格文本为 16 位原始值（0..65535）。 */
  parse(text: string): Result<number>;
  /** 格式化原始值为单元格显示文本。 */
  format(raw: number): string;
}

export interface DataTypeRegistry {
  /** 注册运行时处理函数；同 id 重复注册返回错误（不覆盖）。 */
  register(id: string, handlers: PluginDataTypeHandlers): Result<void>;
  /** 按 id 取处理函数；未注册返回 undefined。 */
  get(id: string): PluginDataTypeHandlers | undefined;
  /** 全部已注册插件类型 id（注册顺序）。 */
  list(): string[];
}

/** 建注册表（Map 存储，注册顺序保留）。 */
export function createDataTypeRegistry(): DataTypeRegistry {
  const types = new Map<string, PluginDataTypeHandlers>();
  return {
    register(id, handlers) {
      if (types.has(id)) {
        return fail(
          createMamepError({
            code: "PLUGIN_DATA_TYPE_ALREADY_REGISTERED",
            category: "plugin",
            severity: "error",
            retryable: false,
            userMessageKey: "plugins.dataTypeAlreadyRegistered",
            technicalMessage: `data type already registered: ${id}`,
          }),
        );
      }
      types.set(id, handlers);
      return ok(undefined);
    },
    get(id) {
      return types.get(id);
    },
    list() {
      return Array.from(types.keys());
    },
  };
}
