import { describe, expect, it } from "vitest";
import { defaultConfig, RegisterAddress } from "@mamep2026/domain";
import {
  createMockScenarioRows,
  DEFAULT_MOCK_RULES,
  DEFAULT_MOCK_SCENARIOS,
  matchMockRule,
  type MockRangeRule,
} from "./mock-scenarios";

describe("DEFAULT_MOCK_SCENARIOS 默认场景定义", () => {
  it("各场景地址区间互不重叠且按序递增", () => {
    const sorted = [...DEFAULT_MOCK_SCENARIOS].sort(
      (a, b) => a.start - b.start,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev === undefined || cur === undefined) continue;
      expect(prev.end).toBeLessThan(cur.start);
    }
  });

  it("每个场景 seedRows 至少 2 行且不超过区间长度", () => {
    for (const scenario of DEFAULT_MOCK_SCENARIOS) {
      expect(scenario.seedRows).toBeGreaterThanOrEqual(2);
      expect(scenario.seedRows).toBeLessThanOrEqual(
        scenario.end - scenario.start + 1,
      );
    }
  });

  it("总预填行数不超过默认表行数（defaultRowCount）", () => {
    const total = DEFAULT_MOCK_SCENARIOS.reduce(
      (sum, scenario) => sum + scenario.seedRows,
      0,
    );
    expect(total).toBeLessThanOrEqual(
      defaultConfig.registerTable.defaultRowCount,
    );
  });

  it("DEFAULT_MOCK_RULES 与场景的地址/行为一一对应", () => {
    expect(DEFAULT_MOCK_RULES).toHaveLength(DEFAULT_MOCK_SCENARIOS.length);
    DEFAULT_MOCK_RULES.forEach((rule, index) => {
      const scenario = DEFAULT_MOCK_SCENARIOS[index];
      if (scenario === undefined) return;
      expect(rule.start).toBe(scenario.start);
      expect(rule.end).toBe(scenario.end);
      expect(rule.read).toEqual(scenario.read);
      expect(rule.write).toEqual(scenario.write);
    });
  });
});

describe("matchMockRule", () => {
  const rules: readonly MockRangeRule[] = [
    {
      start: 0x0100,
      end: 0x0100,
      read: { kind: "exception", exceptionCode: 0x02 },
      write: { kind: "normal" },
    },
    {
      start: 0x0200,
      end: 0x020f,
      read: { kind: "normal" },
      write: { kind: "normal" },
    },
  ];

  it("命中精确地址（start === end）", () => {
    expect(matchMockRule(rules, 0x0100)?.start).toBe(0x0100);
  });

  it("命中连续区间边界（start 与 end 均命中）", () => {
    expect(matchMockRule(rules, 0x0200)?.start).toBe(0x0200);
    expect(matchMockRule(rules, 0x020f)?.start).toBe(0x0200);
    expect(matchMockRule(rules, 0x0208)?.start).toBe(0x0200);
  });

  it("区间外相邻地址不命中（回退正常行为）", () => {
    expect(matchMockRule(rules, 0x00ff)).toBeNull();
    expect(matchMockRule(rules, 0x0101)).toBeNull();
    expect(matchMockRule(rules, 0x0210)).toBeNull();
  });

  it("顺序匹配，第一条命中的规则生效", () => {
    const overlapping: readonly MockRangeRule[] = [
      {
        start: 0x0000,
        end: 0x00ff,
        read: { kind: "exception", exceptionCode: 0x01 },
        write: { kind: "normal" },
      },
      {
        start: 0x0000,
        end: 0x00ff,
        read: { kind: "exception", exceptionCode: 0x02 },
        write: { kind: "normal" },
      },
    ];
    expect(matchMockRule(overlapping, 0x0050)?.read).toEqual({
      kind: "exception",
      exceptionCode: 0x01,
    });
  });
});

describe("createMockScenarioRows 默认表预填", () => {
  it("生成行数等于各场景 seedRows 之和", () => {
    const rows = createMockScenarioRows();
    const total = DEFAULT_MOCK_SCENARIOS.reduce(
      (sum, scenario) => sum + scenario.seedRows,
      0,
    );
    expect(rows).toHaveLength(total);
  });

  it("每行 order 从 1 连续编号、rowId 唯一", () => {
    const rows = createMockScenarioRows();
    expect(rows.map((row) => row.order)).toEqual(
      Array.from({ length: rows.length }, (_, i) => i + 1),
    );
    expect(new Set(rows.map((row) => row.rowId)).size).toBe(rows.length);
  });

  it("每行有合法地址（addressValue 与 DEC addressDraft 一致）且 Name/Comment 非空", () => {
    const rows = createMockScenarioRows();
    for (const row of rows) {
      expect(row.name).not.toBe("");
      expect(row.comment).not.toBe("");
      expect(row.addressValue).not.toBeNull();
      const address = row.addressValue?.value;
      expect(address).not.toBeUndefined();
      expect(String(address)).toBe(row.addressDraft);
      expect(RegisterAddress.create(address as number).ok).toBe(true);
      expect(row.pollingEnabled).toBe(false);
      expect(row.traceEnabled).toBe(false);
    }
  });

  it("预填地址与默认场景区间一致（供 E2E 按 Name 定位行为）", () => {
    const rows = createMockScenarioRows();
    const normal = rows.filter((row) => row.name.startsWith("Normal_"));
    expect(normal.map((row) => row.addressValue?.value)).toEqual([
      0x0000, 0x0001, 0x0002,
    ]);
    const notExist = rows.filter((row) => row.name.startsWith("NotExist_"));
    expect(notExist.map((row) => row.addressValue?.value)).toEqual([
      0x0300, 0x0301, 0x0302, 0x0303,
    ]);
  });
});
