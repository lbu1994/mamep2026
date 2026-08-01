# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mamep2026 Demo — a browser-based Modbus RTU debugging tool replicating Yaskawa Mamep2006's core UX. Single-table layout for non-contiguous register monitoring, using Web Serial API for direct serial port communication from the browser.

## Build & Run

```bash
npm install        # Install dependencies (uses npmmirror.com registry)
npm run dev        # Start Vite dev server (default http://localhost:5173)
npm run build      # TypeScript check + Vite production build → dist/
npm run preview    # Preview production build
```

`npx tsc --noEmit` for TypeScript type-checking only.

## Tech Stack

- **React 18** with hooks (useState, useRef, useCallback)
- **Vite 5** for dev/build
- **TypeScript** (strict mode)
- **Tailwind CSS 3** for styling
- **Web Serial API** (Chromium-only, no polyfill needed beyond `@types/w3c-web-serial`)

## Architecture

```
App.tsx (global state: rows, uploading, config modal open/close)
  ├── AppHeader          — nav bar: app name + serial config button (enabled) + plugin button (disabled)
  ├── Sidebar            — vertical Project Bar buttons (all disabled, placeholder)
  ├── [Tab placeholder]  — MAC(R)Default label (disabled)
  ├── TabToolbar         — Upload (enabled), Enter(ROM/RAM) + Slave Address (disabled)
  ├── RegisterTable      — Core: 15 fixed rows × 9 columns, TM/Name/Reg[HEX]/Read/Data/Write/Type
  └── MessageBar         — Bottom panel with 4 tabs, static mock content

SerialConfigModal (Modal overlay, opened from AppHeader)
  — 7 enabled fields (Port/Speed/DataLen/StopBit/Parity/SlaveAddr/RxDelay)
  — 7 disabled fields (FlowControl/ByteAccType/Endian/ReadVerify/RetryCounter/CheckCode/AddrAdjust)
```

### Data Flow for Modbus Communication

1. User clicks "Upload" → `handleUpload` iterates all TM-checked rows
2. Each row: `buildRead03(slaveAddr, addr)` → `serial.sendAndReceive(frame, rxDelay)` → `parseRead03(response)` → `setState` per-row
3. Write during Upload: sets `pendingWriteRef` → Upload loop detects it between rows → executes write (10H) → resumes
4. All serial operations are async/Promise-based — **never block the main thread**
5. `useRef` stores mutable state (`uploadingRef`, `pendingWriteRef`, `rowsRef`, `serialConfigRef`) to avoid stale closure issues in async callbacks

### Key lib modules

- [modbus.ts](src/lib/modbus.ts): Pure functions — CRC16 lookup table, `buildRead03()`, `parseRead03()`, `buildWrite10()`, `parseWrite10()`
- [serial.ts](src/lib/serial.ts): Web Serial API wrapper — `requestPort()`, `connect()`, `sendAndReceive()`, `disconnect()`
- [types.ts](src/lib/types.ts): `SerialConfig`, `RegisterRow`, `ConnectionStatus`, factory functions
- [useSerial.ts](src/hooks/useSerial.ts): Hook — manages SerialPort lifecycle, exposes `status/portInfo/doConnect/doDisconnect/sendAndReceive`

### UI State Conventions

- **enabled** elements: functional in Demo (Upload button, Read/Write buttons, serial config fields)
- **disabled** elements: visible but greyed out with `cursor-not-allowed` and `title="敬请期待"` — reserved for future features
- Row error state: `RegisterRow.error === true` → red-50 background + red left border, cleared on next successful read
- Normal row background: alternating emerald-50/white for even/odd rows
- Sidebar: collapsible panel with `Project Bar (Register Mode)` active and `Project Bar (Address Mode)` disabled

## Design Rules

- **布局结构**：可以模仿参考软件（如 Mamep2006）的控件位置和交互逻辑
- **配色风格**：禁止使用老式 Windows 灰色系（如 slate-200/300 大面积背景），必须使用现代配色
  - 背景层次：white → slate-50 → gray-100，最深不超过 gray-200
  - 主色调：indigo 系（brand-600 = `#4f46e5`）
  - 表格交替行：emerald-50 / white
  - 错误状态：red-50 + 红色左边框
  - 主按钮：brand-600 (indigo)，写按钮：emerald-600
  - Sidebar 激活项：brand-50 背景 + brand-700 文字

## Modbus Protocol (Demo Scope)

- **03H** (Read Holding Registers): Read single 16-bit register
- **10H** (Write Multiple Registers): Write single register (quantity=1)
- Address sent as-is (no Address Adjust offset in Demo)
- CRC-16 only (RTU standard)
- Response parsing validates CRC and checks for exception codes (0x83 / 0x90)
