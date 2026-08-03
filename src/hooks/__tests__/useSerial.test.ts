import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { SerialConfig } from '../../lib/types';

const mockConn = {
  port: {} as SerialPort,
  config: {} as SerialConfig,
  sendAndReceive: vi.fn(() => Promise.resolve(new Uint8Array([0x01, 0x03, 0x02, 0x12, 0x34, 0x39, 0xCF]))),
  disconnect: vi.fn(() => Promise.resolve()),
};

const mockRequestPort = vi.fn();
const mockConnect = vi.fn();

// Mock the serial module
vi.mock('../../lib/serial', () => ({
  requestPort: (...args: unknown[]) => mockRequestPort(...args),
  connect: (...args: unknown[]) => mockConnect(...args),
}));

import { useSerial } from '../useSerial';

const TEST_CONFIG: SerialConfig = {
  port: '',
  speed: 9600,
  dataLength: 8,
  stopBit: 1,
  parity: 'None',
  slaveAddress: 1,
  rxDelay: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSerial', () => {
  it('initial status is disconnected', () => {
    const { result } = renderHook(() => useSerial());
    expect(result.current.status).toBe('disconnected');
    expect(result.current.portInfo).toBe('');
    expect(result.current.config).toBeNull();
  });

  it('doConnect transitions to connected on success', async () => {
    mockRequestPort.mockResolvedValue({ getInfo: () => ({}) });
    mockConnect.mockResolvedValue(mockConn);

    const { result } = renderHook(() => useSerial());

    await act(async () => {
      const ok = await result.current.doConnect(TEST_CONFIG);
      expect(ok).toBe(true);
    });

    expect(result.current.status).toBe('connected');
  });

  it('doConnect stays disconnected when user cancels (port null)', async () => {
    mockRequestPort.mockResolvedValue(null);

    const { result } = renderHook(() => useSerial());

    await act(async () => {
      const ok = await result.current.doConnect(TEST_CONFIG);
      expect(ok).toBe(false);
    });

    expect(result.current.status).toBe('disconnected');
  });

  it('doConnect stays disconnected on error', async () => {
    mockRequestPort.mockRejectedValue(new Error('permission denied'));

    const { result } = renderHook(() => useSerial());

    await act(async () => {
      const ok = await result.current.doConnect(TEST_CONFIG);
      expect(ok).toBe(false);
    });

    expect(result.current.status).toBe('disconnected');
  });

  it('doDisconnect clears state', async () => {
    mockRequestPort.mockResolvedValue({ getInfo: () => ({ usbVendorId: 0x1234 }) });
    mockConnect.mockResolvedValue(mockConn);

    const { result } = renderHook(() => useSerial());

    await act(async () => {
      await result.current.doConnect(TEST_CONFIG);
    });
    expect(result.current.status).toBe('connected');

    await act(async () => {
      await result.current.doDisconnect();
    });
    expect(result.current.status).toBe('disconnected');
    expect(result.current.portInfo).toBe('');
    expect(result.current.config).toBeNull();
    expect(mockConn.disconnect).toHaveBeenCalled();
  });

  it('sendAndReceive throws when not connected', async () => {
    const { result } = renderHook(() => useSerial());
    await expect(
      result.current.sendAndReceive(new Uint8Array([1, 2, 3]), 5),
    ).rejects.toThrow('未连接');
  });

  it('sendAndReceive calls underlying connection when connected', async () => {
    mockRequestPort.mockResolvedValue({ getInfo: () => ({}) });
    mockConnect.mockResolvedValue(mockConn);

    const { result } = renderHook(() => useSerial());

    await act(async () => {
      await result.current.doConnect(TEST_CONFIG);
    });

    const testFrame = new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
    const response = await result.current.sendAndReceive(testFrame, 5);

    expect(mockConn.sendAndReceive).toHaveBeenCalledWith(testFrame, 5);
    expect(response).toBeDefined();
  });
});
