import { describe, expect, it } from "vitest";
import { mapOpenError, mapSerialError } from "./error-mapping";

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("mapSerialError", () => {
  it("maps DisconnectedError name to SERIAL_DEVICE_DISCONNECTED", () => {
    const error = new Error("disconnected");
    error.name = "DisconnectedError";
    const mapped = mapSerialError(error);
    expect(mapped.code).toBe("SERIAL_DEVICE_DISCONNECTED");
    expect(mapped.category).toBe("connection");
    expect(mapped.retryable).toBe(false);
  });

  it("maps ENOENT to SERIAL_NOT_FOUND", () => {
    expect(mapSerialError(withCode("no such file", "ENOENT")).code).toBe(
      "SERIAL_NOT_FOUND",
    );
  });

  it("maps ENXIO to SERIAL_NOT_FOUND", () => {
    expect(mapSerialError(withCode("no such device", "ENXIO")).code).toBe(
      "SERIAL_NOT_FOUND",
    );
  });

  it("maps EACCES to SERIAL_PERMISSION_DENIED", () => {
    const mapped = mapSerialError(withCode("permission denied", "EACCES"));
    expect(mapped.code).toBe("SERIAL_PERMISSION_DENIED");
    expect(mapped.category).toBe("permission");
  });

  it("maps EPERM to SERIAL_PERMISSION_DENIED", () => {
    expect(
      mapSerialError(withCode("operation not permitted", "EPERM")).code,
    ).toBe("SERIAL_PERMISSION_DENIED");
  });

  it("maps EBUSY to SERIAL_PORT_IN_USE", () => {
    expect(mapSerialError(withCode("resource busy", "EBUSY")).code).toBe(
      "SERIAL_PORT_IN_USE",
    );
  });

  it("maps EAGAIN to SERIAL_PORT_IN_USE", () => {
    expect(
      mapSerialError(withCode("resource temporarily unavailable", "EAGAIN"))
        .code,
    ).toBe("SERIAL_PORT_IN_USE");
  });

  it("maps canceled flag to SERIAL_CANCELLED", () => {
    const error = Object.assign(new Error("aborted"), { canceled: true });
    const mapped = mapSerialError(error);
    expect(mapped.code).toBe("SERIAL_CANCELLED");
    expect(mapped.category).toBe("cancellation");
  });

  it("maps 'Access denied' message to SERIAL_PORT_IN_USE (controlled fallback)", () => {
    expect(mapSerialError(new Error("Access denied")).code).toBe(
      "SERIAL_PORT_IN_USE",
    );
  });

  it("maps 'No such file or directory' message to SERIAL_NOT_FOUND", () => {
    expect(mapSerialError(new Error("No such file or directory")).code).toBe(
      "SERIAL_NOT_FOUND",
    );
  });

  it("maps unsupported message to SERIAL_PARAMETER_UNSUPPORTED", () => {
    expect(mapSerialError(new Error("baudRate is not supported")).code).toBe(
      "SERIAL_PARAMETER_UNSUPPORTED",
    );
  });

  it("maps unknown error to SERIAL_ERROR, retryable, preserving message", () => {
    const mapped = mapSerialError(new Error("weird failure"));
    expect(mapped.code).toBe("SERIAL_ERROR");
    expect(mapped.category).toBe("transport");
    expect(mapped.retryable).toBe(true);
    expect(mapped.technicalMessage).toBe("weird failure");
    expect(mapped.cause).toBeInstanceOf(Error);
  });

  it("maps non-Error unknown to SERIAL_ERROR with stringified message", () => {
    const mapped = mapSerialError("boom");
    expect(mapped.code).toBe("SERIAL_ERROR");
    expect(mapped.technicalMessage).toBe("boom");
  });
});

describe("mapOpenError", () => {
  it("maps unknown open error to SERIAL_OPEN_FAILED", () => {
    const mapped = mapOpenError(new Error("mystery"));
    expect(mapped.code).toBe("SERIAL_OPEN_FAILED");
    expect(mapped.retryable).toBe(true);
  });

  it("still maps recognizable errors (EBUSY) in open context", () => {
    expect(mapOpenError(withCode("busy", "EBUSY")).code).toBe(
      "SERIAL_PORT_IN_USE",
    );
  });

  it("still maps ENOENT in open context", () => {
    expect(mapOpenError(withCode("gone", "ENOENT")).code).toBe(
      "SERIAL_NOT_FOUND",
    );
  });
});
