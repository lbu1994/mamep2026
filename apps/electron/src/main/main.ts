/// <reference types="vite-plugin-electron/electron-env" />

/**
 * Electron 主进程（docs/TECH_DESIGN.md §6.2、§22.1、§41）。
 * Main / Preload / Renderer 三层中的 Main：窗口创建与生命周期、安全 IPC 处理
 * （版本化 Envelope + Zod 校验 + kind 白名单，docs/AGENTS.md §23）、
 * Web Serial 最小授权（ADR-017，Renderer 经 navigator.serial 走浏览器路径）、
 * 后续 TCP/文件能力的装配边界。
 *
 * Renderer 为 apps/web 同一套共享 UI（dev: VITE_DEV_SERVER_URL；生产: apps/web/dist/index.html）。
 * MVP 串口（ADR-017）：与浏览器一致经 Web Serial API，主进程仅配合 select-serial-port 权限处理；
 * 后续 Node Serial/TCP Adapter 落地后由本进程接管。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import { NodeTcpPlatformHost } from "@mamep2026/platform-node/tcp";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  MAMEP_IPC_EVENT_CHANNEL,
  MAMEP_IPC_INVOKE_CHANNEL,
  toAppMessagePayload,
  toCommLogEventPayload,
  toResultPayload,
  type HostErrorMessage,
  type HostEventMessage,
  type HostResponseMessage,
} from "@mamep2026/platform-api";
import { handleInvoke, type IpcDeps } from "./ipc";
import { ElectronSessionHost } from "./session-host";
import {
  loadConnectionConfig,
  resolveCandidatePaths,
} from "./config-loader";
import {
  deriveAllowedOrigins,
  installSerialPermissionHandlers,
  type SerialPermissionHandlers,
} from "./serial-permissions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 生产模式渲染器加载的共享 UI（apps/web 的 Electron 模式构建产物）。 */
const RENDERER_INDEX = path.join(
  __dirname,
  "../apps/web/dist-electron/index.html",
);

let mainWindow: BrowserWindow | null = null;
let eventSeq = 0;
/**
 * Web Serial 权限处理句柄（installSerialPermissionHandlers 返回值）：
 * 持有挂起的 select-serial-port callback，供 select-serial-port invoke 回传选择结果。
 * app.whenReady 后装配（在此之前无挂起请求，invoke 返回 SERIAL_PICKER_NOT_ACTIVE）。
 */
let serialPermissionHandlers: SerialPermissionHandlers | null = null;
/**
 * 主进程侧连接状态：RTU 下连接会话由 Renderer（共享 UI）驱动，主进程不跟踪实时状态，
 * 此处恒为离线（仅供 dev 探针 debug:get-state 的初始值）；TCP 会话由主进程承载，
 * 其状态经 connection-state 事件推送 Renderer（真实状态以会话为准）。
 */
const currentConnectionState: ConnectionState = "disconnected";

/** 主进程侧 TCP 会话宿主（Electron TCP 走主进程，惰性装配）。 */
let electronSessionHost: ElectronSessionHost | null = null;

/** 主进程会话事件 → 推送渲染进程（HostMessage v1 event Envelope；无窗口时静默丢弃）。 */
function postSessionEvent(event: HostEventMessage): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(MAMEP_IPC_EVENT_CHANNEL, event);
  }
}

/** 装配主进程 TCP 会话（2026-08-23 两端 TCP 接线）：NodeTcpPlatformHost（仅 TCP，零 serialport）+ TcpSessionHost。 */
function ensureSessionHost(): ElectronSessionHost {
  if (electronSessionHost === null) {
    electronSessionHost = new ElectronSessionHost({
      platform: new NodeTcpPlatformHost(),
      events: {
        onLog: (event) =>
          postSessionEvent({
            protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
            type: "event",
            messageId: nextEventId(),
            kind: "comm-log",
            payload: { event: toCommLogEventPayload(event) },
          }),
        onStateChange: (state) =>
          postSessionEvent({
            protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
            type: "event",
            messageId: nextEventId(),
            kind: "connection-state",
            payload: { state },
          }),
        onPollResult: (key, address, result) =>
          postSessionEvent({
            protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
            type: "event",
            messageId: nextEventId(),
            kind: "poll-result",
            payload: { key, address, result: toResultPayload(result) },
          }),
        onTraceSample: (sample) =>
          postSessionEvent({
            protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
            type: "event",
            messageId: nextEventId(),
            kind: "trace-sample",
            payload: { sample },
          }),
        onMessage: (message) =>
          postSessionEvent({
            protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
            type: "event",
            messageId: nextEventId(),
            kind: "app-message",
            payload: { message: toAppMessagePayload(message) },
          }),
      },
    });
  }
  return electronSessionHost;
}

function nextEventId(): string {
  eventSeq += 1;
  return `evt-${Date.now()}-${eventSeq}`;
}

/** 主进程侧真实依赖：注入可测的 ipc.ts（handleInvoke）。 */
const ipcDeps: IpcDeps = {
  appVersion: () => app.getVersion(),
  isPackaged: () => app.isPackaged,
  windowCount: () => BrowserWindow.getAllWindows().length,
  connectionState: () => currentConnectionState,
  uptimeMs: () => Math.round(process.uptime() * 1000),
  clipboardWriteText: (text) => clipboard.writeText(text),
  clipboardReadText: () => clipboard.readText(),
  resolveSerialPortSelection: (portId, sender) =>
    serialPermissionHandlers?.resolvePendingSelection(portId, sender) ?? false,
  // TCP 会话：主进程承载（Electron TCP，2026-08-23 两端 TCP 接线）。
  session: ensureSessionHost(),
  // 连接对象配置文件（ADR-023）：env > 仓库根/exe 目录 config/ > 用户数据目录。
  loadConnectionConfig: () =>
    loadConnectionConfig(
      resolveCandidatePaths({
        envPath: process.env.MAMEP_CONNECTION_CONFIG,
        appRootDir: app.isPackaged
          ? path.dirname(app.getPath("exe"))
          : process.cwd(),
        userDataDir: app.getPath("userData"),
      }),
    ),
  // 通信日志 CSV 导出（save-text-file，2026-08-28）：主进程弹保存对话框落盘。
  saveTextFile: async (options) => {
    try {
      const result = await dialog.showSaveDialog({
        title: "Export communication log",
        defaultPath: options.suggestedName,
        filters: [
          { name: "CSV", extensions: ["csv"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || result.filePath === undefined) {
        // 用户取消保存对话框：非错误。
        return ok({ saved: false, filePath: null });
      }
      await writeFile(result.filePath, options.content, "utf8");
      return ok({ saved: true, filePath: result.filePath });
    } catch (cause) {
      return fail(
        createMamepError({
          code: "SAVE_TEXT_FILE_FAILED",
          category: "persistence",
          userMessageKey: "panel.exportFailed",
          technicalMessage:
            cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  },
};

async function handleInvokeEvent(
  event: IpcMainInvokeEvent,
  raw: unknown,
): Promise<HostResponseMessage | HostErrorMessage> {
  return handleInvoke(raw, {
    isSenderMainWindow: event.sender === mainWindow?.webContents,
    sender: event.sender,
    deps: ipcDeps,
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "mamep2026",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  // 关闭默认菜单栏（File/Edit/View 等原生菜单），纯调试工具界面不需要
  win.setMenu(null);
  win.on("closed", () => {
    mainWindow = null;
  });

  // 事件通道验证：加载完成后推送初始连接状态（离线）。MVP 下 Renderer 连接状态以本地会话
  // 为准，此事件保留用于事件通道往返（ElectronAppHost 不再消费，无害）。
  win.webContents.on("did-finish-load", () => {
    const event: HostEventMessage = {
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: nextEventId(),
      kind: "connection-state",
      payload: { state: "disconnected" },
    };
    win.webContents.send(MAMEP_IPC_EVENT_CHANNEL, event);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(RENDERER_INDEX);
  }
}

app.whenReady().then(() => {
  // Web Serial 最小授权（ADR-017 扩展）：仅对本应用 origin 放行 serial 权限；
  // select-serial-port 不再自动选端口，而是把端口列表经 onPortsAvailable 转发给
  // 渲染进程（serial-ports-available 事件），由用户在下拉框选择后经安全 IPC 回传
  // （select-serial-port invoke → resolvePendingSelection 调用挂起 callback）。
  // 挂载于 defaultSession（一次），避免 macOS activate 重建窗口时重复注册 listener。
  serialPermissionHandlers = installSerialPermissionHandlers(
    session.defaultSession,
    {
      allowedOrigins: deriveAllowedOrigins(
        app.isPackaged,
        process.env.VITE_DEV_SERVER_URL,
      ),
      onPortsAvailable: (ports) => {
        const event: HostEventMessage = {
          protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
          type: "event",
          messageId: nextEventId(),
          kind: "serial-ports-available",
          payload: { ports },
        };
        mainWindow?.webContents.send(MAMEP_IPC_EVENT_CHANNEL, event);
      },
    },
  );

  ipcMain.handle(MAMEP_IPC_INVOKE_CHANNEL, handleInvokeEvent);
  createWindow();

  app.on("activate", () => {
    // macOS：点击 Dock 图标且无窗口时重建。
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // 窗口全部关闭：释放主进程 TCP 会话（断开连接/释放 socket）。
  void electronSessionHost?.dispose();
  if (process.platform !== "darwin") app.quit();
});
