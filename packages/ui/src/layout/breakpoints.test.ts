import { describe, expect, it } from "vitest";
import {
  MOBILE_LAYOUT_MAX_WIDTH,
  MOBILE_LAYOUT_MEDIA_QUERY,
} from "./breakpoints";

describe("移动布局断点（ADR-050 Phase 3）", () => {
  it("阈值为 1023（即 < 1024px 视为移动布局）", () => {
    expect(MOBILE_LAYOUT_MAX_WIDTH).toBe(1023);
    expect(MOBILE_LAYOUT_MEDIA_QUERY).toBe("(max-width: 1023px)");
  });

  it("媒体查询字符串与阈值同源（避免手写数值漂移）", () => {
    expect(MOBILE_LAYOUT_MEDIA_QUERY).toContain(
      String(MOBILE_LAYOUT_MAX_WIDTH),
    );
  });
});
