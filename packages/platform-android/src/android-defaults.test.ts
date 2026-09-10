import { describe, expect, it } from "vitest";
import {
  createTcpConnectionProfile,
  defaultConfig,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import {
  ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS,
  ANDROID_TCP_DEFAULT_RETRY_COUNT,
  applyAndroidTcpDefaults,
} from "./android-defaults";

function profile(
  overrides: Partial<TcpConnectionProfile>,
): TcpConnectionProfile {
  const created = createTcpConnectionProfile({
    host: "192.168.1.10",
    port: 502,
    unitId: 1,
  });
  if (!created.ok) throw new Error("test fixture invalid");
  return { ...created.value, ...overrides };
}

describe("applyAndroidTcpDefaults", () => {
  it("库默认值（50ms / 重试 1）→ 替换为 Android 默认（300ms / 重试 2）", () => {
    const applied = applyAndroidTcpDefaults(
      profile({
        requestTimeoutMs: defaultConfig.tcp.requestTimeoutMs,
        retryCount: defaultConfig.tcp.retryCount,
      }),
    );

    expect(applied.requestTimeoutMs).toBe(ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS);
    expect(applied.retryCount).toBe(ANDROID_TCP_DEFAULT_RETRY_COUNT);
    expect(ANDROID_TCP_DEFAULT_REQUEST_TIMEOUT_MS).toBe(300);
    expect(ANDROID_TCP_DEFAULT_RETRY_COUNT).toBe(2);
  });

  it("用户改过的值原样保留（只覆盖未自定义项）", () => {
    const applied = applyAndroidTcpDefaults(
      profile({ requestTimeoutMs: 1000, retryCount: 1 }),
    );

    expect(applied.requestTimeoutMs).toBe(1000);
    expect(applied.retryCount).toBe(ANDROID_TCP_DEFAULT_RETRY_COUNT);
  });

  it("不修改入参（纯函数）", () => {
    const original = profile({ requestTimeoutMs: 50, retryCount: 1 });
    const snapshot = { ...original };

    applyAndroidTcpDefaults(original);

    expect(original).toEqual(snapshot);
  });

  it("无需覆盖时返回同一对象引用（避免无谓分配）", () => {
    const original = profile({ requestTimeoutMs: 500, retryCount: 3 });

    expect(applyAndroidTcpDefaults(original)).toBe(original);
  });
});
