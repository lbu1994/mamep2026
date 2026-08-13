import { describe, expect, it } from "vitest";
import { createMamepError, type MamepError } from "./errors";

describe("MamepError", () => {
  it("creates a structured error with all required fields", () => {
    const err: MamepError = createMamepError({
      code: "connection-timeout",
      category: "timeout",
      severity: "error",
      retryable: true,
      userMessageKey: "errors.connectionTimeout",
      technicalMessage: "no response within 1000ms",
    });

    expect(err.code).toBe("connection-timeout");
    expect(err.category).toBe("timeout");
    expect(err.severity).toBe("error");
    expect(err.retryable).toBe(true);
    expect(err.userMessageKey).toBe("errors.connectionTimeout");
    expect(err.technicalMessage).toBe("no response within 1000ms");
  });

  it("supports optional cause and context", () => {
    const cause = new Error("boom");
    const err = createMamepError({
      code: "transport-error",
      category: "transport",
      severity: "warning",
      retryable: true,
      userMessageKey: "errors.transport",
      technicalMessage: "write failed",
      cause,
      context: { port: "COM4" },
    });
    expect(err.cause).toBe(cause);
    expect(err.context?.port).toBe("COM4");
  });

  it("distinguishes connection timeout from request timeout by code", () => {
    const connectTimeout = createMamepError({
      code: "connection-timeout",
      category: "connection",
      severity: "error",
      retryable: false,
      userMessageKey: "errors.connectionTimeout",
      technicalMessage: "connect timeout",
    });
    const requestTimeout = createMamepError({
      code: "request-timeout",
      category: "timeout",
      severity: "error",
      retryable: true,
      userMessageKey: "errors.requestTimeout",
      technicalMessage: "request timeout",
    });
    expect(connectTimeout.code).not.toBe(requestTimeout.code);
    expect(connectTimeout.category).not.toBe(requestTimeout.category);
  });
});
