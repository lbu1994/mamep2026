/**
 * 寄存器表应用服务（docs/TECH_DESIGN.md §6.8、docs/AGENTS.md §17/§18）。
 * - 读写编排走统一调度器（session 内部）；
 * - 读取成功后按 Type 强制覆盖单元格文本；读取失败不改变单元格内容；
 * - 写入前按 Type 校验并转换为 16 位原始值；失败保留用户输入；
 * - Address Adjust 在发送前应用，日志记录用户地址与发送地址。
 */
import {
  createEmptyRow,
  createMamepError,
  type AddressTransform,
  type ReadVerifySettings,
  type RegisterRow,
  type RequestRoute,
  type Result,
} from "@mamep2026/domain";
import { fail } from "@mamep2026/domain";
import {
  WriteVerifyCoordinator,
  type Clock,
  type CommunicationSession,
  type WriteOutcome,
} from "@mamep2026/communication";
import {
  createDataTypeResolver,
  parseCompositeText,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";
import { applyAddressTransform } from "./address";
import { applyReadValueToRow, applyReadValuesToRow } from "./row-operations";

export interface TableServiceDeps {
  getSession: () => CommunicationSession | null;
  /**
   * 活动表配置解析出的地址变换：null=不调整；
   * ON（内置 builtin.address-adjust）时发送地址 = 用户地址 − 1。
   */
  getAddressTransform: () => AddressTransform | null;
  /** 时钟（写后回读延迟用）：由调用方注入（测试用 Virtual Clock）。 */
  clock: Clock;
  /** 数据类型解析器：缺省仅内置；插件类型由 UI 装配点注入。 */
  dataTypeResolver?: DataTypeResolver;
}

function notConnectedError() {
  return createMamepError({
    code: "CONNECTION_NOT_CONNECTED",
    category: "connection",
    userMessageKey: "errors.notConnected",
    technicalMessage: "no active connection",
  });
}

function addressEmptyError() {
  return createMamepError({
    code: "REGISTER_ADDRESS_EMPTY",
    category: "validation",
    userMessageKey: "errors.registerAddressEmpty",
    technicalMessage: "register address is empty",
  });
}

/** 模块级缺省解析器（仅内置插件类型由 UI 装配点注入）。 */
const defaultResolver: DataTypeResolver = createDataTypeResolver();

export class RegisterTableService {
  private readonly deps: TableServiceDeps;

  constructor(deps: TableServiceDeps) {
    this.deps = deps;
  }

  /** 单行读取（多寄存器行一次 FC03 读全部）：校验连接/地址/地址变换后经统一调度器。 */
  async readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    const session = this.deps.getSession();
    if (session === null) return fail(notConnectedError());
    const address = row.addressValue?.value;
    if (address === undefined) return fail(addressEmptyError());
    const sent = applyAddressTransform(
      address,
      this.deps.getAddressTransform(),
    );
    if (!sent.ok) return sent;
    if (row.registerCount > 1) {
      return session.readRegisters(sent.value, row.registerCount, {
        source: "manual-read",
        userAddress: address,
        ...(route !== undefined ? { route } : {}),
      });
    }
    return session.readRegister(sent.value, {
      source: "manual-read",
      userAddress: address,
      ...(route !== undefined ? { route } : {}),
    });
  }

  /** 读取成功后应用结果（多寄存器按组合类型格式化）：覆盖单元格文本（单一当前值模型）。 */
  applyReadResult(
    row: RegisterRow,
    raw: number | number[],
  ): Result<RegisterRow> {
    return Array.isArray(raw)
      ? applyReadValuesToRow(row, raw)
      : applyReadValueToRow(row, raw);
  }

  /**
   * 单行写入：校验连接/地址/输入值，转 16 位原始值后发送 FC0x10。
   * options.writeVerify：非 off 时经 WriteVerifyCoordinator 组合
   * 「写入 → 可选延迟 → FC03 回读 → 比较」，返回扩展的 WriteOutcome（§18.2）。
   */
  async writeRow(
    row: RegisterRow,
    options: { writeVerify?: ReadVerifySettings } = {},
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    const session = this.deps.getSession();
    if (session === null) return fail(notConnectedError());
    const address = row.addressValue?.value;
    if (address === undefined) return fail(addressEmptyError());
    const sent = applyAddressTransform(
      address,
      this.deps.getAddressTransform(),
    );
    if (!sent.ok) return sent;
    const writeVerify = options.writeVerify;

    // 多寄存器行：组合值一次 FC0x10 写全部连续寄存器。
    if (row.registerCount > 1) {
      const parsed = parseCompositeText(
        row.cellText,
        row.dataType,
        row.registerCount,
      );
      if (!parsed.ok) return parsed;
      const values = parsed.value;
      if (writeVerify === undefined || writeVerify.mode === "off") {
        return session.writeRegisters(sent.value, values, {
          source: "manual-write",
          userAddress: address,
          ...(route !== undefined ? { route } : {}),
        });
      }
      const coordinator = new WriteVerifyCoordinator(session, this.deps.clock);
      return coordinator.writeWithVerifyMany(sent.value, values, writeVerify, {
        userAddress: address,
        ...(route !== undefined ? { route } : {}),
      });
    }

    const parsed = (this.deps.dataTypeResolver ?? defaultResolver).parse(
      row.cellText,
      row.dataType,
    );
    if (!parsed.ok) return parsed;
    if (writeVerify === undefined || writeVerify.mode === "off") {
      // 未启用回读：保持既有单次写入路径。
      return session.writeRegister(sent.value, parsed.value, {
        source: "manual-write",
        userAddress: address,
        ...(route !== undefined ? { route } : {}),
      });
    }
    const coordinator = new WriteVerifyCoordinator(session, this.deps.clock);
    return coordinator.writeWithVerify(sent.value, parsed.value, writeVerify, {
      userAddress: address,
      ...(route !== undefined ? { route } : {}),
    });
  }

  /** 新建空行（供 UI 便捷调用）。 */
  static createRow(): RegisterRow {
    return createEmptyRow();
  }
}
