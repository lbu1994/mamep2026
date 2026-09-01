/**
 * 数据类型解析器（ADR-043 E-3）：内置类型 + 插件类型（单寄存器）。
 *
 * 内置实现复用 data-types.ts / multi-register.ts（builtin 契约）；插件类型由调用方
 * 经 `register` 注入（函数不进贡献点 payload，仿 AddressTransformRegistry/CodecRegistry 模式，
 * 插件 activate 时注册）。register-table / ui 的单元格解析、读取格式化、寄存器数校验
 * 经本解析器转发（缺省 = 仅内置）。
 */
import {
  createMamepError,
  fail,
  isBuiltinDataType,
  ok,
  type Result,
} from "@mamep2026/domain";
import { formatRawValue, parseCellText } from "./data-types";
import {
  allowedRegisterCounts,
  isValidRegisterCount,
} from "./multi-register";

/** 插件数据类型解析处理函数（ADR-043 E-3 范围收敛：仅单寄存器插件类型）。 */
export interface PluginDataTypeHandlers {
  /** 解析单元格文本为 16 位原始值（0..65535）。 */
  parse(text: string): Result<number>;
  /** 格式化原始值为单元格显示文本。 */
  format(raw: number): string;
}

export interface DataTypeResolver {
  /** 解析单元格文本（内置 + 已注册插件类型）。 */
  parse(text: string, type: string): Result<number>;
  /** 格式化原始值（未注册插件类型回退 hex，避免读取路径崩溃）。 */
  format(raw: number, type: string): string;
  /** 类型允许的寄存器数（插件类型恒 [1]）。 */
  registerCounts(type: string): readonly number[] | "any";
  /** 校验范围长度 × 类型合法集。 */
  isValidRegisterCount(type: string, count: number): boolean;
  /** 类型是否已知（内置或已注册插件）。 */
  isKnown(type: string): boolean;
  /** 注册插件类型处理函数；同 id 重复注册返回错误（不覆盖）。 */
  register(type: string, handlers: PluginDataTypeHandlers): Result<void>;
  /** 全部已注册插件类型 id。 */
  list(): string[];
}

function unsupportedTypeError(type: string) {
  return createMamepError({
    code: "DATA_UNSUPPORTED_TYPE",
    category: "validation",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.internal",
    technicalMessage: `unsupported data type: ${type}`,
  });
}

function alreadyRegisteredError(type: string) {
  return createMamepError({
    code: "PLUGIN_DATA_TYPE_ALREADY_REGISTERED",
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey: "plugins.dataTypeAlreadyRegistered",
    technicalMessage: `data type already registered: ${type}`,
  });
}

/** 建解析器（内置 + 插件注册，Map 存储保留注册顺序）。 */
export function createDataTypeResolver(): DataTypeResolver {
  const plugins = new Map<string, PluginDataTypeHandlers>();
  return {
    parse(text, type) {
      if (isBuiltinDataType(type)) return parseCellText(text, type);
      const handlers = plugins.get(type);
      if (handlers === undefined) return fail(unsupportedTypeError(type));
      return handlers.parse(text);
    },
    format(raw, type) {
      if (isBuiltinDataType(type)) return formatRawValue(raw, type);
      const handlers = plugins.get(type);
      if (handlers === undefined) return formatRawValue(raw, "hex");
      return handlers.format(raw);
    },
    registerCounts(type) {
      if (isBuiltinDataType(type)) return allowedRegisterCounts(type);
      return [1];
    },
    isValidRegisterCount(type, count) {
      if (isBuiltinDataType(type)) return isValidRegisterCount(type, count);
      return count === 1;
    },
    isKnown(type) {
      return isBuiltinDataType(type) || plugins.has(type);
    },
    register(type, handlers) {
      if (plugins.has(type)) return fail(alreadyRegisteredError(type));
      plugins.set(type, handlers);
      return ok(undefined);
    },
    list() {
      return Array.from(plugins.keys());
    },
  };
}
