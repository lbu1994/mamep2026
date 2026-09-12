import { describe, expect, it } from "vitest";
import {
  checkCompatibility,
  PLUGIN_VERSION_INCOMPATIBLE,
} from "./compatibility";
import { PLUGIN_API_VERSION } from "./manifest";

describe("compatibility（ADR-039：apiVersion 三级判定）", () => {
  it("完全匹配 → loadable", () => {
    expect(checkCompatibility(PLUGIN_API_VERSION).verdict).toBe("loadable");
  });

  it("同 major 不同 minor → loadable-warning（带原因）", () => {
    // 与宿主同 major、minor 不同（版本号无关写法，避免随 PLUGIN_API_VERSION 升级失效）。
    const major = PLUGIN_API_VERSION.split(".")[0] ?? "1";
    const result = checkCompatibility(`${major}.99`);
    expect(result.verdict).toBe("loadable-warning");
    expect(result.reason).toBeTruthy();
  });

  it("不同 major → forbidden（带原因）", () => {
    const major = Number.parseInt(PLUGIN_API_VERSION.split(".")[0] ?? "1", 10);
    const result = checkCompatibility(`${major + 1}.0`);
    expect(result.verdict).toBe("forbidden");
    expect(result.reason).toBeTruthy();
  });

  it("非数字版本解析兜底（视为 major 0）→ forbidden", () => {
    expect(checkCompatibility("bogus").verdict).toBe("forbidden");
  });

  it("PLUGIN_VERSION_INCOMPATIBLE 错误码恒定", () => {
    expect(PLUGIN_VERSION_INCOMPATIBLE).toBe("PLUGIN_VERSION_INCOMPATIBLE");
  });
});
