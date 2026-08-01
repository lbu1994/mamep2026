import { useState, useRef, useCallback } from 'react';
import type { RegisterRow, SerialConfig } from './lib/types';
import { createDefaultRows, DEFAULT_SERIAL_CONFIG } from './lib/types';
import { buildRead03, buildWrite10, parseRead03, parseWrite10 } from './lib/modbus';
import { useSerial } from './hooks/useSerial';
import AppHeader from './components/AppHeader';
import Sidebar from './components/Sidebar';
import TabToolbar from './components/TabToolbar';
import SerialConfigModal from './components/SerialConfigModal';
import RegisterTable from './components/RegisterTable';
import MessageBar from './components/MessageBar';

export default function App() {
  /* ===== 状态 ===== */
  const [rows, setRows] = useState<RegisterRow[]>(createDefaultRows);
  const [configOpen, setConfigOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /* ===== 串口 Hook ===== */
  const { status, portInfo, doConnect, doDisconnect, sendAndReceive } = useSerial();

  /* ===== Refs (避免异步闭包陷阱) ===== */
  const uploadingRef = useRef(false);
  const pendingWriteRef = useRef<{ rowId: number; value: number } | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const serialConfigRef = useRef<SerialConfig>(DEFAULT_SERIAL_CONFIG);

  /* ===== 辅助：格式化 Data 显示 ===== */
  function formatData(value: number, type: RegisterRow['type']): string {
    switch (type) {
      case 'HEX':
        return value.toString(16).toUpperCase().padStart(4, '0');
      case 'Unsigned Dec.':
        return String(value & 0xFFFF);
      case 'Signed Dec.': {
        const i16 = value > 0x7FFF ? value - 0x10000 : value;
        return String(i16);
      }
    }
  }

  function slaveAddr(): number {
    return serialConfigRef.current.slaveAddress;
  }
  function rxDelayMs(): number {
    return serialConfigRef.current.rxDelay;
  }

  /* ===== 单个读取 ===== */
  const handleRead = useCallback(async (rowId: number) => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    if (!row || !row.registerHex.trim()) return;

    const addr = parseInt(row.registerHex, 16);
    if (isNaN(addr)) return;

    try {
      const frame = buildRead03(slaveAddr(), addr);
      const response = await sendAndReceive(frame, rxDelayMs());
      const value = parseRead03(response);
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, data: formatData(value, r.type), error: false } : r,
        ),
      );
    } catch (e) {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, error: true } : r)),
      );
      console.error(`Read row ${rowId} failed:`, e);
    }
  }, [sendAndReceive]);

  /* ===== 单个写入 ===== */
  const handleWrite = useCallback(async (rowId: number) => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    if (!row || !row.registerHex.trim() || !row.data.trim()) return;

    const addr = parseInt(row.registerHex, 16);
    let value: number;
    switch (row.type) {
      case 'HEX':
        value = parseInt(row.data, 16);
        break;
      case 'Unsigned Dec.':
        value = parseInt(row.data, 10);
        break;
      case 'Signed Dec.': {
        const n = parseInt(row.data, 10);
        value = n < 0 ? n + 0x10000 : n;
        break;
      }
    }
    if (isNaN(value)) return;

    const doWrite = async () => {
      try {
        const frame = buildWrite10(slaveAddr(), addr, value & 0xFFFF);
        const response = await sendAndReceive(frame, rxDelayMs());
        parseWrite10(response);
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, error: false } : r)),
        );
      } catch (e) {
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, error: true } : r)),
        );
        console.error(`Write row ${rowId} failed:`, e);
      }
    };

    if (uploadingRef.current) {
      pendingWriteRef.current = { rowId, value };
    } else {
      await doWrite();
    }
  }, [sendAndReceive]);

  /* ===== Upload：逐行 03H 读取所有 TM 勾选行 ===== */
  const handleUpload = useCallback(async () => {
    if (uploadingRef.current) return;

    uploadingRef.current = true;
    setUploading(true);

    try {
      const currentRows = rowsRef.current;
      for (const row of currentRows) {
        if (pendingWriteRef.current) {
          const pw = pendingWriteRef.current;
          pendingWriteRef.current = null;
          try {
            const wRow = currentRows.find((r) => r.id === pw.rowId);
            if (wRow) {
              const wAddr = parseInt(wRow.registerHex, 16);
              if (!isNaN(wAddr)) {
                const frame = buildWrite10(slaveAddr(), wAddr, pw.value & 0xFFFF);
                const response = await sendAndReceive(frame, rxDelayMs());
                parseWrite10(response);
                setRows((prev) =>
                  prev.map((r) =>
                    r.id === pw.rowId ? { ...r, error: false } : r,
                  ),
                );
              }
            }
          } catch (e) {
            console.error('Pending write failed:', e);
          }
        }

        if (!row.tm || !row.registerHex.trim()) continue;

        const addr = parseInt(row.registerHex, 16);
        if (isNaN(addr)) continue;

        try {
          const frame = buildRead03(slaveAddr(), addr);
          const response = await sendAndReceive(frame, rxDelayMs());
          const value = parseRead03(response);
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id
                ? { ...r, data: formatData(value, r.type), error: false }
                : r,
            ),
          );
        } catch (e) {
          setRows((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, error: true } : r)),
          );
          console.error(`Upload row ${row.id} failed:`, e);
        }

        await delay(rxDelayMs());
      }
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }, [sendAndReceive]);

  /* ===== 连接回调 ===== */
  const handleConnect = useCallback(
    async (config: SerialConfig): Promise<boolean> => {
      serialConfigRef.current = config;
      const ok = await doConnect(config);
      return ok;
    },
    [doConnect],
  );

  /* ===== 表格行更新 ===== */
  const updateRow = useCallback(
    (rowId: number, updater: (r: RegisterRow) => RegisterRow) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? updater(r) : r)));
    },
    [],
  );

  const handleTmChange = useCallback(
    (rowId: number, checked: boolean) =>
      updateRow(rowId, (r) => ({ ...r, tm: checked })),
    [updateRow],
  );

  const handleNameChange = useCallback(
    (rowId: number, name: string) => updateRow(rowId, (r) => ({ ...r, name })),
    [updateRow],
  );

  const handleRegisterHexChange = useCallback(
    (rowId: number, hex: string) =>
      updateRow(rowId, (r) => ({ ...r, registerHex: hex })),
    [updateRow],
  );

  const handleDataChange = useCallback(
    (rowId: number, data: string) => updateRow(rowId, (r) => ({ ...r, data })),
    [updateRow],
  );

  const handleTypeChange = useCallback(
    (rowId: number, type: 'HEX' | 'Unsigned Dec.' | 'Signed Dec.') =>
      updateRow(rowId, (r) => ({ ...r, type })),
    [updateRow],
  );

  const handleCommentChange = useCallback(
    (rowId: number, comment: string) =>
      updateRow(rowId, (r) => ({ ...r, comment })),
    [updateRow],
  );

  /* ===== 渲染 ===== */
  return (
    <div className="h-screen flex flex-col">
      <AppHeader
        status={status}
        portInfo={portInfo}
        onOpenConfig={() => setConfigOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
        />

        <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
          {/* 标签页占位 */}
          <div className="flex items-center bg-white border-b border-gray-200 px-3 py-1">
            <button
              disabled
              className="px-4 py-0.5 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
            >
              MAC(R)Default
            </button>
          </div>

          <TabToolbar uploading={uploading} onUpload={handleUpload} />

          <RegisterTable
            rows={rows}
            uploading={uploading}
            onTmChange={handleTmChange}
            onNameChange={handleNameChange}
            onRegisterHexChange={handleRegisterHexChange}
            onRead={handleRead}
            onDataChange={handleDataChange}
            onWrite={handleWrite}
            onTypeChange={handleTypeChange}
            onCommentChange={handleCommentChange}
          />
        </div>
      </div>

      <MessageBar />

      <SerialConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onConnect={handleConnect}
        onDisconnect={doDisconnect}
        connected={status === 'connected'}
      />
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
