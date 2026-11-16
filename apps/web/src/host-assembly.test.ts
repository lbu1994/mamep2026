/**
 * 装配编排测试（node 环境；不依赖 React / store / DOM）。
 *
 * 覆盖（对应「按运行时平台动态 import 宿主」的回归防线）：
 * - 按平台加载工厂，透传上下文 / 桥 / 取消信号；
 * - 成功路径的接线与启动顺序（插件 → 注入解析器 → 注册 host → 订阅 → 加载工作区）；
 * - 装配失败兜底：提示 `messages.hostLoadFailed` + 失败态，且不接线、不抛；
 * - **取消竞态**：pending 期间与「工厂已构造后」取消均不得接线，已构造的 host 立即释放
 *   （旧 host 残留订阅会导致通信日志重复投递已修 bug 的防护）；
 * - visibilitychange：隐藏时挂起后台并 flush，abort 时退订并释放。
 */
import { describe, expect, it, vi } from "vitest";
import {
  browserCapabilities,
  createEmptyWorkspace,
  createMamepError,
  RegisterAddress,
} from "@mamep2026/domain";
import type { PollResultEvent, RegisterSheet } from "@mamep2026/domain";
import { RegisterTableService } from "@mamep2026/register-table";
import type { AppHost, HostStatus } from "@mamep2026/ui";
import {
  startAppHost,
  type HostAssemblyDeps,
  type HostAssemblySinks,
  type PlatformHostFactory,
  type VisibilityDocument,
} from "./host-assembly";
import { createPlatformHostContext } from "./platform-context";

type PollResultListener = (event: PollResultEvent) => void;

/**
 * 最小 host 测试替身：只实现装配编排实际调用的成员（`asHost` 一次断言补齐 `AppHost`
 * 接口——仅测试替身如此，生产代码不得绕过类型）。
 */
function makeFakeHost(
  options: { isMockMode?: boolean; backgroundLifecycle?: boolean } = {},
) {
  const pollResultListeners: PollResultListener[] = [];
  const host = {
    capabilities: {
      ...browserCapabilities,
      backgroundLifecycle: options.backgroundLifecycle ?? true,
    },
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

function makeSheetWithRow(slaveAddress: number): RegisterSheet {
  const row = RegisterTableService.createRow();
  const address = RegisterAddress.create(1);
  if (address.ok) row.addressValue = address.value;
  return {
    sheetId: "sheet-a" as never,
    name: "Sheet A",
    type: "holding-register",
    order: 0,
    open: true,
    slaveAddress,
    rows: [row],
    registerRadix: "dec",
    columnWidths: {},
    columnOrder: null,
    writeVerify: { mode: "off", delayMs: null },
    addressTransform: null,
    createdAt: 0,
    updatedAt: 0,
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
    // 插件就绪：`startPlugins()` 落定后置位。
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

    await vi.waitFor(() => {
      expect(deps.sinks.setLoaded).toHaveBeenCalledTimes(1);
    });
    expect(deps.sinks.setWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.sinks.setWorkspaceRecovery).toHaveBeenCalledWith(null);
    // 非 mock：启动自动弹出 Connection Settings（与外壳同一批更新，不再「外壳先出现、弹窗后弹」）。
    expect(deps.sinks.setConnectionModalOpen).toHaveBeenCalledWith(true);
    expect(host.connect).not.toHaveBeenCalled();
    // 就绪门：工作区加载落定后才切换外壳（未就绪时不得 ready，否则外壳会先渲染
    // 默认工作区，出现「侧栏/Tab/底部面板先默认后切换」的首屏闪烁）。
    await vi.waitFor(() => {
      expect(deps.sinks.setHostStatus).toHaveBeenLastCalledWith("ready");
    });
  });

  it("外壳就绪门：ready 必在 setWorkspace 之后（外壳首帧即持久化状态）", async () => {
    const { host } = makeFakeHost();
    const order: string[] = [];
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });
    deps.sinks.setWorkspace = vi.fn(() => {
      order.push("workspace");
    });
    deps.sinks.setHostStatus = vi.fn((status: HostStatus) => {
      order.push(`status:${status}`);
    });
    const controller = new AbortController();

    await startAppHost(deps, controller.signal);
    // 接线完成时不得已经 ready（工作区仍在加载）。
    expect(order).not.toContain("status:ready");

    await vi.waitFor(() => {
      expect(order).toContain("status:ready");
    });
    expect(order.indexOf("workspace")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("workspace")).toBeLessThan(
      order.indexOf("status:ready"),
    );
  });

  it("超时兜底：工作区加载挂起时按上限置 ready 并提示（不常驻骨架）", async () => {
    const { host } = makeFakeHost();
    // 永不落定的仓储读取（模拟挂起）。
    host.loadWorkspace = vi.fn(() => new Promise<never>(() => {}));
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
      shellReadyTimeoutMs: 5,
    });
    const controller = new AbortController();

    await startAppHost(deps, controller.signal);

    await vi.waitFor(() => {
      expect(deps.sinks.setHostStatus).toHaveBeenLastCalledWith("ready");
    });
    expect(deps.sinks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: "messages.startupTimeout" }),
    );
  });

  it("工作区加载抛错也置 ready（应用以无 Host 外的空态保持可操作）", async () => {
    const { host } = makeFakeHost();
    host.loadWorkspace = vi.fn(async () => {
      throw new Error("repository failed");
    });
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });
    const controller = new AbortController();

    await startAppHost(deps, controller.signal);

    await vi.waitFor(() => {
      expect(deps.sinks.setHostStatus).toHaveBeenLastCalledWith("ready");
    });
    expect(deps.sinks.setLoaded).toHaveBeenCalledTimes(1);
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

  it("轮询结果接线：空工作区找不到绑定目标时不写状态或行", async () => {
    const { host, pollResultListeners } = makeFakeHost();
    const deps = makeDeps({
      loadHostFactory: async () => () => asHost(host),
    });

    await startAppHost(deps, new AbortController().signal);
    const listener = pollResultListeners[0];
    expect(listener).toBeDefined();
    listener?.({
      key: "row-1",
      sheetId: "sheet-1",
      address: 0,
      route: { unitAddress: 1, protocol: "rtu" },
      requestGeneration: 1,
      connectionGeneration: 1,
      result: { ok: true, value: 7 },
    });

    expect(deps.sinks.recordPollResult).not.toHaveBeenCalled();
    expect(deps.sinks.getWorkspaceSheets).toHaveBeenCalledTimes(1);
    // 空工作区无匹配行 → applyPollResult 返回 null → 不更新行。
    expect(deps.sinks.updateRow).not.toHaveBeenCalled();
  });

  it("旧 Unit ID 的迟到失败结果不写当前行状态", async () => {
    const { host, pollResultListeners } = makeFakeHost();
    const sinks = makeSinks();
    const sheet = makeSheetWithRow(2);
    const row = sheet.rows[0];
    if (row === undefined) throw new Error("expected row");
    vi.mocked(sinks.getWorkspaceSheets).mockReturnValue([sheet]);
    const deps = makeDeps({
      sinks,
      loadHostFactory: async () => () => asHost(host),
    });

    await startAppHost(deps, new AbortController().signal);
    const listener = pollResultListeners[0];
    expect(listener).toBeDefined();
    listener?.({
      key: row.rowId,
      sheetId: sheet.sheetId,
      address: 1,
      route: { unitAddress: 1, protocol: "rtu" },
      requestGeneration: 3,
      connectionGeneration: 1,
      result: {
        ok: false,
        error: createMamepError({
          code: "REQUEST_TIMEOUT",
          category: "timeout",
          userMessageKey: "errors.requestTimeout",
          technicalMessage: "late timeout",
        }),
      },
    });

    expect(sinks.recordPollResult).not.toHaveBeenCalled();
    expect(sinks.updateRow).not.toHaveBeenCalled();
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

  it("backgroundLifecycle=false：页面隐藏只 flush，不调用本地会话生命周期桥", async () => {
    const { host } = makeFakeHost({ backgroundLifecycle: false });
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
    const deps = makeDeps({
      loadHostFactory: vi.fn(async () => () => asHost(host)),
      documentRef: doc,
    });
    const controller = new AbortController();

    await startAppHost(deps, controller.signal);
    Object.defineProperty(doc, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    for (const listener of listeners) listener();

    expect(host.setBackgroundSuspended).not.toHaveBeenCalled();
    expect(host.flush).toHaveBeenCalledTimes(1);
    controller.abort();
  });
});
