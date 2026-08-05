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
npm test           # Run unit + component tests (Vitest)
npm run test:e2e   # Run E2E tests (Playwright + Edge)
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
  ├── AppHeader          — nav bar: app name + version + serial config button (enabled) + plugin button (disabled)
  ├── Sidebar            — collapsible panel, Project Bar (Register Mode) active, (Address Mode) disabled
  ├── [Tab placeholder]  — MAC(R)Default label (disabled)
  ├── TabToolbar         — Upload (enabled), Enter(ROM/RAM) + Slave Address (disabled)
  ├── RegisterTable      — Core: 15 fixed rows × 10 columns, TM/Name/Reg[HEX]/WP/Read/Data/Write/Type/Comment
  └── MessageBar         — Bottom panel with 4 tabs, static mock content

SerialConfigModal (Modal overlay, opened from AppHeader)
  — 7 enabled fields (Port/Speed/DataLen/StopBit/Parity/SlaveAddr/RxDelay)
  — 7 disabled fields (FlowControl/ByteAccType/Endian/ReadVerify/RetryCounter/CheckCode/AddrAdjust)
  — Auto-closes on successful connection
```

### Data Flow for Modbus Communication

1. User clicks "Upload" → `handleUpload` iterates all TM-checked rows
2. Each row: `buildRead03(slaveAddr, addr)` → `serial.sendAndReceive(frame, rxDelay)` → `parseRead03(response)` → `setState` per-row
3. Write during Upload: sets `pendingWriteRef` → Upload loop detects it between rows → executes write (10H) → resumes
4. All serial operations are async/Promise-based — **never block the main thread**
5. `useRef` stores mutable state (`uploadingRef`, `pendingWriteRef`, `rowsRef`, `serialConfigRef`) to avoid stale closure issues in async callbacks

### Key lib modules

- [modbus.ts](src/lib/modbus.ts): Pure functions — CRC16 lookup table, `buildRead03()`, `parseRead03()`, `buildWrite10()`, `parseWrite10()`
- [serial.ts](src/lib/serial.ts): Web Serial API wrapper — `requestPort()`, `connect()`, `sendAndReceive()`, `disconnect()`; uses `reader.cancel()` with timeouts to prevent blocking on Edge
- [types.ts](src/lib/types.ts): `SerialConfig`, `RegisterRow`, `ConnectionStatus`, factory functions
- [useSerial.ts](src/hooks/useSerial.ts): Hook — manages SerialPort lifecycle, exposes `status/portInfo/doConnect/doDisconnect/sendAndReceive`

### Test Architecture

```
unit tests (Vitest):
  src/lib/__tests__/modbus.test.ts      — CRC16 + RTU frame encode/decode (28 cases)
  src/lib/__tests__/types.test.ts        — Factory functions + default config (10 cases)
  src/lib/__tests__/serial.test.ts       — Web Serial API wrapper with mock port (9 cases)
  src/hooks/__tests__/useSerial.test.ts  — Hook state machine with mock serial module (7 cases)
  src/components/__tests__/*.test.tsx    — 6 components, DOM rendering + interactions (36 cases)

E2E tests (Playwright + Edge):
  tests/serial-e2e.spec.ts               — Full UI integration with injected serial mock (7 cases)
  tests/serial-mock.js                   — navigator.serial replacement injected via addInitScript()
```

### UI State Conventions

- **enabled** elements: functional in Demo (Upload button, Read/Write buttons, serial config fields)
- **disabled** elements: visible but greyed out with `cursor-not-allowed` and `title="Coming Soon"` — reserved for future features
- Row error state: `RegisterRow.error === true` → red-50 background + red left border, cleared on next successful read
- Normal row background: alternating emerald-50/white for even/odd rows
- Sidebar: collapsible panel with `Project Bar (Register Mode)` active and `Project Bar (Address Mode)` disabled

## Design Rules

- **Layout**: Mimic the control positions and interaction logic of the reference software (e.g., Mamep2006)
- **Color scheme**: No old-style Windows gray (e.g., slate-200/300 heavy backgrounds). Must use modern colors
  - Background hierarchy: white → slate-50 → gray-100, darkest no more than gray-200
  - Primary: indigo (brand-600 = `#4f46e5`)
  - Table alternating rows: emerald-50 / white
  - Error state: red-50 + red left border
  - Primary button: brand-600 (indigo), Write button: emerald-600
  - Sidebar active item: brand-50 background + brand-700 text

## Modbus Protocol (Demo Scope)

- **03H** (Read Holding Registers): Read single 16-bit register
- **10H** (Write Multiple Registers): Write single register (quantity=1)
- Slave Address range: 0–255 (configurable in Serial Config modal)
- Address sent as-is (no Address Adjust offset in Demo)
- CRC-16 only (RTU standard)
- Response parsing validates CRC and checks for exception codes (0x83 / 0x90)
