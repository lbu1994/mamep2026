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
      ((frame?.[bodyLength] ?? 0) | ((frame?.[bodyLength + 1] ?? 0) << 8)) >>>
      0;
    expect(actual).toBe(expected);
  });

  // ---- 多寄存器（ADR-030）----

  /** 发送多寄存器读请求（FC03, quantity）。 */
  async function readMany(
    transport: MockTransport,
    address: number,
    quantity: number,
  ): Promise<void> {
    await transport.write(
      appendCrc(
        Uint8Array.from([
          0x01,
          0x03,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ]),
      ),
    );
    await flush();
  }

  /** 发送多寄存器写请求（FC0x10, values）。 */
  async function writeMany(
    transport: MockTransport,
    address: number,
    values: readonly number[],
  ): Promise<void> {
    await transport.write(
      appendCrc(
        Uint8Array.from([
          0x01,
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          (values.length >> 8) & 0xff,
          values.length & 0xff,
          values.length * 2,
          ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
        ]),
      ),
    );
    await flush();
  }

  it("FC03 多寄存器读：返回 quantity 个寄存器值（byteCount=2N）", async () => {
    const { transport, received } = await openTransport();
    transport.setRegister(0x0000, 0x1111);
    transport.setRegister(0x0001, 0x2222);
    transport.setRegister(0x0002, 0x3333);
    await readMany(transport, 0x0000, 3);
    expect(body(received[0])).toEqual([
      0x01, 0x03, 0x06, 0x11, 0x11, 0x22, 0x22, 0x33, 0x33,
    ]);
  });

  it("FC0x10 多寄存器写：写入全部值并回执 quantity", async () => {
    const { transport, received } = await openTransport();
    await writeMany(transport, 0x0000, [0xaaaa, 0xbbbb]);
    expect(transport.getRegister(0x0000)).toBe(0xaaaa);
    expect(transport.getRegister(0x0001)).toBe(0xbbbb);
    expect(body(received[0])).toEqual([0x01, 0x10, 0x00, 0x00, 0x00, 0x02]);
  });

  it("write-value-gate 多值写：任一值超限即返回异常 0x03 且不写入", async () => {
    const { transport, received } = await openTransport();
    await writeMany(transport, 0x0400, [0x1000, 0x8000]);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x03]))),
    );
    expect(transport.getRegister(0x0400)).toBeNull();
    expect(transport.getRegister(0x0401)).toBeNull();
  });

  it("must-multi 区（0x0800）：单读/单写返回异常 0x02，多读/多写正常", async () => {
    const { transport, received } = await openTransport();
    // 单读 → 异常 0x02
    await read(transport, 0x0800);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x83, 0x02]))),
    );
    // 单写 → 异常 0x02
    await write(transport, 0x0800, 0x0001);
    expect(Array.from(received[1] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x90, 0x02]))),
    );
    expect(transport.getRegister(0x0800)).toBeNull();
    // 多读 → 正常（未设置返回 0）
    await readMany(transport, 0x0800, 2);
    expect(body(received[2])).toEqual([
      0x01, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00,
    ]);
    // 多写 → 正常
    await writeMany(transport, 0x0800, [0x1234, 0x5678]);
    expect(transport.getRegister(0x0800)).toBe(0x1234);
    expect(transport.getRegister(0x0801)).toBe(0x5678);
    expect(body(received[3])).toEqual([0x01, 0x10, 0x08, 0x00, 0x00, 0x02]);
  });

  it("非 must-multi 区单寄存器行为不变（回归）", async () => {
    const { transport, received } = await openTransport();
    transport.setRegister(0x0002, 0x1234);
    await read(transport, 0x0002);
    expect(body(received[0])).toEqual([0x01, 0x03, 0x02, 0x12, 0x34]);
  });
});

describe("MockTransport 基础表（ADR-043 E-1: FC01/FC02/FC04/FC0F）", () => {
  async function openTransport(): Promise<{
    transport: MockTransport;
    received: Uint8Array[];
  }> {
    const transport = new MockTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    return { transport, received };
  }

  function body(frame: Uint8Array | undefined): number[] {
    if (frame === undefined) return [];
    // 去掉末尾 2 字节 CRC。
    return Array.from(frame.slice(0, frame.length - 2));
  }

  it("FC01 读线圈：位打包（LSB 在前），缺省 0", async () => {
    const { transport, received } = await openTransport();
    transport.setCoil(0, 1);
    transport.setCoil(2, 1);
    transport.setCoil(3, 1);
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x04])),
    );
    await flush();
    expect(body(received[0])).toEqual([0x01, 0x01, 0x01, 0x0d]);
  });

  it("FC02 读离散输入：位打包", async () => {
    const { transport, received } = await openTransport();
    transport.setInput(5, 1);
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x02, 0x00, 0x00, 0x00, 0x08])),
    );
    await flush();
    expect(body(received[0])).toEqual([0x01, 0x02, 0x01, 0x20]);
  });

  it("FC04 读输入寄存器：16 位值", async () => {
    const { transport, received } = await openTransport();
    transport.setInputRegister(0, 0x1234);
    transport.setInputRegister(1, 0xabcd);
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x04, 0x00, 0x00, 0x00, 0x02])),
    );
    await flush();
    expect(body(received[0])).toEqual([
      0x01, 0x04, 0x04, 0x12, 0x34, 0xab, 0xcd,
    ]);
  });

  it("FC0F 写多线圈：位解包写入并回执", async () => {
    const { transport, received } = await openTransport();
    await transport.write(
      appendCrc(
        Uint8Array.from([0x01, 0x0f, 0x00, 0x00, 0x00, 0x08, 0x01, 0x8d]),
      ),
    );
    await flush();
    expect(body(received[0])).toEqual([0x01, 0x0f, 0x00, 0x00, 0x00, 0x08]);
    expect(transport.getCoil(0)).toBe(1);
    expect(transport.getCoil(1)).toBe(0);
    expect(transport.getCoil(3)).toBe(1);
    expect(transport.getCoil(7)).toBe(1);
  });

  it("FC0F 多字节写入（9 位跨字节）", async () => {
    const { transport, received } = await openTransport();
    await transport.write(
      appendCrc(
        Uint8Array.from([0x01, 0x0f, 0x00, 0x00, 0x00, 0x09, 0x02, 0x00, 0x01]),
      ),
    );
    await flush();
    expect(transport.getCoil(8)).toBe(1);
    expect(transport.getCoil(7)).toBe(0);
    expect(body(received[0])).toEqual([0x01, 0x0f, 0x00, 0x00, 0x00, 0x09]);
  });

  it("表类型专用规则生效：FC02 走离散输入读、FC0F 走线圈写（地址重叠互不干扰）", async () => {
    const { transport, received } = await openTransport();
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x02, 0x00, 0x00, 0x00, 0x01])),
    );
    await transport.write(
      appendCrc(
        Uint8Array.from([0x01, 0x0f, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01]),
      ),
    );
    await flush();
    // FC02 读离散输入（离散输入专用规则，normal）。
    expect(body(received[0])).toEqual([0x01, 0x02, 0x01, 0x00]);
    // FC0F 写线圈（线圈专用规则，normal），与离散输入区互不干扰。
    expect(transport.getCoil(0)).toBe(1);
    expect(body(received[1])).toEqual([0x01, 0x0f, 0x00, 0x00, 0x00, 0x01]);
  });

  it("未知功能码回非法功能异常", async () => {
    const { transport, received } = await openTransport();
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x05, 0x00, 0x00, 0xff, 0x00])),
    );
    await flush();
    expect(body(received[0])).toEqual([0x01, 0x85, 0x01]);
  });
});

describe("MockTransport 自定义功能码（ADR-043 E-4：0x65 读 / 0x66 写）", () => {
  async function openTransport(): Promise<{
    transport: MockTransport;
    received: Uint8Array[];
  }> {
    const transport = new MockTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    return { transport, received };
  }

  function body(frame: Uint8Array | undefined): number[] {
    if (frame === undefined) return [];
    return Array.from(frame.slice(0, frame.length - 2));
  }

  it("0x65 读（与 FC03 同构）", async () => {
    const { transport, received } = await openTransport();
    transport.setRegister(0x0001, 0x1234);
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x65, 0x00, 0x01, 0x00, 0x01])),
    );
    await flush();
    expect(body(received[0])).toEqual([0x01, 0x65, 0x02, 0x12, 0x34]);
  });

  it("0x66 写（与 FC10 同构）", async () => {
    const { transport, received } = await openTransport();
    await transport.write(
      appendCrc(
        Uint8Array.from([0x01, 0x66, 0x00, 0x01, 0x00, 0x01, 0x02, 0xab, 0xcd]),
      ),
    );
    await flush();
    expect(transport.getRegister(0x0001)).toBe(0xabcd);
    expect(body(received[0])).toEqual([0x01, 0x66, 0x00, 0x01, 0x00, 0x01]);
  });

  it("0x65 异常区返回异常响应", async () => {
    const { transport, received } = await openTransport();
    // 0x0300（NotExist 区）读异常 0x02。
    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x65, 0x03, 0x00, 0x00, 0x01])),
    );
    await flush();
    expect(body(received[0])).toEqual([0x01, 0xe5, 0x02]);
  });
});
