/**
 * Modbus RTU 协议层 — CRC16 + 03H/10H 帧编解码
 */

/** CRC16 查找表 (Modbus 多项式 0xA001) */
const CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc >>= 1;
      }
    }
    table[i] = crc;
  }
  return table;
})();

/** 计算 Modbus CRC16 */
export function crc16(data: Uint8Array): number {
  let crc = 0xFFFF;
  for (const byte of data) {
    crc = (crc >> 8) ^ CRC16_TABLE[(crc ^ byte) & 0xFF];
  }
  return crc;
}

/** CRC 校验通过返回 true */
export function verifyCRC(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  const received = (data[data.length - 1] << 8) | data[data.length - 2];
  const computed = crc16(data.subarray(0, data.length - 2));
  return received === computed;
}

/**
 * 构建 03H (Read Holding Registers) 请求帧
 * @param slaveAddr Slave address 0-255
 * @param registerAddr 寄存器起始地址 (0-based)
 * @param quantity 读取数量 (默认 1)
 */
export function buildRead03(
  slaveAddr: number,
  registerAddr: number,
  quantity: number = 1,
): Uint8Array {
  const frame = new Uint8Array(8);
  frame[0] = slaveAddr;
  frame[1] = 0x03;
  frame[2] = (registerAddr >> 8) & 0xFF;
  frame[3] = registerAddr & 0xFF;
  frame[4] = (quantity >> 8) & 0xFF;
  frame[5] = quantity & 0xFF;
  const crc = crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xFF;
  frame[7] = (crc >> 8) & 0xFF;
  return frame;
}

/**
 * 解析 03H 响应帧，返回寄存器值
 * @throws {Error} 异常响应 (功能码 0x83) 或 CRC 校验失败
 */
export function parseRead03(response: Uint8Array): number {
  if (response.length < 5) {
    throw new Error('响应帧过短');
  }
  if (!verifyCRC(response)) {
    throw new Error('CRC 校验失败');
  }
  const fnCode = response[1];
  if (fnCode === 0x83) {
    throw new Error(`设备异常响应: 0x${response[2].toString(16).padStart(2, '0')}`);
  }
  if (fnCode !== 0x03) {
    throw new Error(`非预期的功能码: 0x${fnCode.toString(16)}`);
  }
  const byteCount = response[2];
  if (byteCount < 2) {
    throw new Error('响应数据长度不足');
  }
  // 寄存器值：高字节在前 (Big Endian)
  return (response[3] << 8) | response[4];
}

/**
 * 构建 10H (Write Multiple Registers) 请求帧 (写单个寄存器)
 * @param slaveAddr 从站地址
 * @param registerAddr 寄存器地址 (0-based)
 * @param value 写入值 (16-bit)
 */
export function buildWrite10(
  slaveAddr: number,
  registerAddr: number,
  value: number,
): Uint8Array {
  const frame = new Uint8Array(11);
  frame[0] = slaveAddr;
  frame[1] = 0x10;
  frame[2] = (registerAddr >> 8) & 0xFF;
  frame[3] = registerAddr & 0xFF;
  frame[4] = 0x00;           // 寄存器数量 Hi
  frame[5] = 0x01;           // 寄存器数量 Lo (写1个)
  frame[6] = 0x02;           // 字节数
  frame[7] = (value >> 8) & 0xFF;
  frame[8] = value & 0xFF;
  const crc = crc16(frame.subarray(0, 9));
  frame[9] = crc & 0xFF;
  frame[10] = (crc >> 8) & 0xFF;
  return frame;
}

/**
 * 解析 10H 响应帧
 * @throws {Error} 异常响应或 CRC 校验失败
 */
export function parseWrite10(response: Uint8Array): boolean {
  if (response.length < 8) {
    throw new Error('响应帧过短');
  }
  if (!verifyCRC(response)) {
    throw new Error('CRC 校验失败');
  }
  const fnCode = response[1];
  if (fnCode === 0x90) {
    throw new Error(`设备异常响应: 0x${response[2].toString(16).padStart(2, '0')}`);
  }
  if (fnCode !== 0x10) {
    throw new Error(`非预期的功能码: 0x${fnCode.toString(16)}`);
  }
  return true;
}
