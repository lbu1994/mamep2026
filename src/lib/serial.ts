/**
 * Web Serial API 封装
 */

import type { SerialConfig } from './types';

/** 将用户波特率等参数转为 Web Serial API 所需的 SerialOptions */
function toSerialOptions(config: SerialConfig): SerialOptions {
  return {
    baudRate: config.speed,
    dataBits: config.dataLength,
    stopBits: config.stopBit,
    parity: config.parity.toLowerCase() as ParityType,
  };
}

/** 枚举系统可用串口 */
export async function listPorts(): Promise<SerialPortInfo[]> {
  try {
    const ports = await navigator.serial.getPorts();
    // Web Serial API 无法主动枚举未授权的串口，只能返回已授权的
    // 需要通过 requestPort() 让用户选择
    return ports.map((p) => p.getInfo());
  } catch {
    return [];
  }
}

/** 请求用户选择一个串口 */
export async function requestPort(): Promise<SerialPort | null> {
  try {
    const port = await navigator.serial.requestPort();
    return port;
  } catch (e) {
    // 用户取消选择
    if ((e as DOMException).name === 'AbortError') {
      return null;
    }
    throw e;
  }
}

export interface SerialConnection {
  port: SerialPort;
  config: SerialConfig;
  /** 发送帧并接收响应，rxDelay 为发送后等待时间(ms) */
  sendAndReceive(frame: Uint8Array, rxDelay: number): Promise<Uint8Array>;
  /** 关闭连接 */
  disconnect(): Promise<void>;
}

/** 打开串口并建立连接 */
export async function connect(
  port: SerialPort,
  config: SerialConfig,
): Promise<SerialConnection> {
  await port.open(toSerialOptions(config));

  // 清空缓冲区 (带超时，Edge 下 reader.read() 可能永久阻塞)
  if (port.readable) {
    const reader = port.readable.getReader();
    const cancelTimeout = setTimeout(() => {
      reader.cancel().catch(() => {});
    }, 100);
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // cancel() 或 read() 异常忽略
    } finally {
      clearTimeout(cancelTimeout);
      // cancel() 可能已释放锁，releaseLock 包 try
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  return {
    port,
    config,
    sendAndReceive: (frame, rxDelay) =>
      _sendAndReceive(port, frame, rxDelay),
    disconnect: () => _disconnect(port),
  };
}

/** 关闭串口 */
async function _disconnect(port: SerialPort): Promise<void> {
  try {
    if (port.writable) {
      const writer = port.writable.getWriter();
      writer.releaseLock();
    }
    if (port.readable) {
      const reader = port.readable.getReader();
      reader.releaseLock();
    }
    await port.close();
  } catch {
    // 忽略关闭错误
  }
}

/** 发送帧并等待响应 (异步非阻塞) */
async function _sendAndReceive(
  port: SerialPort,
  frame: Uint8Array,
  rxDelay: number,
): Promise<Uint8Array> {
  if (!port.writable) throw new Error('串口不可写');
  if (!port.readable) throw new Error('串口不可读');

  const writer = port.writable.getWriter();
  try {
    await writer.write(frame);
  } finally {
    writer.releaseLock();
  }

  // 等待设备处理 + Rx Delay
  await delay(rxDelay + 50);

  // 读取响应 (带总超时，防止 Edge 下 reader.read() 永久阻塞)
  const reader = port.readable.getReader();
  const totalTimeout = 500;
  const cancelTimeout = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, totalTimeout);
  try {
    const chunks: Uint8Array[] = [];
    let totalLen = 0;

    while (true) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          chunks.push(value);
          totalLen += value.length;
          // 正常 03H 响应: 5字节 (地址+03+字节数+2数据+2CRC)
          // 正常 10H 响应: 8字节 (地址+10+2地址+2数量+2CRC)
          // 读到足够字节后退出
          if (totalLen >= 5) {
            if (totalLen >= 8) break;
            // 可能还有后续数据，短暂等待
            await delay(30);
            break;
          }
        }
      } catch {
        break;
      }
    }

    if (chunks.length === 0) {
      throw new Error('未收到设备响应');
    }

    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } finally {
    clearTimeout(cancelTimeout);
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
