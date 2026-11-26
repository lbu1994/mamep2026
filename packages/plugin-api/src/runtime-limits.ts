/** Host-enforced budgets. These do not limit arbitrary same-process JavaScript. */
export const PLUGIN_RUNTIME_LIMITS = Object.freeze({
  loadTimeoutMs: 10_000,
  activateTimeoutMs: 10_000,
  deactivateTimeoutMs: 1_000,
  requestTimeoutMs: 30_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 10_000,
  maxWorkers: 16,
  maxSourceBytes: 2 * 1024 * 1024,
  maxMessageBytes: 256 * 1024,
  maxMessageNodes: 8192,
  maxMessageDepth: 32,
  maxMessagesPerSecond: 128,
  messageWindowMs: 1_000,
  maxPendingRequests: 32,
  automaticRestarts: 0,
});

/** Structural clock port; hosts can supply their existing Clock or a virtual clock. */
export interface PluginRuntimeClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): { cancel(): void };
}

/** Use standard host timers without requiring DOM or Node types in the plugin contract. */
export const pluginRuntimeClock: PluginRuntimeClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const host: object = globalThis;
    if (
      !("setTimeout" in host) ||
      typeof host.setTimeout !== "function" ||
      !("clearTimeout" in host) ||
      typeof host.clearTimeout !== "function"
    ) {
      throw new Error("plugin runtime requires host timers");
    }
    const schedule = host.setTimeout;
    const cancel = host.clearTimeout;
    const timer: unknown = schedule(callback, delayMs);
    return {
      cancel: () => {
        cancel(timer);
      },
    };
  },
};

/** Bound a cooperative hook without leaving its timer or rejection unobserved. */
export function withPluginDeadline<T>(
  operation: () => T | PromiseLike<T>,
  timeoutMs: number,
  label: string,
  clock: PluginRuntimeClock = pluginRuntimeClock,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.schedule(
      () => reject(new Error(`plugin ${label} timed out`)),
      timeoutMs,
    );
    try {
      Promise.resolve(operation()).then(
        (value) => {
          timer.cancel();
          resolve(value);
        },
        (error: unknown) => {
          timer.cancel();
          reject(error);
        },
      );
    } catch (error) {
      timer.cancel();
      reject(error);
    }
  });
}

/** Check source size before creating a Blob, data URL or Worker. */
export function assertPluginSourceBudget(source: string): void {
  if (
    source.length > PLUGIN_RUNTIME_LIMITS.maxSourceBytes ||
    utf8Bytes(source) > PLUGIN_RUNTIME_LIMITS.maxSourceBytes
  )
    throw new Error("plugin source exceeds the byte limit");
}

function utf8Bytes(source: string): number {
  let bytes = 0;
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > PLUGIN_RUNTIME_LIMITS.maxSourceBytes) break;
  }
  return bytes;
}

/** Bound validation work on cloned messages; reject cycles and non-JSON objects. */
export function isPluginMessageWithinBudget(input: unknown): boolean {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (
      ++nodes > PLUGIN_RUNTIME_LIMITS.maxMessageNodes ||
      depth > PLUGIN_RUNTIME_LIMITS.maxMessageDepth
    )
      return false;
    if (typeof value === "string") bytes += value.length * 2;
    else if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      bytes += 8;
    else if (typeof value === "object") {
      if (seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > PLUGIN_RUNTIME_LIMITS.maxMessageNodes) return false;
        for (const item of value) if (!visit(item, depth + 1)) return false;
      } else {
        if (
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null
        )
          return false;
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          if (
            !visit(key, depth + 1) ||
            !visit((value as Record<string, unknown>)[key], depth + 1)
          )
            return false;
        }
      }
      seen.delete(value);
    } else return false;
    return bytes <= PLUGIN_RUNTIME_LIMITS.maxMessageBytes;
  };
  return visit(input, 0);
}
