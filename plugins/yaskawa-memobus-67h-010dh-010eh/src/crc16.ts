/**
 * 标准 CRC-16/MODBUS（安川 MEMOBUS 与 Modbus RTU 共用；用户 2026-08-31 已确认与手册向量一致，
 * 见 docs/安川MEMOBUS公开协议参考.md §6）。poly 0x8005（反射 0xA001）、init 0xFFFF、xorout 0x0000，
 * 线序低字节在前。
 *
 * 独立实现，不 import 核心 protocol-modbus 的 crc16（红线：安川协议与核心零耦合，AGENTS §5.3/§10.1）。
 */
export function crc16Modbus(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** 追加 CRC-16（低字节在前，标准 Modbus 线序）。 */
export function appendCrc(body: Uint8Array): Uint8Array {
  const crc = crc16Modbus(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body);
  frame[body.length] = crc & 0xff;
  frame[body.length + 1] = (crc >> 8) & 0xff;
  return frame;
}

/** 校验帧 CRC（帧末 2 字节为 CRC）。 */
export function verifyCrc(frame: Uint8Array): boolean {
  if (frame.length < 3) return false;
  const crc = crc16Modbus(frame.subarray(0, frame.length - 2));
  return (
    frame[frame.length - 2] === (crc & 0xff) &&
    frame[frame.length - 1] === ((crc >> 8) & 0xff)
  );
}
