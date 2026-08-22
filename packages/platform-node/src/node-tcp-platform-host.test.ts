import { describe, expect, it } from "vitest";
import type { TcpConnectionProfile } from "@mamep2026/domain";
import { NodeTcpPlatformHost, nodeTcpHostCapabilities } from "./node-tcp-platform-host";
import { FakeNetFactory } from "./testing/fake-socket";

/** 完整 TCP 连接配置（openTcpTransport 入参，与 NodePlatformHost 测试同构）。 */
function tcpProfile(
  host: string,
  port: number,
  unitId: number,
): TcpConnectionProfile {
  return {
    id: "conn-tcp" as TcpConnectionProfile["id"],
    name: "TCP",
    protocol: "tcp",
    host,
    port,
    unitId,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
    interRequestDelayMs: 50,
  };
}

describe("NodeTcpPlatformHost（仅 TCP 入口，零 serialport 依赖）", () => {
  it("openTcpTransport 创建 node-tcp 传输，host/port 原样透传", async () => {
    const netFactory = new FakeNetFactory();
    const host = new NodeTcpPlatformHost({ netFactory });
    const result = await host.openTcpTransport(tcpProfile("127.0.0.1", 502, 1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("node-tcp");
      expect(netFactory.created).toHaveLength(1);
      expect(netFactory.created[0]!.openedOptions).toEqual({
        host: "127.0.0.1",
        port: 502,
      });
    }
  });

  it("非法 profile 在创建连接前被拒绝", async () => {
    const netFactory = new FakeNetFactory();
    const host = new NodeTcpPlatformHost({ netFactory });
    const result = await host.openTcpTransport(tcpProfile("", 502, 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_HOST_INVALID");
      expect(result.error.category).toBe("validation");
    }
    expect(netFactory.created).toHaveLength(0);
  });

  it("能力声明：仅 TCP（modbusTcp:true / modbusRtu:false / 串口 unsupported）", () => {
    const host = new NodeTcpPlatformHost();
    expect(host.capabilities).toBe(nodeTcpHostCapabilities);
    expect(host.capabilities.modbusTcp).toBe(true);
    expect(host.capabilities.modbusRtu).toBe(false);
    expect(host.capabilities.serialPorts).toBe("unsupported");
  });

  it("注入 netFactory 与 clock 生效", () => {
    const netFactory = new FakeNetFactory();
    const clock = { now: () => 42, schedule: () => ({ cancel: () => {} }) };
    const host = new NodeTcpPlatformHost({ netFactory, clock });
    expect(host.clock).toBe(clock);
  });
});
