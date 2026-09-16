/**
 * 装配编排测试（node 环境；不依赖 React / store / DOM）。
 *
 * 覆盖（对应 2026-09-13「按运行时平台动态 import 宿主」的回归防线）：
 * - 按平台加载工厂，透传上下文 / 桥 / 取消信号；
 * - 成功路径的接线与启动顺序（插件 → 注入解析器 → 注册 host → 订阅 → 加载工作区）；
 * - 装配失败兜底：提示 `messages.hostLoadFailed` + 失败态，且不接线、不抛；
 * - **取消竞态**：pending 期间与「工厂已构造后」取消均不得接线，已构造的 host 立即释放
 *   （旧 host 残留订阅会导致通信日志重复投递，2026-08-23 已修 bug 的防护）；
 * - visibilitychange：隐藏时挂起后台并 flush，abort 时退订并释放。
 */
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import type { AppHost } from "@mamep2026/ui";
import {
  startAppHost,
  type HostAssemblyDeps,
  type HostAssemblySinks,
  type PlatformHostFactory,
  type VisibilityDocument,
} from "./host-assembly";
import { createPlatformHostContext } from "./platform-context";

type PollResultListener = (
  key: string,
  address: number,
  result: Result<number | number[]>,
) => void;

/**
 * 最小 host 测试替身：只实现装配编排实际调用的成员（`asHost` 一次断言补齐 `AppHost`
 * 接口——仅测试替身如此，生产代码不得绕过类型）。
 */
function makeFakeHost(options: { isMockMode?: boolean } = {}) {
  const pollResultListeners: PollResultListener[] = [];
  const host = {
    isMockMode: options.isMockMode ?? false,
    startPlugins: vi.fn(async () => undefined),
    subscribeCommLog: vi.fn(() => () => undefined),
    subscribeMessage: vi.fn(() => () => undefined),
    subscribeSaveStatus: vi.fn(() => () => undefined),
    subscribeConnectionState: vi.fn(() => () => undefined),
    subscribePollResult: vi.fn((listener: PollResultListener) => {
      pollResultListeners.push(listener);
      return () => undefined;
    }),
    loadWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    getWorkspaceRecoveryInfo: vi.fn(() => null),
    connect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    setBackgroundSuspended: vi.fn(),
    flush: vi.fn(async () => ({ ok: true as const, value: undefined })),
    dispose: vi.fn(async () => undefined),
  };
  return { host, pollResultListeners };
}

type FakeHost = ReturnType<typeof makeFakeHost>["host"];

function asHost(host: FakeHost): AppHost {
  return host as unknown as AppHost;
}

function makeSinks(): HostAssemblySinks {
  return {
    setHostStatus: vi.fn(),
    setPluginsReady: vi.fn(),
    setHost: vi.fn(),
    setActiveHost: vi.fn(),
    setDataTypeResolver: vi.fn(),
    setWorkspace: vi.fn(),
    setLoaded: vi.fn(),
    setConnectionModalOpen: vi.fn(),
    setSaveStatus: vi.fn(),
    setConnectionState: vi.fn(),
    setWorkspaceRecovery: vi.fn(),
    appendMessage: vi.fn(),
    appendCommLog: vi.fn(),
    recordPollResult: vi.fn(),
    updateRow: vi.fn(),
    getWorkspaceSheets: vi.fn(() => []),
  };
}

const noopDocument: VisibilityDocument = {
  visibilityState: "visible",
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

function makeDeps(overrides: Partial<HostAssemblyDeps> = {}): HostAssemblyDeps {
  return {
    platform: "electron",
    context: createPlatformHostContext({
      mockTransport: false,
      compatibilityEnv: { serial: undefined, isSecureContext: true },
    }),
    sinks: makeSinks(),
    bridge: undefined,
    documentRef: noopDocument,
    ...overrides,
  };
}

describe("startAppHost", () => {
  it("按平台加载工厂并透传上下文 / 桥 / 取消信号", async () => {
    const { host } = makeFakeHost();
    const factory = vi.fn(() => asHost(host));
    const seenPlatforms: string[] = [];
    const deps = makeDeps({
      platform: "vscode",
      loadHostFactory: async (platform) => {
        seenPlatforms.push(platform);
        return factory;
      },
    });
    const controller = new AbortController();

    const started = await startAppHost(deps, controller.signal);

    expect(seenPlatforms).toEqual(["vscode"]);
    expect(factory).toHaveBeenCalledWith({
      context: deps.context,
      bridge: undefined,
      signal: controller.signal,
    });
    expect(started).toBe(asHost(host));
  });

  it("成功路径：启动插件 → 注入解析器 → 注册 host → 订阅 → 加载工作区", async () => {
    const { host } = makeFakeHost();
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });
    const controller = new AbortController();

    await startAppHost(deps, controller.signal);

    expect(host.startPlugins).toHaveBeenCalledTimes(1);
    // 插件就绪：`startPlugins()` 落定后置位（2026-09-16 插件主题色首帧修复）。
    await vi.waitFor(() => {
      expect(deps.sinks.setPluginsReady).toHaveBeenCalledWith(true);
    });
    expect(deps.sinks.setDataTypeResolver).toHaveBeenCalledWith(
      deps.context.dataTypeResolver,
    );
    expect(deps.sinks.setHost).toHaveBeenCalledWith(asHost(host));
    expect(deps.sinks.setActiveHost).toHaveBeenCalledWith(asHost(host));
    expect(host.subscribeCommLog).toHaveBeenCalledTimes(1);
    expect(host.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(host.subscribeSaveStatus).toHaveBeenCalledTimes(1);
    expect(host.subscribeConnectionState).toHaveBeenCalledTimes(1);
    expect(host.subscribePollResult).toHaveBeenCalledTimes(1);
    // 骨架只覆盖装配阶段：接线完成即 ready，工作区随后异步加载。
    expect(deps.sinks.setHostStatus).toHaveBeenLastCalledWith("ready");

    await vi.waitFor(() => {
      expect(deps.sinks.setLoaded).toHaveBeenCalledTimes(1);
    });
    expect(deps.sinks.setWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.sinks.setWorkspaceRecovery).toHaveBeenCalledWith(null);
    // 非 mock：启动自动弹出 Connection Settings。
    expect(deps.sinks.setConnectionModalOpen).toHaveBeenCalledWith(true);
    expect(host.connect).not.toHaveBeenCalled();
  });

  it("插件启动失败也置「插件就绪」（fail-open：以注册表为准，避免陈旧色种子长期生效）", async () => {
    const { host } = makeFakeHost();
    host.startPlugins = vi.fn(async () => {
      throw new Error("plugin store failed");
    });
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });
    const controller = new AbortController();

    await startAppHost(deps, controller.signal);

    await vi.waitFor(() => {
      expect(deps.sinks.setPluginsReady).toHaveBeenCalledWith(true);
    });
    expect(deps.sinks.setHost).toHaveBeenCalledWith(asHost(host));
  });

  it("mock 模式：跳过连接弹窗，直接连接默认 RTU 配置", async () => {
    const { host } = makeFakeHost({ isMockMode: true });
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });

    await startAppHost(deps, new AbortController().signal);

    await vi.waitFor(() => {
      expect(host.connect).toHaveBeenCalledTimes(1);
    });
    expect(host.connect).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "rtu" }),
      null,
    );
    expect(deps.sinks.setConnectionModalOpen).not.toHaveBeenCalled();
  });

  it("轮询结果接线：成功结果写状态点并按当前表快照应用（空工作区不写行）", async () => {
    const { host, pollResultListeners } = makeFakeHost();
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });

    await startAppHost(deps, new AbortController().signal);
    const listener = pollResultListeners[0];
    expect(listener).toBeDefined();
    listener?.("row-1", 0, { ok: true, value: 7 });

    expect(deps.sinks.recordPollResult).toHaveBeenCalledWith("row-1", {
      ok: true,
      value: 7,
    });
    expect(deps.sinks.getWorkspaceSheets).toHaveBeenCalledTimes(1);
    // 空工作区无匹配行 → applyPollResult 返回 null → 不更新行。
    expect(deps.sinks.updateRow).not.toHaveBeenCalled();
  });

  it("工厂加载失败：提示 hostLoadFailed + 失败态，且不接线不抛", async () => {
    const deps = makeDeps({
      loadHostFactory: async () => {
        throw new Error("chunk load failed");
      },
    });

    const started = await startAppHost(deps, new AbortController().signal);

    expect(started).toBeNull();
    expect(deps.sinks.setHostStatus).toHaveBeenLastCalledWith("failed");
    expect(deps.sinks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        messageKey: "messages.hostLoadFailed",
        detail: "chunk load failed",
      }),
    );
    expect(deps.sinks.setHost).not.toHaveBeenCalled();
  });

  it("宿主构造抛错：走同一失败兜底（不接线、不抛）", async () => {
    const deps = makeDeps({
      loadHostFactory: async () => () => {
        throw new Error("constructor boom");
      },
    });

    await expect(
      startAppHost(deps, new AbortController().signal),
    ).resolves.toBeNull();
    expect(deps.sinks.setHostStatus).toHaveBeenLastCalledWith("failed");
    expect(deps.sinks.setHost).not.toHaveBeenCalled();
  });

  it("pending 期间取消：不接线、不写任何状态、无 host 可释放", async () => {
    let resolveLoad: ((factory: PlatformHostFactory) => void) | undefined;
    const { host } = makeFakeHost();
    const deps = makeDeps({
      loadHostFactory: () =>
        new Promise<PlatformHostFactory>((resolve) => {
          resolveLoad = resolve;
        }),
    });
    const controller = new AbortController();

    const pending = startAppHost(deps, controller.signal);
    controller.abort();
    resolveLoad?.(() => asHost(host));

    await expect(pending).resolves.toBeNull();
    expect(deps.sinks.setHost).not.toHaveBeenCalled();
    expect(deps.sinks.setHostStatus).not.toHaveBeenCalled();
    expect(host.startPlugins).not.toHaveBeenCalled();
    expect(host.dispose).not.toHaveBeenCalled();
  });

  it("工厂已构造后取消：立即释放且不接线", async () => {
    const { host } = makeFakeHost();
    const controller = new AbortController();
    const deps = makeDeps({
      loadHostFactory: async () => () => {
        controller.abort();
        return asHost(host);
      },
    });

    await expect(startAppHost(deps, controller.signal)).resolves.toBeNull();

    expect(host.dispose).toHaveBeenCalledTimes(1);
    expect(deps.sinks.setHost).not.toHaveBeenCalled();
    expect(host.startPlugins).not.toHaveBeenCalled();
  });

  it("异步工厂（Android：构造前 await 能力探测，ADR-056）：await 完成后正常接线", async () => {
    const { host } = makeFakeHost();
    const deps = makeDeps({
      loadHostFactory: async () => async () => {
        await Promise.resolve();
        return asHost(host);
      },
    });

    await expect(
      startAppHost(deps, new AbortController().signal),
    ).resolves.toBe(asHost(host));
    expect(deps.sinks.setHost).toHaveBeenCalledWith(asHost(host));
    expect(host.startPlugins).toHaveBeenCalledTimes(1);
  });

  it("异步工厂在 await 期间被取消：仍释放且不接线", async () => {
    const { host } = makeFakeHost();
    const controller = new AbortController();
    const deps = makeDeps({
      loadHostFactory: async () => async () => {
        // 模拟探测耗时：await 后宿主才构造出来，此时取消已发生。
        await Promise.resolve();
        controller.abort();
        return asHost(host);
      },
    });

    await expect(startAppHost(deps, controller.signal)).resolves.toBeNull();

    expect(host.dispose).toHaveBeenCalledTimes(1);
    expect(deps.sinks.setHost).not.toHaveBeenCalled();
    expect(host.startPlugins).not.toHaveBeenCalled();
  });

  it("visibilitychange：隐藏时挂起后台并 flush；abort 时退订并释放 host", async () => {
    const { host } = makeFakeHost();
    const listeners = new Set<() => void>();
    const doc: VisibilityDocument = {
      visibilityState: "visible",
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    };
    const controller = new AbortController();
    const deps = makeDeps({
      documentRef: doc,
      loadHostFactory: async () => () => asHost(host),
    });

    await startAppHost(deps, controller.signal);
    expect(listeners.size).toBe(1);

    Object.defineProperty(doc, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    for (const listener of listeners) listener();

    expect(host.setBackgroundSuspended).toHaveBeenCalledWith(true);
    expect(host.flush).toHaveBeenCalledTimes(1);

    controller.abort();
    expect(listeners.size).toBe(0);
    expect(host.dispose).toHaveBeenCalledTimes(1);
  });
});
