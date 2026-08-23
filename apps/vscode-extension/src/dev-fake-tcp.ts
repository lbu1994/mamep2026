/**
 * dev/e2e 假 TCP 设备（MAMEP_FAKE_TCP=1 && isDev 门控，不进生产打包路径）。
 *
 * 在 Extension Host 进程内启动本地回环 Modbus TCP Server（127.0.0.1:1502），
 * 内联 MBAP responder（FC03 读 / FC0x10 写，单寄存器表共享状态，分帧/粘包处理）。
 * 参照 DevFakeSerialFactory（MAMEP_FAKE_SERIAL）的宿主进程内注入模式；
 * 与串口不同，TCP 由本应用对外发起连接，因此 e2e 以固定 host:port 配置连接即可。
 *
 * 使用：`MAMEP_FAKE_TCP=1` 时 extension.ts 启动 `createDevFakeTcpServer()`；
 * e2e 可经 devFakeTcpState 预置/断言寄存器（仅测试用，生产构建不装配）。
 */
import * as net from "node:net";

/** 假 TCP 设备监听端点（e2e/UI 以此 host:port 连接）。 */
export const FAKE_TCP_HOST = "127.0.0.1";
export const FAKE_TCP_PORT = 1502;

/** e2e 可访问的共享寄存器状态（仅测试用）。 */
export const devFakeTcpState = {
  registers: new Map<number, number>(),
};

export function resetDevFakeTcp(): void {
  devFakeTcpState.registers.clear();
}

/** 组 MBAP 帧（tid/proto=0/length/unit + pdu），无 CRC。 */
function buildTcpFrame(tid: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const length = 1 + pdu.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = (tid >> 8) & 0xff;
  frame[1] = tid & 0xff;
  frame[4] = (length >> 8) & 0xff;
  frame[5] = length & 0xff;
  frame[6] = unitId;
  frame.set(pdu, 7);
  return frame;
}

export class DevFakeTcpServer {
  private readonly server: net.Server;

  constructor() {
    this.server = net.createServer((socket) => this.handle(socket));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(FAKE_TCP_PORT, FAKE_TCP_HOST, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  /** 单连接 MBAP 分帧处理：半包/粘包缓冲，完整帧后响应。 */
  private handle(socket: net.Socket): void {
    const buffer: number[] = [];
    socket.on("data", (chunk: Buffer) => {
      for (const byte of chunk) buffer.push(byte);
      while (true) {
        if (buffer.length < 7) return;
        const declaredLength = ((buffer[4] ?? 0) << 8) | (buffer[5] ?? 0);
        if (declaredLength < 1 || declaredLength > 254) {
          buffer.shift();
          continue;
        }
        const frameLength = 6 + declaredLength;
        if (buffer.length < frameLength) return;
        const frame = Uint8Array.from(buffer.splice(0, frameLength));
        const response = this.respond(frame);
        if (response !== null) socket.write(response);
      }
    });
    socket.on("error", () => {
      // 客户端断开等错误：忽略（连接级错误由客户端侧会话处理）。
    });
  }

  /** 内联 MBAP Modbus TCP responder（FC03 读 / FC0x10 写，与 DevFakeSerial 对齐）。 */
  private respond(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 8) return null;
    const tid = ((frame[0] ?? 0) << 8) | (frame[1] ?? 0);
    const unitId = frame[6] ?? 0;
    const functionCode = frame[7] ?? 0;
    const address = ((frame[8] ?? 0) << 8) | (frame[9] ?? 0);
    if (functionCode === 0x03) {
      const value = devFakeTcpState.registers.get(address) ?? 0;
      return buildTcpFrame(
        tid,
        unitId,
        Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
      );
    }
    if (functionCode === 0x10) {
      // FC10 写多寄存器请求 PDU：FC + addr(2) + qty(2) + byteCount(1) + data(2)。
      // MBAP 7B 后：frame[7]=fc、[8..9]=addr、[10..11]=qty、[12]=byteCount、[13..14]=值。
      const value = ((frame[13] ?? 0) << 8) | (frame[14] ?? 0);
      devFakeTcpState.registers.set(address, value);
      return buildTcpFrame(
        tid,
        unitId,
        Uint8Array.from([
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          0x00,
          0x01,
        ]),
      );
    }
    return buildTcpFrame(
      tid,
      unitId,
      Uint8Array.from([functionCode | 0x80, 0x01]),
    );
  }
}

export function createDevFakeTcpServer(): DevFakeTcpServer {
  return new DevFakeTcpServer();
}
