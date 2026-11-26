import { describe, expect, it } from "vitest";
import {
  PLUGIN_SANDBOX_LOADER_HASH,
  PLUGIN_SANDBOX_LOADER_SOURCE,
} from "./plugin-sandbox-loader";

describe("sandbox bootstrap CSP", () => {
  it("authorizes exactly the fixed script bytes without broad inline permission", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(PLUGIN_SANDBOX_LOADER_SOURCE),
    );
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(PLUGIN_SANDBOX_LOADER_HASH).toBe(`sha256-${base64}`);
    expect(PLUGIN_SANDBOX_LOADER_SOURCE).not.toContain("</script>");
  });
});
