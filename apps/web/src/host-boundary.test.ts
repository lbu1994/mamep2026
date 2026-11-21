/**
 * 平台 Host 运行时边界：默认加载器按探测结果只打开目标平台工厂。
 *
 * 本测试刻意不注入 `loadHostFactory`，而是 mock 各工厂模块以观察真实动态 import
 * 路径。浏览器工厂是 Electron / Android 共享的静态 inner 路径，允许在所有平台加载；
 * Electron / VSCode / Android 三个平台工厂之间必须互斥。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppPlatformName } from "./platform-detect";

type HostModuleName = "browser" | "electron" | "vscode" | "android";

const boundaryState = vi.hoisted(() => ({
  loadedModules: [] as HostModuleName[],
}));

vi.mock("./host-factories/browser", () => {
  boundaryState.loadedModules.push("browser");
  return { createBrowserHost: vi.fn() };
});

vi.mock("./host-factories/electron", () => {
  boundaryState.loadedModules.push("electron");
  return { createElectronHost: vi.fn() };
});

vi.mock("./host-factories/vscode", () => {
  boundaryState.loadedModules.push("vscode");
  return { createVscodeHost: vi.fn() };
});

vi.mock("./host-factories/android", () => {
  boundaryState.loadedModules.push("android");
  return { createAndroidHost: vi.fn() };
});

vi.mock("@mamep2026/communication", () => ({
  formatBytesHex: vi.fn(),
}));

vi.mock("@mamep2026/register-table", () => ({
  applyPollResult: vi.fn(),
  pollResultTargetMatches: vi.fn(),
}));

vi.mock("@mamep2026/ui", () => ({
  hasPlatformCapability: vi.fn(),
  requestRouteForSheet: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  boundaryState.loadedModules.length = 0;
});

describe("loadPlatformHostFactory runtime boundary", () => {
  it.each([
    ["browser", []],
    ["electron", ["electron"]],
    ["vscode", ["vscode"]],
    ["android", ["android"]],
  ] satisfies Array<[AppPlatformName, HostModuleName[]]>)(
    "%s 只加载共享浏览器 inner 与目标平台工厂",
    async (platform, expectedPlatformModules) => {
      const { loadPlatformHostFactory } = await import("./host-assembly");

      const factory = await loadPlatformHostFactory(platform);

      expect(factory).toBeTypeOf("function");
      expect(
        boundaryState.loadedModules.filter(
          (moduleName) => moduleName !== "browser",
        ),
      ).toEqual(expectedPlatformModules);
    },
    20_000,
  );
});

describe("production host loader boundary", () => {
  it.each([
    ["browser", "./host-factories/loader.browser"],
    ["electron", "./host-factories/loader.electron"],
    ["vscode", "./host-factories/loader.vscode"],
    ["android", "./host-factories/loader.android"],
  ] satisfies Array<[AppPlatformName, string]>)(
    "%s 生产入口可解析自身工厂",
    async (platform, loaderPath) => {
      const module = (await import(loaderPath)) as {
        loadPlatformHostFactory: (
          target: AppPlatformName,
        ) => Promise<unknown>;
      };

      await expect(
        module.loadPlatformHostFactory(platform),
      ).resolves.toBeTypeOf("function");
    },
    20_000,
  );

  it.each([
    ["electron", "./host-factories/loader.browser"],
    ["vscode", "./host-factories/loader.electron"],
    ["android", "./host-factories/loader.vscode"],
    ["electron", "./host-factories/loader.android"],
  ] satisfies Array<[AppPlatformName, string]>)(
    "生产入口拒绝加载 %s Host",
    async (runtimePlatform, loaderPath) => {
      const module = (await import(loaderPath)) as {
        loadPlatformHostFactory: (
          requested: AppPlatformName,
        ) => Promise<unknown>;
      };

      await expect(
        module.loadPlatformHostFactory(runtimePlatform),
      ).rejects.toThrow(`build cannot load ${runtimePlatform} host`);
    },
    20_000,
  );
});
