/**
 * useSerial — 串口连接状态管理 Hook
 */

import { useState, useRef, useCallback } from 'react';
import type { SerialConfig } from '../lib/types';
import type { SerialConnection } from '../lib/serial';
import { connect, requestPort } from '../lib/serial';
import type { ConnectionStatus } from '../lib/types';

export function useSerial() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [portInfo, setPortInfo] = useState<string>('');
  const [config, setConfig] = useState<SerialConfig | null>(null);
  const connRef = useRef<SerialConnection | null>(null);

  /** 建立连接 */
  const doConnect = useCallback(async (cfg: SerialConfig) => {
    setStatus('connecting');
    try {
      const port = await requestPort();
      if (!port) {
        setStatus('disconnected');
        return false;
      }
      const conn = await connect(port, cfg);
      connRef.current = conn;
      setConfig(cfg);
      const info = port.getInfo();
      const portName = info?.usbVendorId
        ? `USB VID:${info.usbVendorId.toString(16)} PID:${info.usbProductId?.toString(16)}`
        : 'COM 端口';
      setPortInfo(portName);
      setStatus('connected');
      return true;
    } catch (e) {
      setStatus('disconnected');
      console.error('连接失败:', e);
      return false;
    }
  }, []);

  /** 断开连接 */
  const doDisconnect = useCallback(async () => {
    if (connRef.current) {
      await connRef.current.disconnect();
      connRef.current = null;
    }
    setStatus('disconnected');
    setPortInfo('');
    setConfig(null);
  }, []);

  /** 发送帧并接收响应 */
  const sendAndReceive = useCallback(
    async (frame: Uint8Array, rxDelay: number): Promise<Uint8Array> => {
      if (!connRef.current) throw new Error('Not connected');
      return connRef.current.sendAndReceive(frame, rxDelay);
    },
    [],
  );

  return {
    status,
    portInfo,
    config,
    doConnect,
    doDisconnect,
    sendAndReceive,
  };
}
