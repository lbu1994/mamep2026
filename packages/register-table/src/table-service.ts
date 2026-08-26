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
  type ReadVerifySettings,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import { fail } from "@mamep2026/domain";
import {
  WriteVerifyCoordinator,
  type Clock,
  type CommunicationSession,
  type WriteOutcome,
} from "@mamep2026/communication";
import { parseCellText } from "@mamep2026/data-conversion";
import { computeSentAddress } from "./address";
import { applyReadValueToRow } from "./row-operations";

export interface TableServiceDeps {
  getSession: () => CommunicationSession | null;
  getAddressAdjustMode: () => "off" | "on";
  /** 时钟（写后回读延迟用，2026-08-26）：由调用方注入（测试用 Virtual Clock）。 */
  clock: Clock;
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

export class RegisterTableService {
  private readonly deps: TableServiceDeps;

  constructor(deps: TableServiceDeps) {
    this.deps = deps;
  }

  /** 单行读取：校验连接/地址/Address Adjust 后经统一调度器发送 FC03。 */
  async readRow(row: RegisterRow): Promise<Result<number>> {
    const session = this.deps.getSession();
    if (session === null) return fail(notConnectedError());
    const address = row.addressValue?.value;
    if (address === undefined) return fail(addressEmptyError());
    const sent = computeSentAddress(address, this.deps.getAddressAdjustMode());
    if (!sent.ok) return sent;
    return session.readRegister(sent.value, {
      source: "manual-read",
      userAddress: address,
    });
  }

  /** 读取成功后应用结果：按 Type 格式化并强制覆盖单元格文本（单一当前值模型）。 */
  applyReadResult(row: RegisterRow, raw: number): Result<RegisterRow> {
    return applyReadValueToRow(row, raw);
  }

  /**
   * 单行写入：校验连接/地址/输入值，转 16 位原始值后发送 FC0x10。
   * options.writeVerify（2026-08-26）：非 off 时经 WriteVerifyCoordinator 组合
   * 「写入 → 可选延迟 → FC03 回读 → 比较」，返回扩展的 WriteOutcome（§18.2）。
   */
  async writeRow(
    row: RegisterRow,
    options: { writeVerify?: ReadVerifySettings } = {},
  ): Promise<Result<WriteOutcome>> {
    const session = this.deps.getSession();
    if (session === null) return fail(notConnectedError());
    const address = row.addressValue?.value;
    if (address === undefined) return fail(addressEmptyError());
    const sent = computeSentAddress(address, this.deps.getAddressAdjustMode());
    if (!sent.ok) return sent;
    const parsed = parseCellText(row.cellText, row.dataType);
    if (!parsed.ok) return parsed;
    const writeVerify = options.writeVerify;
    if (writeVerify === undefined || writeVerify.mode === "off") {
      // 未启用回读：保持既有单次写入路径。
      return session.writeRegister(sent.value, parsed.value, {
        source: "manual-write",
        userAddress: address,
      });
    }
    const coordinator = new WriteVerifyCoordinator(
      session,
      this.deps.clock,
    );
    return coordinator.writeWithVerify(
      sent.value,
      parsed.value,
      writeVerify,
      { userAddress: address },
    );
  }

  /** 新建空行（供 UI 便捷调用）。 */
  static createRow(): RegisterRow {
    return createEmptyRow();
  }
}
