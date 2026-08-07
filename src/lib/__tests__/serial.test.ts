import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SerialConfig } from '../types';

const TEST_CONFIG: SerialConfig = {
  port: 'COM3',
  speed: 9600,
  dataLength: 8,
  stopBit: 1,
  parity: 'None',
  slaveAddress: 1,
  rxDelay: 5,
};

// Must mock navigator.serial BEFORE importing the module
beforeEach(() => {
  vi.restoreAllMocks();
  const mockPort = createMockPort();
  Object.defineProperty(navigator, 'serial', {
    value: {
      requestPort: vi.fn(() => Promise.resolve(mockPort)),
      getPorts: vi.fn(() => Promise.resolve([mockPort])),
    },
    writable: true,
    configurable: true,
  });
});

/**
 * Create a mock SerialPort that handles connect() buffer clearing
 * (returns {done: true} immediately on first read to bypass cancel timeout)
 * and queues response data for subsequent sendAndReceive() reads.
 */
function createMockPort() {
  let deferredData: Uint8Array[] = [];
  let accessCount = 0;

  function makeReadable() {
    accessCount++;
    // First access: connect() buffer clear — return a stream that closes immediately (no data).
    // Second+ access: sendAndReceive — return a stream that serves deferredData.
    if (accessCount === 1) {
      // Return empty + closed stream for connect buffer clear
      return new ReadableStream<Uint8Array>({
        start(controller) { controller.close(); },
      });
    }
    // Subsequent accesses serve any pending response data
    return new ReadableStream<Uint8Array>({
      start(controller) {
        while (deferredData.length > 0) {
          controller.enqueue(deferredData.shift()!);
        }
      },
    });
  }

  return {
    get readable() { return makeReadable(); },
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        const frame = new Uint8Array(chunk);
        if (frame.length >= 2) {
          const fnCode = frame[1];
          if (fnCode === 0x03) {
            const resp = new Uint8Array([frame[0], 0x03, 0x02, 0x12, 0x34]);
            const c = computeCRC(resp);
            deferredData.push(new Uint8Array([...resp, c & 0xFF, (c >> 8) & 0xFF]));
          } else if (fnCode === 0x10) {
            const resp = new Uint8Array([frame[0], 0x10, frame[2], frame[3], 0x00, 0x01]);
            const c = computeCRC(resp);
            deferredData.push(new Uint8Array([...resp, c & 0xFF, (c >> 8) & 0xFF]));
          }
        }
      },
    }),
    open: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    getInfo: vi.fn(() => ({ usbVendorId: 0x1234, usbProductId: 0x5678 })),
  };
}

function computeCRC(data: Uint8Array): number {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
    table[i] = crc;
  }
  let crc = 0xFFFF;
  for (const byte of data) {
    crc = (crc >> 8) ^ table[(crc ^ byte) & 0xFF];
  }
  return crc;
}

async function getSerial() {
  return await import('../serial');
}

describe('listPorts', () => {
  it('returns port info list', async () => {
    const { listPorts } = await getSerial();
    const ports = await listPorts();
    expect(ports.length).toBe(1);
    expect(ports[0].usbVendorId).toBe(0x1234);
  });

  it('returns empty array on error', async () => {
    Object.defineProperty(navigator, 'serial', {
      value: { getPorts: vi.fn(() => Promise.reject(new Error('fail'))) },
      writable: true,
      configurable: true,
    });
    const { listPorts } = await getSerial();
    const ports = await listPorts();
    expect(ports).toEqual([]);
  });
});

describe('requestPort', () => {
  it('returns port when user selects', async () => {
    const { requestPort } = await getSerial();
    const port = await requestPort();
    expect(port).toBeDefined();
  });

  it('returns null on AbortError (user cancelled)', async () => {
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.reject(new DOMException('', 'AbortError'))) },
      writable: true,
      configurable: true,
    });
    const { requestPort } = await getSerial();
    const port = await requestPort();
    expect(port).toBeNull();
  });

  it('throws on non-AbortError', async () => {
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.reject(new Error('boom'))) },
      writable: true,
      configurable: true,
    });
    const { requestPort } = await getSerial();
    await expect(requestPort()).rejects.toThrow('boom');
  });
});

describe('connect', () => {
  it('opens port and returns SerialConnection', async () => {
    const { connect } = await getSerial();
    const port = await navigator.serial.requestPort();
    const conn = await connect(port as SerialPort, TEST_CONFIG);
    expect(conn).toBeDefined();
    expect(typeof conn.sendAndReceive).toBe('function');
    expect(typeof conn.disconnect).toBe('function');
  });

  it('passes correct serial options to port.open', async () => {
    const { connect } = await getSerial();
    const port = await navigator.serial.requestPort();
    const conn = await connect(port as SerialPort, TEST_CONFIG);
    expect(conn).toBeDefined();
    expect((port as unknown as { open: ReturnType<typeof vi.fn> }).open).toHaveBeenCalledWith({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    });
  });
});

describe('sendAndReceive', () => {
  it('sends frame and receives valid Modbus response', async () => {
    const { connect } = await getSerial();
    const port = await navigator.serial.requestPort();
    const conn = await connect(port as SerialPort, TEST_CONFIG);
    const frame = new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0A]);
    const response = await conn.sendAndReceive(frame, 5);
    expect(response.length).toBeGreaterThanOrEqual(5);
    expect(response[1]).toBe(0x03); // function code
  });
});

describe('disconnect', () => {
  it('closes the port', async () => {
    const { connect } = await getSerial();
    const port = await navigator.serial.requestPort();
    const conn = await connect(port as SerialPort, TEST_CONFIG);
    await conn.disconnect();
    expect((port as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
  });
});
