import { describe, expect, it } from "vitest";
import { appendCrc, crc16Modbus } from "@mamep2026/protocol-modbus";
import { MockTransport } from "./mock-transport";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MockTransport", () => {
  it("responds to FC03 reads with the stored register value", async () => {
    const transport = new MockTransport();
    await transport.open();
    transport.setRegister(0x0001, 0x1234);

    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));

    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x03, 0x00, 0x01, 0x00, 0x01])),
    );
    await flush();

    expect(received).toHaveLength(1);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x03, 0x02, 0x12, 0x34]))),
    );
  });

  it("responds to FC0x10 writes and stores the value", async () => {
    const transport = new MockTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));

    await transport.write(
      appendCrc(
        Uint8Array.from([0x01, 0x10, 0x00, 0x02, 0x00, 0x01, 0x02, 0x00, 0x42]),
      ),
    );
    await flush();

    expect(transport.getRegister(0x0002)).toBe(0x42);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(
        appendCrc(Uint8Array.from([0x01, 0x10, 0x00, 0x02, 0x00, 0x01])),
      ),
    );
  });

  it("returns a Modbus exception for unsupported function codes", async () => {
    const transport = new MockTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));

    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x06, 0x00, 0x01, 0x00, 0x42])),
    );
    await flush();

    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x86, 0x01]))),
    );
  });
});

describe("MockTransport 成功/失败场景（按地址区间规则）", () => {
  async function openTransport(
    rules?: ConstructorParameters<typeof MockTransport>[0],
  ): Promise<{
    transport: MockTransport;
    received: Uint8Array[];
  }> {
    const transport = new MockTransport(rules);
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    return { transport, received };
  }

  /** 发送单寄存器读请求（FC03）。 */
  async function read(
    transport: MockTransport,
    address: number,
  ): Promise<void> {
    await transport.write(
      appendCrc(
        Uint8Array.from([
          0x01,
          0x03,
          (address >> 8) & 0xff,
          address & 0xff,
          0x00,
          0x01,
        ]),
      ),
    );
    await flush();
  }

  /** 发送单寄存器写请求（FC0x10）。 */
  async function write(
    transport: MockTransport,
    address: number,
    value: number,
  ): Promise<void> {
    await transport.write(
      appendCrc(
        Uint8Array.from([
          0x01,
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          0x00,
          0x01,
          0x02,
          (value >> 8) & 0xff,
          value & 0xff,
        ]),
      ),
    );
    await flush();
  }

  /** 去掉 CRC 后的响应体。 */
  function body(frame: Uint8Array | undefined): number[] {
    return frame === undefined ? [] : Array.from(frame.slice(0, -2));
  }

  it("正常区（0x0000-0x000F）：读返回存储值、写成功并存储", async () => {
    const { transport, received } = await openTransport();
    transport.setRegister(0x0002, 0x1234);
    await read(transport, 0x0002);
    expect(body(received[0])).toEqual([0x01, 0x03, 0x02, 0x12, 0x34]);

    await write(transport, 0x0003, 0x00ab);
    expect(transport.getRegister(0x0003)).toBe(0x00ab);
    expect(body(received[1])).toEqual([0x01, 0x10, 0x00, 0x03, 0x00, 0x01]);
  });

  it("只读区（0x0100-0x010F）：读成功、写返回异常 0x02", async () => {
    const { transport, received } = await openTransport();
    transport.setRegister(0x0102, 0x5678);
    await read(transport, 0x0102);
    expect(body(received[0])).toEqual([0x01, 0x03, 0x02, 0x56, 0x78]);

    await write(transport, 0x0102, 0x0001);
    // 异常帧：5 字节（含 CRC），fc|0x80=0x90，exceptionCode=0x02。
    expect(Array.from(received[1] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x02]))),
    );
    expect(transport.getRegister(0x0102)).toBe(0x5678);
  });

  it("只写区（0x0200-0x020F）：写成功、读返回异常 0x02", async () => {
    const { transport, received } = await openTransport();
    await write(transport, 0x0200, 0x00ff);
    expect(transport.getRegister(0x0200)).toBe(0x00ff);
    expect(body(received[0])).toEqual([0x01, 0x10, 0x02, 0x00, 0x00, 0x01]);

    await read(transport, 0x0200);
    expect(Array.from(received[1] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x83, 0x02]))),
    );
  });

  it("不存在区（0x0300-0x030F）：读/写均返回异常 0x02", async () => {
    const { transport, received } = await openTransport();
    await read(transport, 0x0300);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x83, 0x02]))),
    );

    await write(transport, 0x0301, 0x0001);
    expect(Array.from(received[1] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x02]))),
    );
  });

  it("非法数据值区（0x0400-0x040F）：值 ≤ 0x7FFF 写成功、超出返回异常 0x03；读成功", async () => {
    const { transport, received } = await openTransport();
    await write(transport, 0x0400, 0x7fff);
    expect(transport.getRegister(0x0400)).toBe(0x7fff);
    expect(body(received[0])).toEqual([0x01, 0x10, 0x04, 0x00, 0x00, 0x01]);

    await write(transport, 0x0400, 0x8000);
    expect(Array.from(received[1] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x03]))),
    );
    expect(transport.getRegister(0x0400)).toBe(0x7fff);

    await read(transport, 0x0400);
    expect(body(received[2])).toEqual([0x01, 0x03, 0x02, 0x7f, 0xff]);
  });

  it("不支持功能区（0x0500-0x050F）：读/写均返回异常 0x01", async () => {
    const { transport, received } = await openTransport();
    await read(transport, 0x0500);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x83, 0x01]))),
    );
    await write(transport, 0x0501, 0x0001);
    expect(Array.from(received[1] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x01]))),
    );
  });

  it("无响应区（0x0600-0x060F）：读/写均不回任何帧", async () => {
    const { transport, received } = await openTransport();
    await read(transport, 0x0600);
    await write(transport, 0x0601, 0x0001);
    expect(received).toHaveLength(0);
  });

  it("未配置地址回退为正常行为（读/写成功）", async () => {
    const { transport, received } = await openTransport();
    await read(transport, 0x7fff);
    expect(body(received[0])).toEqual([0x01, 0x03, 0x02, 0x00, 0x00]);
    await write(transport, 0x1234, 0x00ab);
    expect(transport.getRegister(0x1234)).toBe(0x00ab);
    expect(body(received[1])).toEqual([0x01, 0x10, 0x12, 0x34, 0x00, 0x01]);
  });

  it("区间边界地址命中规则，紧邻区间外回退正常", async () => {
    const { transport, received } = await openTransport();
    // 0x010F 是只读区末尾：写返回 0x02。
    await write(transport, 0x010f, 0x0001);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x02]))),
    );
    // 0x0110 紧邻只读区之后：正常写成功。
    await write(transport, 0x0110, 0x00ab);
    expect(transport.getRegister(0x0110)).toBe(0x00ab);
    expect(body(received[1])).toEqual([0x01, 0x10, 0x01, 0x10, 0x00, 0x01]);
  });

  it("支持通过构造参数注入自定义规则（精确地址命中）", async () => {
    const { transport, received } = await openTransport([
      {
        start: 0x00aa,
        end: 0x00aa,
        read: { kind: "exception", exceptionCode: 0x03 },
        write: { kind: "no-response" },
      },
    ]);
    await read(transport, 0x00aa);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x83, 0x03]))),
    );
    await write(transport, 0x00aa, 0x0001);
    expect(received).toHaveLength(1);
  });

  it("异常响应帧格式正确：5 字节且 CRC 合法", async () => {
    const { transport, received } = await openTransport();
    await read(transport, 0x0300);
    const frame = received[0];
    expect(frame).toHaveLength(5);
    // 用协议包 CRC 校验（对除 CRC 外的字节）。
    const bodyLength = (frame?.length ?? 0) - 2;
    const expected = crc16Modbus(frame ?? new Uint8Array(), 0, bodyLength);
    const actual =
      ((frame?.[bodyLength] ?? 0) | ((frame?.[bodyLength + 1] ?? 0) << 8)) >>> 0;
    expect(actual).toBe(expected);
  });
});
