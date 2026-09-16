import { describe, expect, it } from "vitest";
import {
  ANDROID_NATIVE_ERROR_CODES,
  mapAndroidNativeError,
  serialUnsupportedError,
  toNativeBridgeError,
} from "./error-mapping";

describe("error-mapping：原生错误 → 项目错误", () => {
  it("NOT_OPEN → TRANSPORT_NOT_OPEN（transport，不可重试）", () => {
    const error = mapAndroidNativeError(
      { code: ANDROID_NATIVE_ERROR_CODES.notOpen, message: "socket closed" },
      "io",
    );
    expect(error.code).toBe("TRANSPORT_NOT_OPEN");
    expect(error.category).toBe("transport");
    expect(error.retryable).toBe(false);
    expect(error.userMessageKey).toBe("errors.transportNotOpen");
  });

  it.each([
    ANDROID_NATIVE_ERROR_CODES.connectFailed,
    ANDROID_NATIVE_ERROR_CODES.remoteClosed,
    ANDROID_NATIVE_ERROR_CODES.connectionReset,
  ])("%s → TCP_CONNECTION_FAILED（connection，可重试）", (code) => {
    const error = mapAndroidNativeError({ code, message: "boom" }, "io");
    expect(error.code).toBe("TCP_CONNECTION_FAILED");
    expect(error.category).toBe("connection");
    expect(error.retryable).toBe(true);
    expect(error.userMessageKey).toBe("errors.tcpConnectionFailed");
  });

  it("TCP_OPEN_FAILED → TCP_OPEN_FAILED（transport）", () => {
    const error = mapAndroidNativeError(
      {
        code: ANDROID_NATIVE_ERROR_CODES.openFailed,
        message: "connect timeout",
      },
      "open",
    );
    expect(error.code).toBe("TCP_OPEN_FAILED");
    expect(error.category).toBe("transport");
    expect(error.userMessageKey).toBe("errors.tcpOpenFailed");
  });

  it("WRITE_FAILED → TCP_CONNECTION_FAILED（transport）", () => {
    const error = mapAndroidNativeError(
      { code: ANDROID_NATIVE_ERROR_CODES.writeFailed, message: "broken pipe" },
      "io",
    );
    expect(error.code).toBe("TCP_CONNECTION_FAILED");
    expect(error.technicalMessage).toContain("write failed");
  });

  it("PLUGIN_UNAVAILABLE → TCP_UNSUPPORTED（capability，不可重试）", () => {
    const error = mapAndroidNativeError(
      {
        code: ANDROID_NATIVE_ERROR_CODES.pluginUnavailable,
        message: "no plugin",
      },
      "open",
    );
    expect(error.code).toBe("TCP_UNSUPPORTED");
    expect(error.category).toBe("capability");
    expect(error.retryable).toBe(false);
    expect(error.userMessageKey).toBe("errors.tcpUnsupported");
  });

  it("未识别错误按上下文兜底并保留原始码（不丢技术信息）", () => {
    const openError = mapAndroidNativeError(
      { code: "WEIRD", message: "?" },
      "open",
    );
    expect(openError.code).toBe("TCP_OPEN_FAILED");
    expect(openError.technicalMessage).toContain("WEIRD");

    const ioError = mapAndroidNativeError(
      { code: "WEIRD", message: "?" },
      "io",
    );
    expect(ioError.code).toBe("TCP_CONNECTION_FAILED");
    expect(ioError.technicalMessage).toContain("WEIRD");
  });
});

describe("error-mapping：toNativeBridgeError", () => {
  it("字符串 / Error 带码 / Error 无码 / 对象 / 空值", () => {
    expect(toNativeBridgeError("plain failure")).toEqual({
      code: "UNKNOWN",
      message: "plain failure",
    });

    const withCode = new Error("connect refused");
    (withCode as { code?: string }).code = "TCP_CONNECT_FAILED";
    expect(toNativeBridgeError(withCode)).toEqual({
      code: "TCP_CONNECT_FAILED",
      message: "connect refused",
    });

    expect(toNativeBridgeError(new Error("no code"))).toEqual({
      code: "UNKNOWN",
      message: "no code",
    });

    expect(
      toNativeBridgeError({ code: "NOT_OPEN", message: "closed" }),
    ).toEqual({
      code: "NOT_OPEN",
      message: "closed",
    });

    expect(toNativeBridgeError(undefined)).toEqual({
      code: "UNKNOWN",
      message: "undefined",
    });
  });
});

describe("error-mapping：能力错误", () => {
  it("串口未实现返回 capability 错误（如实声明，不用异常探测能力）", () => {
    const error = serialUnsupportedError("phase 1 has no serial support");
    expect(error.code).toBe("SERIAL_UNSUPPORTED");
    expect(error.category).toBe("capability");
    expect(error.retryable).toBe(false);
    expect(error.userMessageKey).toBe("errors.serialEnumerationUnsupported");
  });
});

describe("error-mapping：USB 串口（Phase 2）", () => {
  it("权限被拒 / 设备占用 / 未找到 / 拔线 各自映射到既有串口文案", () => {
    const cases: Array<[string, string, string]> = [
      [
        "USB_PERMISSION_DENIED",
        "SERIAL_PERMISSION_DENIED",
        "errors.serialPermissionDenied",
      ],
      ["USB_DEVICE_BUSY", "SERIAL_PORT_IN_USE", "errors.serialPortInUse"],
      ["USB_DEVICE_NOT_FOUND", "SERIAL_NOT_FOUND", "errors.serialNotFound"],
      [
        "USB_DETACHED",
        "SERIAL_DEVICE_DISCONNECTED",
        "errors.serialDeviceDisconnected",
      ],
      ["USB_OPEN_FAILED", "SERIAL_OPEN_FAILED", "errors.serialOpenFailed"],
      [
        "USB_PARAMETERS_UNSUPPORTED",
        "SERIAL_PARAMETER_UNSUPPORTED",
        "errors.serialParameterUnsupported",
      ],
    ];

    for (const [nativeCode, expectedCode, expectedKey] of cases) {
      const error = mapAndroidNativeError(
        { code: nativeCode, message: "detail" },
        "serial-open",
      );
      expect(error.code).toBe(expectedCode);
      expect(error.userMessageKey).toBe(expectedKey);
      expect(error.technicalMessage).toContain("detail");
    }
  });

  it("驱动不支持 → capability 错误（不重试）", () => {
    const error = mapAndroidNativeError(
      { code: "USB_DRIVER_UNSUPPORTED", message: "unknown chip" },
      "serial-open",
    );
    expect(error.code).toBe("SERIAL_DRIVER_UNSUPPORTED");
    expect(error.category).toBe("capability");
    expect(error.retryable).toBe(false);
    expect(error.userMessageKey).toBe("errors.serialDriverUnsupported");
  });

  it("写入失败按串口上下文映射（与 TCP 的同一原生码区分）", () => {
    const serial = mapAndroidNativeError(
      { code: "WRITE_FAILED", message: "usb write failed" },
      "serial-io",
    );
    expect(serial.code).toBe("SERIAL_WRITE_FAILED");
    expect(serial.userMessageKey).toBe("errors.serialError");

    const tcp = mapAndroidNativeError(
      { code: "WRITE_FAILED", message: "tcp write failed" },
      "io",
    );
    expect(tcp.userMessageKey).toBe("errors.tcpConnectionFailed");
  });

  it("未识别码按串口上下文兜底（不回落到 TCP 文案）", () => {
    const open = mapAndroidNativeError(
      { code: "SOMETHING_NEW", message: "boom" },
      "serial-open",
    );
    expect(open.code).toBe("SERIAL_OPEN_FAILED");

    const io = mapAndroidNativeError(
      { code: "SOMETHING_NEW", message: "boom" },
      "serial-io",
    );
    expect(io.code).toBe("SERIAL_ERROR");
    expect(io.userMessageKey).toBe("errors.serialError");
  });
});
