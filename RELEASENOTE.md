# Release Notes

## v0.0.2 (2026-08-04)

### Changed

- **Slave Address range expanded**: 1–247 → 0–255 (matches full Modbus address space)
- **UI fully in English**: all labels, buttons, placeholders, tooltips, and error messages translated

### Tests

- Vitest unit + component tests: 92 cases (added 2 for Slave Address range)
- Updated all test assertions to match English UI text
- Updated E2E test selectors for English UI

---

## v0.0.1 (2026-08-04)

### Added

- Modbus RTU serial communication (Web Serial API)
- 03H Read Holding Registers / 10H Write Multiple Registers
- Non-contiguous register monitoring in single table (15 rows × 10 columns)
- Upload row-by-row polling of TM-checked rows
- Single-row READ / WRITE instant operations
- Write preemption during Upload
- Data format switching: HEX / Unsigned Dec. / Signed Dec.
- Collapsible sidebar (Project Bar Register Mode / Address Mode)
- Comment column
- Bottom message panel (Message List + 4 tabs, mock data)
- Serial config modal (14 parameters, 7 enabled in Demo)
- Auto-close modal on successful connection
- Serial read/write timeout protection (Edge compatibility)

### Tests

- Vitest unit + component tests: 90 cases
- Playwright + Edge E2E integration tests: 7 cases
- Web Serial API Mock (ReadableStream + auto-response injection)

### Tech Stack

- React 18 + TypeScript + Vite 5 + Tailwind CSS
- Web Serial API (Chromium-based browsers only)
