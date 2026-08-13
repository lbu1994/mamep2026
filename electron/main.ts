/// <reference types="vite-plugin-electron/electron-env" />

import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "mamep2026",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // 网页端迁入 apps/web 后，构建产物位于 apps/web/dist/
    win.loadFile(path.join(__dirname, "../apps/web/dist/index.html"));
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
