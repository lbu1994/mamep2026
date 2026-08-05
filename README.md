# Mamep2026 Demo

A browser-based Modbus RTU debugging tool replicating Yaskawa Mamep2006's core UX. Single-table layout for non-contiguous register monitoring, using Web Serial API for direct serial port communication from the browser.

## Features

- **Single-table register monitoring** — 15 rows × 10 columns, no multi-window switching
- **Modbus RTU protocol** — 03H (Read Holding Registers) + 10H (Write Multiple Registers)
- **Upload polling** — batch read all TM-checked rows sequentially
- **Write preemption** — insert writes during ongoing Upload
- **Data formats** — HEX / Unsigned Dec. / Signed Dec.
- **Slave Address 0–255** — full Modbus address range
- **CRC-16 validation** with exception code detection

## Quick Start

```bash
npm install
npm run dev        # http://localhost:5173
```

> Requires a Chromium-based browser (Chrome, Edge) with Web Serial API support.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build |
| `npm test` | Vitest unit + component tests |
| `npm run test:e2e` | Playwright E2E tests (Edge) |

## Tech Stack

- React 18 + TypeScript (strict)
- Vite 5
- Tailwind CSS 3
- Web Serial API

## Architecture

```
App.tsx
├── AppHeader          — nav bar + serial config button + plugin button (disabled)
├── Sidebar            — collapsible panel, Register/Address mode selector
├── TabToolbar         — Upload (enabled), Enter(ROM/RAM) (disabled)
├── RegisterTable      — 15 rows × 10 columns (TM/Name/Reg[HEX]/WP/Read/Data/Write/Type/Comment)
├── MessageBar         — bottom panel, 4 tabs (mock content)
└── SerialConfigModal  — 7 enabled + 7 disabled serial config fields
```

## License

MIT
