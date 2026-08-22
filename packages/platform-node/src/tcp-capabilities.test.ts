import { describe, expect, it } from "vitest";
import { describeNodeTcpCapabilities } from "./tcp-capabilities";

describe("describeNodeTcpCapabilities", () => {
  it("declares honest node:net capabilities", () => {
    const caps = describeNodeTcpCapabilities({ libraryVersion: "20.0.0" });
    expect(caps.host).toBe("node");
    expect(caps.library).toBe("node:net");
    expect(caps.libraryVersion).toBe("20.0.0");
    expect(caps.ipv4).toBe(true);
    expect(caps.ipv6).toBe(true);
    expect(caps.tls).toBe(false);
  });

  it("declares MBAP unit id full range 0..255 (user decision)", () => {
    const caps = describeNodeTcpCapabilities();
    expect(caps.unitIdMin).toBe(0);
    expect(caps.unitIdMax).toBe(255);
  });

  it("declares port range 1..65535", () => {
    const caps = describeNodeTcpCapabilities();
    expect(caps.portRange).toEqual([1, 65535]);
  });
});
