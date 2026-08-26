/**
 * MOCK 模拟设备的行为场景（dev-only，生产构建不启用）。
 *
 * 本模块是「地址区间 → 读写行为」与「默认表预填（Name/Comment）」的单一数据源：
 * 传输行为与默认表预填共用同一组 DEFAULT_MOCK_SCENARIOS，避免地址/说明漂移。
 *
 * 行为语义（docs/AGENTS.md §10）：异常响应帧为 slave + fc|0x80 + exceptionCode + crc，共 5 字节；
 * 异常码复用 protocol-modbus 常量（EXCEPTION_ILLEGAL_FUNCTION / _DATA_ADDRESS / _DATA_VALUE），
 * 不硬编码魔法数字。
 */
import type { RegisterRow } from "@mamep2026/domain";
import { createEmptyRow, RegisterAddress } from "@mamep2026/domain";
import {
  EXCEPTION_ILLEGAL_DATA_ADDRESS,
  EXCEPTION_ILLEGAL_FUNCTION,
} from "@mamep2026/protocol-modbus";

/** 单个操作（读或写）的模拟行为。 */
export type MockOpBehavior =
  /** 正常：返回成功响应 */
  | { kind: "normal" }
  /** 返回指定 Modbus 异常码 */
  | { kind: "exception"; exceptionCode: number }
  /** 写行为专用：value ≤ maxValue 成功，超出返回异常 0x03；读按正常处理 */
  | { kind: "write-value-gate"; maxValue: number }
  /** 写行为专用：回执成功但**不实际写入**（模拟「写不生效」——回读仍为旧值）；读按正常处理 */
  | { kind: "write-ignore" }
  /** 不回任何帧（供测试请求超时/重试路径） */
  | { kind: "no-response" };

/** 地址区间 → 读写行为规则。 */
export interface MockRangeRule {
  /** 起始地址（含） */
  start: number;
  /** 结束地址（含）；start === end 表示精确地址 */
  end: number;
  /** FC03 读行为 */
  read: MockOpBehavior;
  /** FC0x10 写行为 */
  write: MockOpBehavior;
}

/** 完整场景定义：规则 + 默认表预填的展示信息。 */
export interface MockScenario extends MockRangeRule {
  /** 默认表预填行 Name 前缀（行名 = `${namePrefix}_${NN}`） */
  namePrefix: string;
  /** 默认表预填行 Comment（中文说明预期行为） */
  comment: string;
  /** 默认表预填行数（须 ≤ 区间长度） */
  seedRows: number;
}

/** 默认场景（按地址区间区分成功/失败路径，供 E2E 与手动测试）。 */
export const DEFAULT_MOCK_SCENARIOS: readonly MockScenario[] = [
  {
    start: 0x0000,
    end: 0x000f,
    read: { kind: "normal" },
    write: { kind: "normal" },
    namePrefix: "Normal",
    comment: "正常区：读/写均成功",
    seedRows: 3,
  },
  {
    start: 0x0100,
    end: 0x010f,
    read: { kind: "normal" },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
    namePrefix: "ReadOnly",
    comment: "只读区：读成功；写返回异常 0x02（非法数据地址）",
    seedRows: 3,
  },
  {
    start: 0x0200,
    end: 0x020f,
    read: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
    write: { kind: "normal" },
    namePrefix: "WriteOnly",
    comment: "只写区：写成功；读返回异常 0x02（非法数据地址）",
    seedRows: 3,
  },
  {
    start: 0x0300,
    end: 0x030f,
    read: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_DATA_ADDRESS },
    namePrefix: "NotExist",
    comment:
      "寄存器不存在：读/写均返回异常 0x02（同一区间覆盖「读失败」与「写失败」两类测试场景）",
    seedRows: 4,
  },
  {
    start: 0x0400,
    end: 0x040f,
    read: { kind: "normal" },
    write: { kind: "write-value-gate", maxValue: 0x7fff },
    namePrefix: "BadValue",
    comment:
      "非法数据值：读成功；写入值须 ≤ 32767（0x7FFF），超出返回异常 0x03",
    seedRows: 3,
  },
  {
    start: 0x0500,
    end: 0x050f,
    read: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_FUNCTION },
    write: { kind: "exception", exceptionCode: EXCEPTION_ILLEGAL_FUNCTION },
    namePrefix: "IllegalFunc",
    comment: "不支持功能：读/写均返回异常 0x01（非法功能）",
    seedRows: 2,
  },
  {
    start: 0x0600,
    end: 0x060f,
    read: { kind: "no-response" },
    write: { kind: "no-response" },
    namePrefix: "NoResponse",
    comment: "设备无响应：读/写均不回帧（触发请求超时/重试路径）",
    seedRows: 2,
  },
  {
    start: 0x0900,
    end: 0x090f,
    read: { kind: "normal" },
    write: { kind: "write-ignore" },
    namePrefix: "WriteIgnore",
    comment:
      "写忽略区：读/写均回执成功，但写入不落盘（回读仍为旧值）——用于写后回读（Verify）校验",
    seedRows: 2,
  },
];

/** 传输层使用的默认规则（与默认场景同一数据源）。 */
export const DEFAULT_MOCK_RULES: readonly MockRangeRule[] =
  DEFAULT_MOCK_SCENARIOS.map(({ start, end, read, write }) => ({
    start,
    end,
    read,
    write,
  }));

/** 命中地址所在规则（顺序匹配，第一条命中生效）；未配置返回 null（回退正常行为）。 */
export function matchMockRule(
  rules: readonly MockRangeRule[],
  address: number,
): MockRangeRule | null {
  for (const rule of rules) {
    if (address >= rule.start && address <= rule.end) return rule;
  }
  return null;
}

/**
 * 生成默认表预填的分类寄存器行（Name/Comment 已注释）。
 * - 地址文本用 DEC（与默认表 registerRadix=dec 一致，ADR-014）；
 * - addressDraft/addressValue 通过 domain 工厂与值对象创建，保证合法一致；
 * - order 从 1 连续编号（与 renumberRows 惯例一致）。
 */
export function createMockScenarioRows(): RegisterRow[] {
  const rows: RegisterRow[] = [];
  let order = 1;
  for (const scenario of DEFAULT_MOCK_SCENARIOS) {
    for (let i = 0; i < scenario.seedRows; i += 1) {
      const address = scenario.start + i;
      const row = createEmptyRow();
      row.order = order;
      row.name = `${scenario.namePrefix}_${String(i + 1).padStart(2, "0")}`;
      row.comment = scenario.comment;
      row.addressDraft = String(address);
      const addressResult = RegisterAddress.create(address);
      if (addressResult.ok) row.addressValue = addressResult.value;
      rows.push(row);
      order += 1;
    }
  }
  return rows;
}
