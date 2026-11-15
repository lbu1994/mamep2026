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
  /** must-multi 区起始地址：null=关闭；该地址起单读/单写返回异常 0x02。 */
  mustMultiStart: null as number | null,
};

export function resetDevFakeTcp(): void {
  devFakeTcpState.registers.clear();
  devFakeTcpState.mustMultiStart = null;
}

/** 组 MBAP 帧（tid/proto=0/length/unit + pdu），无 CRC。 */
function buildTcpFrame(
  tid: number,
  unitId: number,
  pdu: Uint8Array,
): Uint8Array {
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
  private readonly sockets = new Set<net.Socket>();
  /** 每条响应附加的延迟（ms 移除 Rx Delay 后为批任务取消提供窗口）。 */
  private readonly responseDelayMs: number;

  constructor(responseDelayMs = 0) {
    this.responseDelayMs = responseDelayMs;
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
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  /** 断开当前客户端连接（模拟设备断线自动重连 e2e），服务器继续监听。 */
  dropClients(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  /** 单连接 MBAP 分帧处理：半包/粘包缓冲，完整帧后响应。 */
  private handle(socket: net.Socket): void {
    this.sockets.add(socket);
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
        if (response !== null) {
          if (this.responseDelayMs > 0) {
            setTimeout(() => socket.write(response), this.responseDelayMs);
          } else {
            socket.write(response);
          }
        }
      }
    });
    socket.on("error", () => {
      // 客户端断开等错误：忽略（连接级错误由客户端侧会话处理）。
      this.sockets.delete(socket);
    });
    socket.on("close", () => {
      this.sockets.delete(socket);
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
      // FC03 读：PDU 从 frame[7]：fc + addr(2) + qty(2)。
      const quantity = ((frame[10] ?? 0) << 8) | (frame[11] ?? 0);
      // must-multi 区：单读返回非法数据地址异常。
      if (
        devFakeTcpState.mustMultiStart !== null &&
        address >= devFakeTcpState.mustMultiStart &&
        quantity === 1
      ) {
        return buildTcpFrame(tid, unitId, Uint8Array.from([0x83, 0x02]));
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(devFakeTcpState.registers.get((address + i) & 0xffff) ?? 0);
      }
      return buildTcpFrame(
        tid,
        unitId,
        Uint8Array.from([
          0x03,
          quantity * 2,
          ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
        ]),
      );
    }
    if (functionCode === 0x10) {
      // FC10 写多寄存器请求 PDU：FC + addr(2) + qty(2) + byteCount(1) + data(2N)。
      // MBAP 7B 后：frame[7]=fc、[8..9]=addr、[10..11]=qty、[12]=byteCount、[13..]=值。
      const quantity = ((frame[10] ?? 0) << 8) | (frame[11] ?? 0);
      // must-multi 区：单写返回非法数据地址异常。
      if (
        devFakeTcpState.mustMultiStart !== null &&
        address >= devFakeTcpState.mustMultiStart &&
        quantity === 1
      ) {
        return buildTcpFrame(tid, unitId, Uint8Array.from([0x90, 0x02]));
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(
          (((frame[13 + i * 2] ?? 0) << 8) | (frame[14 + i * 2] ?? 0)) & 0xffff,
        );
      }
      for (let i = 0; i < quantity; i += 1) {
        devFakeTcpState.registers.set((address + i) & 0xffff, values[i] ?? 0);
      }
      return buildTcpFrame(
        tid,
        unitId,
        Uint8Array.from([
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
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
  const delay = Number.parseInt(process.env.MAMEP_FAKE_TCP_DELAY_MS ?? "0", 10);
  return new DevFakeTcpServer(Number.isFinite(delay) && delay > 0 ? delay : 0);
}
