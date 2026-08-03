import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    channel: 'msedge',
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npx vite',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
