import { describe, expect, it } from "vitest";
import {
  CONNECTION_CONFIG_URL_PARAM,
  decodeUrlBase64,
  parseConnectionConfigFromUrl,
} from "./connection-config-url";

function encodeBase64(text: string): string {
  // TextEncoder → base64（与浏览器 atob 兼容）。
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe("decodeUrlBase64", () => {
  it("decodes standard base64 to UTF-8 text", () => {
    expect(decodeUrlBase64(encodeBase64("你好, Modbus"))).toBe("你好, Modbus");
  });

  it("decodes base64url (url-safe) input", () => {
    // 手动构造含 / 与 + 的字符串，替换为 - 与 _。
    const encoded = encodeBase64("a/b+c==").replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodeUrlBase64(encoded)).toBe("a/b+c==");
  });
});

describe("parseConnectionConfigFromUrl", () => {
  const configJson = JSON.stringify({
    schemaVersion: 1,
    activeConnectionId: "rtu-com4",
    connections: [
      { id: "rtu-com4", name: "COM4", protocol: "rtu", port: "COM4" },
    ],
  });

  it("returns null when the URL param is absent (normal startup)", () => {
    expect(parseConnectionConfigFromUrl("?mockTransport=1")).toBeNull();
    expect(parseConnectionConfigFromUrl("")).toBeNull();
  });

  it("parses a valid ?connectionConfig=<base64> param", () => {
    const result = parseConnectionConfigFromUrl(
      `?${CONNECTION_CONFIG_URL_PARAM}=${encodeBase64(configJson)}`,
    );
    expect(result?.ok).toBe(true);
    if (result === null || !result.ok) throw new Error("expected ok");
    expect(result.value.sourcePath).toBe("url");
    expect(result.value.config.activeConnectionId).toBe("rtu-com4");
    expect(result.value.config.connections[0]?.protocol).toBe("rtu");
  });

  it("returns fail for invalid base64", () => {
    const result = parseConnectionConfigFromUrl(
      `?${CONNECTION_CONFIG_URL_PARAM}=!!!not-base64!!!`,
    );
    expect(result?.ok).toBe(false);
  });

  it("returns fail for valid base64 but invalid config JSON", () => {
    const result = parseConnectionConfigFromUrl(
      `?${CONNECTION_CONFIG_URL_PARAM}=${encodeBase64("{ not json")}`,
    );
    expect(result?.ok).toBe(false);
  });
});
