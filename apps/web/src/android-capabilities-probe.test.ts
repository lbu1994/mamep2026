/**
 * Android 宿主能力解析单测。
 * 探测端口注入：成功 / 失败 / 抛错三态 + 不误改其他能力字段。
 */
import { describe, expect, it, vi } from "vitest";
import { androidCapabilities } from "@mamep2026/platform-android";
import { resolveAndroidHostCapabilities } from "./android-capabilities-probe";

describe("resolveAndroidHostCapabilities（ADR-056）", () => {
  it("探测可用 → executablePlugins:true，其余能力与基础常量一致", async () => {
    const probe = vi.fn(async () => true);

    const resolved = await resolveAndroidHostCapabilities(probe);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(resolved.executablePlugins).toBe(true);
    expect({ ...resolved, executablePlugins: false }).toEqual({
      ...androidCapabilities,
    });
    // Android 插件安装入口可用（WebView 文件选择器）。
    expect(resolved.pluginInstall).toBe("upload");
  });

  it("探测不可用 → 如实保持 false（fail-closed）", async () => {
    const resolved = await resolveAndroidHostCapabilities(async () => false);

    expect(resolved.executablePlugins).toBe(false);
    expect(resolved.pluginInstall).toBe("upload");
  });

  it("探测抛错 → 按不可用处理，不阻断装配", async () => {
    const resolved = await resolveAndroidHostCapabilities(async () => {
      throw new Error("WebView kernel boom");
    });

    expect(resolved.executablePlugins).toBe(false);
  });
});
