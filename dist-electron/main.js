import { BrowserWindow, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
app.whenReady().then(() => {
	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		title: "mamep2026",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => {
	app.quit();
});
//#endregion
export {};
