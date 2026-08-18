import { describe, expect, it } from "vitest";
import { applyColumnOrder } from "./column-order";

interface Col {
  key: string;
  title: string;
}

const base: Col[] = [
  { key: "no", title: "No" },
  { key: "name", title: "Name" },
  { key: "data", title: "Data" },
];

describe("applyColumnOrder", () => {
  it("null 或空数组返回默认（传入）顺序", () => {
    expect(applyColumnOrder(base, null)).toEqual(base);
    expect(applyColumnOrder(base, [])).toEqual(base);
  });

  it("按 order 重排列", () => {
    expect(
      applyColumnOrder(base, ["data", "no", "name"]).map((c) => c.key),
    ).toEqual(["data", "no", "name"]);
  });

  it("order 引用不存在的 key 时忽略，不影响其余顺序", () => {
    expect(applyColumnOrder(base, ["ghost", "name"]).map((c) => c.key)).toEqual(
      ["name", "no", "data"],
    );
  });

  it("base 中 order 未覆盖的列追加到末尾（新增列自动落尾）", () => {
    const extended: Col[] = [...base, { key: "type", title: "Type" }];
    expect(
      applyColumnOrder(extended, ["data", "name"]).map((c) => c.key),
    ).toEqual(["data", "name", "no", "type"]);
  });

  it("返回新数组，不原地修改 base", () => {
    const result = applyColumnOrder(base, null);
    expect(result).not.toBe(base);
    expect(result).toEqual(base);
  });
});
