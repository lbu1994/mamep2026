/**
 * CRC-16/Modbus（多项式 0xA001，初始 0xFFFF，字节序低字节在前）。
 */
export function crc16Modbus(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

/** 将 CRC 附加到帧尾（低字节在前）。 */
export function appendCrc(body: Uint8Array): Uint8Array {
  const crc = crc16Modbus(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body, 0);
  frame[body.length] = crc & 0xff;
  frame[body.length + 1] = (crc >> 8) & 0xff;
  return frame;
}
