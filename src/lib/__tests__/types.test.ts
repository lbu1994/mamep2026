import { describe, it, expect } from 'vitest';
import { createDefaultRow, createDefaultRows, DEFAULT_SERIAL_CONFIG } from '../types';

describe('createDefaultRow', () => {
  it('sets correct id', () => {
    const row = createDefaultRow(5);
    expect(row.id).toBe(5);
  });

  it('has expected default values', () => {
    const row = createDefaultRow(1);
    expect(row.tm).toBe(false);
    expect(row.name).toBe('');
    expect(row.registerHex).toBe('');
    expect(row.wp).toBe(false);
    expect(row.data).toBe('');
    expect(row.type).toBe('HEX');
    expect(row.comment).toBe('');
    expect(row.error).toBe(false);
  });

  it('each call returns an independent object', () => {
    const r1 = createDefaultRow(1);
    const r2 = createDefaultRow(1);
    r1.name = 'test';
    expect(r2.name).toBe('');
  });
});

describe('createDefaultRows', () => {
  it('returns exactly 15 rows', () => {
    const rows = createDefaultRows();
    expect(rows.length).toBe(15);
  });

  it('ids are 1 through 15', () => {
    const rows = createDefaultRows();
    rows.forEach((row, i) => {
      expect(row.id).toBe(i + 1);
    });
  });

  it('rows are independent objects', () => {
    const rows = createDefaultRows();
    rows[0].name = 'changed';
    expect(rows[1].name).toBe('');
  });
});

describe('DEFAULT_SERIAL_CONFIG', () => {
  it('has default 9600-8-N-1', () => {
    expect(DEFAULT_SERIAL_CONFIG.speed).toBe(9600);
    expect(DEFAULT_SERIAL_CONFIG.dataLength).toBe(8);
    expect(DEFAULT_SERIAL_CONFIG.stopBit).toBe(1);
    expect(DEFAULT_SERIAL_CONFIG.parity).toBe('None');
    expect(DEFAULT_SERIAL_CONFIG.slaveAddress).toBe(1);
    expect(DEFAULT_SERIAL_CONFIG.rxDelay).toBe(5);
  });
});
