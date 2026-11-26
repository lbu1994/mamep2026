import { defineConfig } from "@playwright/test";
import development from "./playwright.config";

/** Exercise the published CSP and emitted sandbox loader without hardware. */
export default defineConfig({
  ...development,
  testMatch: "plugin-authorization.spec.ts",
  use: { ...development.use, baseURL: "http://localhost:18474" },
  webServer: {
    command:
      "pnpm --dir ../../apps/web exec vite preview --port 18474 --strictPort",
    url: "http://localhost:18474",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
