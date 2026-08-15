import { describe, expect, it } from "vitest";
import { COLUMN_MIN_WIDTHS, clampColumnWidth } from "./column-resize";

describe("clampColumnWidth", () => {
  it("keeps widths at or above the column minimum unchanged", () => {
    expect(clampColumnWidth("name", 200)).toBe(200);
    expect(clampColumnWidth("no", 40)).toBe(40);
    expect(clampColumnWidth("actions", 96)).toBe(96);
  });

  it("clamps widths below the column minimum up to the minimum", () => {
    expect(clampColumnWidth("name", 10)).toBe(COLUMN_MIN_WIDTHS["name"]);
    expect(clampColumnWidth("comment", 0)).toBe(COLUMN_MIN_WIDTHS["comment"]);
    expect(clampColumnWidth("no", 20)).toBe(COLUMN_MIN_WIDTHS["no"]);
    expect(clampColumnWidth("actions", 50)).toBe(COLUMN_MIN_WIDTHS["actions"]);
  });

  it("uses the fallback minimum for unknown column keys", () => {
    expect(clampColumnWidth("unknown", 10)).toBe(40);
    expect(clampColumnWidth("unknown", 120)).toBe(120);
  });

  it("supports an injected min-width table (for tests/customization)", () => {
    expect(clampColumnWidth("name", 50, { name: 100 })).toBe(100);
    expect(clampColumnWidth("name", 150, { name: 100 })).toBe(150);
    expect(clampColumnWidth("other", 50, { name: 100 })).toBe(50);
  });
});
