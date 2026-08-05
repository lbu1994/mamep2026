import { useState } from 'react';
import type { SerialConfig } from '../lib/types';
import { DEFAULT_SERIAL_CONFIG } from '../lib/types';

interface SerialConfigModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: (config: SerialConfig) => Promise<boolean>;
  onDisconnect: () => void;
  connected: boolean;
}

const SPEED_OPTIONS = [4800, 9600, 14400, 19200, 38400, 57600, 115200];
const DATA_LENGTH_OPTIONS = [7, 8] as const;
const STOP_BIT_OPTIONS = [1, 2] as const;
const PARITY_OPTIONS = ['None', 'Even', 'Odd'] as const;
const RX_DELAY_OPTIONS = [0, 5, 10, 20, 50, 100];

export default function SerialConfigModal({
  open,
  onClose,
  onConnect,
  onDisconnect,
  connected,
}: SerialConfigModalProps) {
  const [config, setConfig] = useState<SerialConfig>(DEFAULT_SERIAL_CONFIG);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleConnect = async () => {
    setError('');
    setConnecting(true);
    try {
      const ok = await onConnect(config);
      if (!ok) {
        setConnecting(false);
        return;
      }
      setConnecting(false);
    } catch {
      setError('Connection failed, please check serial port and parameters');
      setConnecting(false);
    }
  };

  const update = <K extends keyof SerialConfig>(key: K, value: SerialConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Serial Config</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* ===== Enabled ===== */}
          <FieldRow label="Port">
            <select disabled className="input-base w-full" title="Select port via browser serial picker">
              <option>Select port after clicking connect...</option>
            </select>
          </FieldRow>

          <FieldRow label="Speed">
            <SelectOptions options={SPEED_OPTIONS} value={config.speed} onChange={(v) => update('speed', v)} />
          </FieldRow>

          <FieldRow label="Data Length">
            <SelectOptions options={DATA_LENGTH_OPTIONS} value={config.dataLength} onChange={(v) => update('dataLength', v as 7 | 8)} format={(v) => `${v} BIT`} />
          </FieldRow>

          <FieldRow label="Stop Bit">
            <SelectOptions options={STOP_BIT_OPTIONS} value={config.stopBit} onChange={(v) => update('stopBit', v as 1 | 2)} format={(v) => `${v} BIT`} />
          </FieldRow>

          <FieldRow label="Parity Bit">
            <SelectOptions options={PARITY_OPTIONS} value={config.parity} onChange={(v) => update('parity', v as 'None' | 'Even' | 'Odd')} />
          </FieldRow>

          <FieldRow label="Slave Address">
            <input
              type="number"
              min={0}
              max={255}
              value={config.slaveAddress}
              onChange={(e) => update('slaveAddress', Math.max(0, Math.min(255, Number(e.target.value) || 0)))}
              className="input-base w-24"
            />
          </FieldRow>

          <FieldRow label="Rx Delay">
            <SelectOptions options={RX_DELAY_OPTIONS} value={config.rxDelay} onChange={(v) => update('rxDelay', v)} format={(v) => `${v}ms`} />
          </FieldRow>

          {/* ===== Disabled ===== */}
          <div className="border-t border-gray-200 pt-3 mt-3">
            <p className="text-xs text-gray-400 mb-2">The following parameters are not supported (Demo)</p>
          </div>

          {disabledFields.map((field) => (
            <FieldRow key={field.label} label={field.label} disabled>
              {field.type === 'select' ? (
                <select disabled className="input-base w-full cursor-not-allowed text-gray-400 bg-gray-100">
                  <option>{field.defaultValue}</option>
                </select>
              ) : (
                <input
                  disabled
                  type="number"
                  value={field.defaultValue}
                  className="input-base w-24 cursor-not-allowed text-gray-400 bg-gray-100"
                />
              )}
            </FieldRow>
          ))}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex gap-2 justify-end">
          {connected ? (
            <button
              onClick={onDisconnect}
              className="px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                connecting
                  ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                  : 'bg-brand-600 text-white hover:bg-brand-700'
              }`}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Disabled 字段定义 ===== */
const disabledFields = [
  { label: 'Flow Control', type: 'select', defaultValue: 'OFF' },
  { label: 'Byte Acc.Type', type: 'select', defaultValue: 'Normal' },
  { label: 'Endian Type', type: 'select', defaultValue: 'Big Endian' },
  { label: 'Read Verify', type: 'select', defaultValue: 'ON' },
  { label: 'Retry Counter', type: 'number', defaultValue: '1' },
  { label: 'Check Code', type: 'select', defaultValue: 'CRC-16' },
  { label: 'Address Adjust', type: 'select', defaultValue: 'ON' },
];

/* ===== 内部辅助组件 ===== */

function FieldRow({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <label className={`w-28 text-sm text-right flex-shrink-0 ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
        {label}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SelectOptions<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o) === raw);
        if (match !== undefined) onChange(match);
      }}
      className="input-base w-full"
    >
      {options.map((opt) => (
        <option key={String(opt)} value={String(opt)}>
          {format ? format(opt) : String(opt)}
        </option>
      ))}
    </select>
  );
}
