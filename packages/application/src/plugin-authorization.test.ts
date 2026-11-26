import { describe, expect, it, vi } from "vitest";
import { CommunicationSession } from "@mamep2026/communication";
import { createDefaultRtuProfile, fail, ok } from "@mamep2026/domain";
import {
  PluginRegistry,
  pluginPermissionDenied,
  type PermissionId,
  type PluginCommunicationApi,
  type PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import {
  FakeTransport,
  ScriptedModbusRtuDevice,
  VirtualClock,
} from "@mamep2026/test-kit";
import { createPluginCommunicationApi } from "./plugin-communication";

async function setup(
  permissions: PermissionId[],
  approved: PermissionId[] = permissions,
) {
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  transport.device = new ScriptedModbusRtuDevice();
  const logs: { source: string; pluginId: string | null; direction: string }[] =
    [];
  const session = new CommunicationSession({
    transport,
    clock,
    config: createDefaultRtuProfile(),
    slaveAddress: 1,
    onLog: (event) => logs.push(event),
  });
  await session.connect();
  const registry = new PluginRegistry({
    communicationApiFactory: (pluginId, authorization) =>
      createPluginCommunicationApi({
        pluginId,
        authorization,
        getSession: () => session,
      }),
  });
  const captured: {
    api?: PluginCommunicationApi;
    command?: PluginCommunicationApi;
  } = {};
  const register = () =>
    registry.register(
      {
        id: "authorized",
        name: "Authorized",
        description: "Authorization test",
        version: "1.0.0",
        apiVersion: "2.0",
        platform: { web: true, node: false },
        permissions,
        contributes: {},
      },
      {
        source: "installed",
        approvedPermissions: approved,
        runtime: {
          activate(ctx) {
            captured.api = ctx.communication;
          },
          async handleToolbarAction(_action, ctx) {
            captured.command = ctx.communication;
            return ctx.communication.writeRegisters({
              address: 0,
              values: [123],
            });
          },
        },
      },
    );
  expect(register().ok).toBe(true);
  return { session, transport, logs, registry, captured, register };
}

describe("plugin communication authorization at the device boundary", () => {
  it("revokes queued requests when a remote runtime terminates", async () => {
    const fixture = await setup(["communication"]);
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      const original = fixture.transport.write.bind(fixture.transport);
      fixture.transport.write = async (frame) => {
        resolve();
        await new Promise<void>((resume) => {
          release = resume;
        });
        fixture.transport.write = original;
        return original(frame);
      };
    });
    const blocker = fixture.session.readRegisters(10, 1, {
      source: "manual-read",
    });
    await entered;
    let invalidate: (() => void) | undefined;
    let api: PluginCommunicationApi | undefined;
    const runtime: PluginRemoteRuntime = {
      load: vi.fn(),
      setInvalidationHandler: (handler) => {
        invalidate = handler;
      },
      activate: async (ctx) => {
        api = ctx.communication;
      },
      dispose: async () => {
        invalidate?.();
      },
    };
    fixture.registry.register(
      {
        id: "remote",
        name: "Remote",
        description: "Termination test",
        version: "1.0.0",
        apiVersion: "2.0",
        platform: { web: true, node: false },
        permissions: ["communication"],
      },
      {
        source: "installed",
        approvedPermissions: ["communication"],
        remoteRuntime: runtime,
      },
    );
    const queued = api?.readRegisters({ address: 20, quantity: 1 });
    await runtime.dispose();
    expect(await queued).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_PERMISSION_DENIED" },
    });
    expect(fixture.registry.getLifecycleState("remote")).toBe("failed");
    release?.();
    expect((await blocker).ok).toBe(true);
    expect(
      fixture.logs.filter((event) => event.direction === "request"),
    ).toHaveLength(1);
    await fixture.session.disconnect();
  });

  it("rechecks authorization after a synchronous log callback revokes access", async () => {
    let allowed = true;
    const transport = new FakeTransport();
    transport.device = new ScriptedModbusRtuDevice();
    const write = vi.spyOn(transport, "write");
    const session = new CommunicationSession({
      transport,
      clock: new VirtualClock(),
      config: createDefaultRtuProfile(),
      slaveAddress: 1,
      onLog: () => {
        allowed = false;
      },
    });
    await session.connect();
    const api = createPluginCommunicationApi({
      pluginId: "revoke-on-log",
      getSession: () => session,
      authorization: {
        check: () =>
          allowed ? ok(undefined) : fail(pluginPermissionDenied("revoked")),
        onRevoke: () => () => {},
      },
    });
    expect(await api.readRegisters({ address: 0, quantity: 1 })).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_PERMISSION_DENIED" },
    });
    expect(write).not.toHaveBeenCalled();
    await session.disconnect();
  });

  it("does not let a rejected old activation disable a replacement with the same ID", async () => {
    let rejectOld: ((reason: Error) => void) | undefined;
    const registry = new PluginRegistry();
    const manifest = {
      id: "same-id",
      name: "Same ID",
      description: "Generation test",
      version: "1.0.0",
      apiVersion: "2.0",
      platform: { web: true, node: false },
    };
    registry.register(manifest, {
      source: "installed",
      runtime: {
        activate: () =>
          new Promise<void>((_resolve, reject) => {
            rejectOld = reject;
          }),
      },
    });
    registry.unregister(manifest.id);
    registry.register(manifest, {
      source: "installed",
      runtime: { activate() {} },
    });
    rejectOld?.(new Error("old instance failed"));
    await Promise.resolve();
    expect(registry.getLifecycleState(manifest.id)).toBe("active");
    expect(registry.getLoadErrors()).toEqual([]);
  });

  it.each([
    { declared: [], approved: [], read: false, write: false },
    { declared: ["communication"], approved: [], read: false, write: false },
    {
      declared: ["communication"],
      approved: ["communication"],
      read: true,
      write: false,
    },
    {
      declared: ["communication", "device-write"],
      approved: ["communication"],
      read: true,
      write: false,
    },
    {
      declared: ["communication", "device-write"],
      approved: ["communication", "device-write"],
      read: true,
      write: true,
    },
  ] satisfies {
    declared: PermissionId[];
    approved: PermissionId[];
    read: boolean;
    write: boolean;
  }[])(
    "enforces declared=$declared approved=$approved",
    async ({ declared, approved, read, write }) => {
      const fixture = await setup(declared, approved);
      try {
        const result = await fixture.captured.api?.readRegisters({
          address: 0,
          quantity: 1,
        });
        expect(result?.ok).toBe(read);
        if (result && !result.ok)
          expect(result.error.code).toBe("PLUGIN_PERMISSION_DENIED");
        const written = await fixture.registry.invokeToolbarAction(
          "authorized",
          "write",
        );
        expect(written.ok).toBe(write);
        if (!written.ok)
          expect(written.error.code).toBe("PLUGIN_PERMISSION_DENIED");
        expect(
          fixture.logs.filter((event) => event.direction === "request"),
        ).toHaveLength(Number(read) + Number(write));
        expect(
          fixture.logs.every(
            (event) =>
              event.source === "plugin" && event.pluginId === "authorized",
          ),
        ).toBe(true);
      } finally {
        fixture.registry.dispose();
        await fixture.session.disconnect();
      }
    },
  );

  it("does not grant access when an application factory has no authorization", async () => {
    const fixture = await setup([]);
    const api = createPluginCommunicationApi({
      pluginId: "forged",
      getSession: () => fixture.session,
    });
    expect(await api.readRegisters({ address: 0, quantity: 1 })).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_PERMISSION_DENIED" },
    });
    expect(fixture.logs).toHaveLength(0);
    await fixture.session.disconnect();
  });

  it("allows command writes but rejects activation and retained command writes", async () => {
    const fixture = await setup(["communication", "device-write"]);
    const request = { address: 0, values: [1] };
    expect((await fixture.captured.api?.writeRegisters(request))?.ok).toBe(
      false,
    );
    expect(
      (await fixture.registry.invokeToolbarAction("authorized", "write")).ok,
    ).toBe(true);
    expect((await fixture.captured.command?.writeRegisters(request))?.ok).toBe(
      false,
    );
    expect(
      fixture.logs.filter((event) => event.direction === "request"),
    ).toHaveLength(1);
    await fixture.session.disconnect();
  });

  it("never revives a retained API after disable, re-enable, or same-ID reinstall", async () => {
    const fixture = await setup(["communication"]);
    const old = fixture.captured.api;
    fixture.registry.setEnabled("authorized", false);
    expect((await old?.readRegisters({ address: 0, quantity: 1 }))?.ok).toBe(
      false,
    );
    fixture.registry.setEnabled("authorized", true);
    expect((await old?.readRegisters({ address: 0, quantity: 1 }))?.ok).toBe(
      false,
    );
    expect(
      (await fixture.captured.api?.readRegisters({ address: 0, quantity: 1 }))
        ?.ok,
    ).toBe(true);
    fixture.registry.unregister("authorized");
    fixture.register();
    expect((await old?.readRegisters({ address: 0, quantity: 1 }))?.ok).toBe(
      false,
    );
    expect(
      (await fixture.captured.api?.readRegisters({ address: 0, quantity: 1 }))
        ?.ok,
    ).toBe(true);
    await fixture.session.disconnect();
  });

  it("cancels queued plugin reads and writes without cancelling another caller", async () => {
    const fixture = await setup(["communication", "device-write"]);
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      const original = fixture.transport.write.bind(fixture.transport);
      fixture.transport.write = async (frame) => {
        resolve();
        await new Promise<void>((resume) => {
          release = resume;
        });
        fixture.transport.write = original;
        return original(frame);
      };
    });
    const blocker = fixture.session.readRegisters(10, 1, {
      source: "manual-read",
    });
    await entered;
    const queuedRead = fixture.captured.api?.readRegisters({
      address: 20,
      quantity: 1,
    });
    const queuedWrite = fixture.registry.invokeToolbarAction(
      "authorized",
      "write",
    );
    fixture.registry.setEnabled("authorized", false);
    expect(await queuedRead).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_PERMISSION_DENIED" },
    });
    expect(await queuedWrite).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_PERMISSION_DENIED" },
    });
    release?.();
    expect((await blocker).ok).toBe(true);
    expect(
      fixture.logs.filter((event) => event.direction === "request"),
    ).toHaveLength(1);
    await fixture.session.disconnect();
  });

  it("does not expose a late read result after access is revoked", async () => {
    let resolveRead:
      ((result: ReturnType<typeof ok<number[]>>) => void) | undefined;
    const registry = new PluginRegistry({
      communicationApi: {
        readRegisters: () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
        writeRegisters: async () => ok(undefined),
      },
    });
    let request: Promise<unknown> | undefined;
    registry.register(
      {
        id: "late",
        name: "Late",
        description: "Late response test",
        version: "1.0.0",
        apiVersion: "2.0",
        platform: { web: true, node: false },
        permissions: ["communication"],
      },
      {
        source: "installed",
        approvedPermissions: ["communication"],
        runtime: {
          activate(ctx) {
            request = ctx.communication.readRegisters({
              address: 0,
              quantity: 1,
            });
          },
        },
      },
    );
    registry.unregister("late");
    resolveRead?.(ok([999]));
    expect(await request).toMatchObject({
      ok: false,
      error: { code: "PLUGIN_PERMISSION_DENIED" },
    });
  });
});
