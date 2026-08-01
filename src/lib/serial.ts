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

  // 清空缓冲区
  if (port.readable) {
    const reader = port.readable.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // 忽略清理错误
    } finally {
      reader.releaseLock();
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
  await delay(rxDelay + 50); // 至少等 50ms 让设备回复

  // 读取响应
  const reader = port.readable.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    const deadline = Date.now() + 500; // 总超时 500ms

    while (Date.now() < deadline) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          chunks.push(value);
          totalLen += value.length;
          // RTU 响应通常 5-7 字节 (03H) 或 8 字节 (10H)
          if (totalLen >= 5) {
            // 检查是否是异常响应 (3字节 + 2 CRC)
            // 正常 03H: 5字节 (地址+03+字节数+2数据+2CRC)
            // 正常 10H: 8字节 (地址+10+2地址+2数量+2CRC)
            // 读足够的字节后尝试判断是否完整
            if (totalLen >= 8) break;
            // 再等一个小延迟看看还有没有数据
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
    reader.releaseLock();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
