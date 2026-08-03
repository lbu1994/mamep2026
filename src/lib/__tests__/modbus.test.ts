import { describe, it, expect } from 'vitest';
import { crc16, verifyCRC, buildRead03, parseRead03, buildWrite10, parseWrite10 } from '../modbus';

describe('crc16', () => {
  it('calculates CRC for known data (empty)', () => {
    expect(crc16(new Uint8Array([]))).toBe(0xFFFF);
  });

  it('calculates CRC for a single byte', () => {
    // 0x01 → CRC-16/MODBUS 查表
    const result = crc16(new Uint8Array([0x01]));
    expect(result).toBe(0x807E);
  });

  it('calculates CRC for standard 03H request frame', () => {
    // Slave=1, 03H, Addr=0x0000, Qty=1 (6 bytes, no CRC)
    const frame = new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
    const result = crc16(frame);
    // CRC of [01 03 00 00 00 01] → 0x0A84
    expect(result).toBe(0x0A84);
  });

  it('CRC is consistent across same data', () => {
    const data = new Uint8Array([0x01, 0x03, 0x00, 0x01, 0x00, 0x01]);
    expect(crc16(data)).toBe(crc16(data));
  });
});

describe('verifyCRC', () => {
  it('returns true for frame with correct CRC', () => {
    // Build a valid frame and verify its CRC
    const data = new Uint8Array([0x01, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02]);
    const c = crc16(data);
    const frame = new Uint8Array([...data, c & 0xFF, (c >> 8) & 0xFF]);
    expect(verifyCRC(frame)).toBe(true);
  });

  it('returns false for frame with wrong CRC', () => {
    const frame = new Uint8Array([0x01, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00]);
    expect(verifyCRC(frame)).toBe(false);
  });

  it('returns false for frame shorter than 2 bytes', () => {
    expect(verifyCRC(new Uint8Array([0x01]))).toBe(false);
    expect(verifyCRC(new Uint8Array([]))).toBe(false);
  });
});

describe('buildRead03', () => {
  it('builds correct 8-byte frame', () => {
    const frame = buildRead03(1, 0x0000, 1);
    expect(frame.length).toBe(8);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x03);
  });

  it('puts address in big-endian (Hi/Lo)', () => {
    const frame = buildRead03(1, 0x1234, 1);
    expect(frame[2]).toBe(0x12);
    expect(frame[3]).toBe(0x34);
  });

  it('puts quantity in bytes [4-5]', () => {
    const frame = buildRead03(1, 0x0000, 3);
    expect(frame[4]).toBe(0x00);
    expect(frame[5]).toBe(0x03);
  });

  it('appends valid CRC so verifyCRC returns true', () => {
    const frame = buildRead03(1, 0x0000, 1);
    expect(verifyCRC(frame)).toBe(true);
  });

  it('handles max address 0xFFFF', () => {
    const frame = buildRead03(0xFF, 0xFFFF, 1);
    expect(frame[2]).toBe(0xFF);
    expect(frame[3]).toBe(0xFF);
    expect(verifyCRC(frame)).toBe(true);
  });
});

describe('parseRead03', () => {
  it('parses valid response correctly', () => {
    // Slave=1, 03H, ByteCount=2, Data=0x1234, CRC
    const response = new Uint8Array([0x01, 0x03, 0x02, 0x12, 0x34]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(parseRead03(full)).toBe(0x1234);
  });

  it('throws on CRC mismatch', () => {
    const full = new Uint8Array([0x01, 0x03, 0x02, 0x12, 0x34, 0x00, 0x00]);
    expect(() => parseRead03(full)).toThrow('CRC 校验失败');
  });

  it('throws on exception code 0x83', () => {
    const response = new Uint8Array([0x01, 0x83, 0x02]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(() => parseRead03(full)).toThrow('设备异常响应');
  });

  it('throws on unexpected function code', () => {
    const response = new Uint8Array([0x01, 0x04, 0x02, 0x12, 0x34]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(() => parseRead03(full)).toThrow('非预期的功能码');
  });

  it('throws on frame too short (< 5 bytes)', () => {
    expect(() => parseRead03(new Uint8Array([0x01, 0x03]))).toThrow('响应帧过短');
  });

  it('throws when byte count < 2', () => {
    const response = new Uint8Array([0x01, 0x03, 0x01, 0x12, 0x34]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(() => parseRead03(full)).toThrow('响应数据长度不足');
  });
});

describe('buildWrite10', () => {
  it('builds correct 11-byte frame', () => {
    const frame = buildWrite10(1, 0x0000, 0x1234);
    expect(frame.length).toBe(11);
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(0x10);
  });

  it('puts address in big-endian', () => {
    const frame = buildWrite10(1, 0x00FF, 0x0000);
    expect(frame[2]).toBe(0x00);
    expect(frame[3]).toBe(0xFF);
  });

  it('sets quantity=1 and byte-count=2', () => {
    const frame = buildWrite10(2, 0x0000, 0xABCD);
    expect(frame[4]).toBe(0x00);
    expect(frame[5]).toBe(0x01);  // quantity = 1
    expect(frame[6]).toBe(0x02);  // byte count = 2
  });

  it('puts value in big-endian and appends valid CRC', () => {
    const frame = buildWrite10(1, 0x0000, 0xABCD);
    expect(frame[7]).toBe(0xAB);
    expect(frame[8]).toBe(0xCD);
    expect(verifyCRC(frame)).toBe(true);
  });

  it('handles 0x0000 and 0xFFFF boundary values', () => {
    const f1 = buildWrite10(1, 0x1000, 0x0000);
    expect(f1[7]).toBe(0x00);
    expect(f1[8]).toBe(0x00);
    expect(verifyCRC(f1)).toBe(true);

    const f2 = buildWrite10(1, 0x1000, 0xFFFF);
    expect(f2[7]).toBe(0xFF);
    expect(f2[8]).toBe(0xFF);
    expect(verifyCRC(f2)).toBe(true);
  });
});

describe('parseWrite10', () => {
  it('returns true for valid response', () => {
    const response = new Uint8Array([0x01, 0x10, 0x00, 0x00, 0x00, 0x01]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(parseWrite10(full)).toBe(true);
  });

  it('throws on CRC mismatch', () => {
    const full = new Uint8Array([0x01, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
    expect(() => parseWrite10(full)).toThrow('CRC 校验失败');
  });

  it('throws on exception code 0x90', () => {
    // parseWrite10 requires minimum 8 bytes; pad to meet that
    const response = new Uint8Array([0x01, 0x90, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(() => parseWrite10(full)).toThrow('设备异常响应');
  });

  it('throws on unexpected function code', () => {
    const response = new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
    const crc = crc16(response);
    const full = new Uint8Array([...response, crc & 0xFF, (crc >> 8) & 0xFF]);
    expect(() => parseWrite10(full)).toThrow('非预期的功能码');
  });

  it('throws on frame too short (< 8 bytes)', () => {
    expect(() => parseWrite10(new Uint8Array([0x01, 0x10]))).toThrow('响应帧过短');
  });
});
