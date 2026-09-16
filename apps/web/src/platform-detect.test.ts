/**
 * 运行时平台探测测试（node 环境）。
 * 判定顺序必须与既有 App.tsx 行为一致：宿主桥优先，其次 Capacitor（避免宿主内嵌 WebView 误判）。
 */
import { describe, expect, it } from "vitest";
import type { MamepHostApi, VscodeHostApi } from "@mamep2026/platform-api";
import { detectAppPlatform } from "./platform-detect";

/** 桥只用于判别 platform（其余成员探测不读取），故测试桩只需该字段。 */
const vscodeBridge = { platform: "vscode" } as VscodeHostApi;
const electronBridge = { platform: "electron" } as MamepHostApi;
const androidGlobal = { Capacitor: { getPlatform: () => "android" } };

describe("detectAppPlatform", () => {
  it("宿主桥 platform=vscode → vscode", () => {
    expect(detectAppPlatform({ bridge: vscodeBridge, globalObject: {} })).toBe(
      "vscode",
    );
  });

  it("宿主桥 platform=electron → electron", () => {
    expect(
      detectAppPlatform({ bridge: electronBridge, globalObject: {} }),
    ).toBe("electron");
  });

  it("无宿主桥 + Capacitor 报 android → android", () => {
    expect(
      detectAppPlatform({ bridge: undefined, globalObject: androidGlobal }),
    ).toBe("android");
  });

  it("无宿主桥 + 无 Capacitor → browser", () => {
    expect(detectAppPlatform({ bridge: undefined, globalObject: {} })).toBe(
      "browser",
    );
  });

  it("无宿主桥 + Capacitor 报 web → browser（非 Android 容器）", () => {
    expect(
      detectAppPlatform({
        bridge: undefined,
        globalObject: { Capacitor: { getPlatform: () => "web" } },
      }),
    ).toBe("browser");
  });

  it("宿主桥优先于 Capacitor：宿主内的 Capacitor 不得把平台判成 android", () => {
    expect(
      detectAppPlatform({
        bridge: electronBridge,
        globalObject: androidGlobal,
      }),
    ).toBe("electron");
    expect(
      detectAppPlatform({ bridge: vscodeBridge, globalObject: androidGlobal }),
    ).toBe("vscode");
  });
});
