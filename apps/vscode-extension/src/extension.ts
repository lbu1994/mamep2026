/**
 * Mamep2026 VSCode 扩展入口（docs/TECH_DESIGN.md §6.3、§22.2、§22.4、docs/AGENTS.md §22）。
 * 扩展装配：
 * - 命令 mamep2026.openMainPanel 创建 WebviewPanel 加载共享 UI（三端同一套 React UI）；
 * - 生产模式：打包进扩展的本地静态资源（dist/media/，由 scripts/build-vscode.mjs 产出）
 *   经 webview.asWebviewUri() 加载（构建期 CSP meta：style-src 'unsafe-inline'）；
 * - dev 模式：MAMEP_DEV_URL 覆盖为 iframe 指向 Vite dev server（与浏览器/Electron 同页面）；
 * - 类型化 RPC：Webview ↔ Extension Host 复用 packages/platform-api HostMessage v2
 *   （Envelope + Zod 校验 + kind 白名单，handleVscodeInvoke 校验一切输入，不允许任意方法名调用）；
 * - 颜色主题：activeColorTheme 变化经 color-theme-changed 事件推送 Webview；
 * - 资源释放：onDidReceiveMessage / 主题订阅 / panel dispose 全部随 context.subscriptions 管理。
 */
import * as fs from "node:fs";
import * as vscode from "vscode";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import {
  createCodecRegistry,
  registerBasicTablesCodecs,
} from "@mamep2026/communication";
import {
  createHostPluginRuntime,
  type HostPluginRuntime,
} from "@mamep2026/platform-node/plugin";
import { NodePlatformHost } from "@mamep2026/platform-node";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  toAppMessagePayload,
  toCommLogEventPayload,
  toResultPayload,
  vscodeCapabilities,
  type ColorThemeKind,
  type HostErrorMessage,
  type HostEventMessage,
  type HostResponseMessage,
} from "@mamep2026/platform-api";
import { DevFakeSerialFactory } from "./dev-fake-serial";
import { createDevFakeTcpServer, type DevFakeTcpServer } from "./dev-fake-tcp";
import {
  fakeDialogPaths,
  fakeOpenTextFile,
  fakeSaveTextFile,
} from "./dev-fake-dialog";
import type { PluginStorePort } from "@mamep2026/plugin-api";
import { GlobalStatePluginStore } from "./plugin-store";
import {
  errorEnvelope,
  extractMessageId,
  handleVscodeInvoke,
  type IpcDeps,
} from "./ipc";
import { VscodeSessionHost } from "./session-host";
import { getDevHtml } from "./webview/html";
import { buildWebviewCsp } from "./webview/prod-csp";

/** 当前主面板（单实例：重复命令 reveal）。 */
let panel: vscode.WebviewPanel | undefined;
/** 面板级订阅：dispose 时统一释放。 */
let panelDisposables: vscode.Disposable[] = [];
/** 装配后的依赖（供 deactivate 释放会话）。 */
let deps: IpcDeps | undefined;
/** 宿主侧插件执行面（供 deactivate 释放）。 */
let hostPluginsRef: HostPluginRuntime | undefined;
/** dev/e2e 假 TCP 设备（MAMEP_FAKE_TCP=1，deactivate 时停止）。 */
let fakeTcpServer: DevFakeTcpServer | null = null;
/** event Envelope 消息号（面板事件与主题事件共用，避免冲突）。 */
let eventSeq = 0;
/**
 * 会话通信统计（dev/e2e 探针）：comm-log request/response 帧计数，
 * 经 debug:get-state 返回。用于 e2e 断言「一次读取 = 恰好一次发送 + 一次收到」，
 * 不进入 UI 状态源；仅作诊断/验证用。
 */
const sessionStats = { requestFrames: 0, responseFrames: 0 };

/** 构造 HostMessage v2 event Envelope（payload 形状由 kind 契约保证，边界一次收窄）。 */
function hostEventMessage(
  kind: HostEventMessage["kind"],
  payload: unknown,
): HostEventMessage {
  return {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "event",
    messageId: `evt-${Date.now()}-${eventSeq++}`,
    kind,
    payload,
  } as HostEventMessage;
}

/**
 * 装配 Extension Host 侧 RTU 会话（docs/TECH_DESIGN §34.3.16 共享边界）：
 * 生产用 RealSerialPortFactory（serialport@13）；dev/e2e `MAMEP_FAKE_SERIAL=1` 时注入
 * DevFakeSerialFactory（宿主进程内假串口，内联 CRC16 RTU responder）。
 */
function createSessionHost(
  isDev: boolean,
  postEvent: (event: HostEventMessage) => void,
  hostPlugins: HostPluginRuntime,
): VscodeSessionHost {
  const factory =
    isDev && process.env.MAMEP_FAKE_SERIAL === "1"
      ? new DevFakeSerialFactory()
      : undefined;
  const platform = new NodePlatformHost({ factory });
  // codec 注册表：基础表 codec 为核心内建，
  // 安川 MEMOBUS 等插件 codec 由**宿主侧插件运行时**按插件存储激活后注册进同一注册表；
  // 会话按 session-connect 的 protocol 字段（codecId）解析 codec。
  const codecRegistry = hostPlugins.getCodecRegistry();
  registerBasicTablesCodecs(codecRegistry);
  return new VscodeSessionHost({
    platform,
    codecRegistry,
    // 地址变换解析（宿主侧插件运行时）：
    // 读当前插件注册表（安装/禁用/卸载后自动跟随）。
    resolveAddressTransform: hostPlugins.resolveAddressTransform,
    events: {
      onLog: (event) => {
        // 会话层帧计数（与物理写帧 1:1）：e2e 断言一次读取恰好一次收发。
        if (event.direction === "request") sessionStats.requestFrames += 1;
        else sessionStats.responseFrames += 1;
        postEvent(
          hostEventMessage("comm-log", {
            event: toCommLogEventPayload(event),
          }),
        );
      },
      onStateChange: (state) =>
        postEvent(hostEventMessage("connection-state", { state })),
      onPollResult: (pollResult) =>
        postEvent(
          hostEventMessage("poll-result", {
            key: pollResult.key,
            sheetId: pollResult.sheetId,
            address: pollResult.address,
            route: pollResult.route,
            requestGeneration: pollResult.requestGeneration,
            connectionGeneration: pollResult.connectionGeneration,
            result: toResultPayload(pollResult.result),
          }),
        ),
      onTraceSample: (sample) =>
        postEvent(hostEventMessage("trace-sample", { sample })),
      onMessage: (message) =>
        postEvent(
          hostEventMessage("app-message", {
            message: toAppMessagePayload(message),
          }),
        ),
    },
  });
}

function createDeps(
  context: vscode.ExtensionContext,
  isDev: boolean,
  postEvent: (event: HostEventMessage) => void,
  hostPlugins: HostPluginRuntime,
  pluginStore: PluginStorePort,
): IpcDeps {
  return {
    appVersion: () =>
      (context.extension.packageJSON?.version as string | undefined) ??
      "unknown",
    capabilities: () => vscodeCapabilities,
    colorTheme: () => toColorThemeKind(vscode.window.activeColorTheme.kind),
    isDev: () => isDev,
    // 自动重连 e2e：dev/e2e 探针，断开假 TCP 设备当前客户端（MAMEP_FAKE_TCP=1 时装配）。
    dropFakeTcpClients: () => {
      if (fakeTcpServer === null) return false;
      fakeTcpServer.dropClients();
      return true;
    },
    clipboardWriteText: async (text) => {
      await vscode.env.clipboard.writeText(text);
    },
    clipboardReadText: async () => vscode.env.clipboard.readText(),
    session: createSessionHost(isDev, postEvent, hostPlugins),
    sessionStats: () => ({ ...sessionStats }),
    // 通信日志 CSV 导出（save-text-file）：保存对话框 + workspace.fs 落盘。
    saveTextFile: async (options) => {
      // dev/e2e 假文件对话框（MAMEP_FAKE_DIALOG=1 && isDev 方案 A）：
      // 写入固定路径，使工作区导入导出闭环可确定性自动化（测试宿主无法桩替换真实对话框）。
      if (isDev && process.env.MAMEP_FAKE_DIALOG === "1") {
        return fakeSaveTextFile(fakeDialogPaths().savePath, options.content);
      }
      try {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(options.suggestedName),
          filters: { CSV: ["csv"], "All Files": ["*"] },
        });
        if (uri === undefined) {
          // 用户取消保存对话框：非错误。
          return ok({ saved: false, filePath: null });
        }
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(options.content, "utf8"),
        );
        return ok({ saved: true, filePath: uri.fsPath });
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
    // 工作区导入（open-text-file）：打开对话框 + workspace.fs 读 UTF-8 文本。
    openTextFile: async (options) => {
      // dev/e2e 假文件对话框（MAMEP_FAKE_DIALOG=1 && isDev 方案 A）：
      // 读固定路径；文件不存在 = 用户取消（content:null 非错误）。
      if (isDev && process.env.MAMEP_FAKE_DIALOG === "1") {
        return fakeOpenTextFile(fakeDialogPaths().openPath);
      }
      try {
        const uri = await vscode.window.showOpenDialog({
          defaultUri: vscode.Uri.file(options?.suggestedName ?? ""),
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          openLabel: "Import workspace",
          filters: { JSON: ["json"], "All Files": ["*"] },
        });
        if (uri === undefined || uri.length === 0) {
          // 用户取消打开对话框：非错误。
          return ok({ content: null });
        }
        const bytes = await vscode.workspace.fs.readFile(uri[0]!);
        return ok({ content: Buffer.from(bytes).toString("utf8") });
      } catch (cause) {
        return fail(
          createMamepError({
            code: "OPEN_TEXT_FILE_FAILED",
            category: "persistence",
            userMessageKey: "workspace.importFailed",
            technicalMessage:
              cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    },
    // 插件存储（plugin-store-load/save）：Extension Host globalState 承载。
    pluginStore,
    // 保存成功即同步宿主侧插件执行面：插件安装/卸载/启停后，
    // 宿主会话内的插件同步能力（codec / addressTransform）随之更新。
    onPluginStoreSaved: () => hostPlugins.sync(),
    hostPluginState: async () => {
      await hostPlugins.sync();
      return hostPlugins.getSnapshot();
    },
    reloadHostPlugin: async (pluginId) => {
      await hostPlugins.reload(pluginId);
      return hostPlugins.getSnapshot();
    },
  };
}

/** VSCode ColorThemeKind → 协议 ColorThemeKind（antd 仅 light/dark，高对比度映射为 dark）。 */
function toColorThemeKind(kind: vscode.ColorThemeKind): ColorThemeKind {
  switch (kind) {
    case vscode.ColorThemeKind.Dark:
    case vscode.ColorThemeKind.HighContrast:
      return "dark";
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return "light";
    default:
      return "light";
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // dev：MAMEP_DEV_URL 存在则 Webview 以 iframe 加载 dev server（浏览器/Electron 同页面）。
  const devUrl = process.env.MAMEP_DEV_URL;
  // 探针/调试能力仅开发/测试模式开放（F5 / extensionDevelopmentPath / @vscode/test-electron
  // e2e 为 ExtensionMode.Test，非 Production 即视为可探测）；生产打包（Production）禁用。
  const isDev = context.extensionMode !== vscode.ExtensionMode.Production;
  // 会话事件（通信日志/连接状态/轮询/追踪/消息）推送到当前面板；无面板时静默丢弃。
  const postEvent = (event: HostEventMessage): void => {
    if (panel !== undefined) void panel.webview.postMessage(event);
  };
  // 宿主侧插件执行面：Extension Host 从同一份插件存储
  // （context.globalState，即渲染端 plugin-store-save 的落点）加载「已启用 + same-process」
  // 插件并执行，使其贡献的同步能力（codec / addressTransform）在宿主会话中真正生效
  // 插件由 HostPluginRuntime 加载，宿主入口不静态 import 插件包。
  const pluginStore = new GlobalStatePluginStore(context.globalState);
  const hostPlugins = createHostPluginRuntime({
    store: pluginStore,
    codecRegistry: createCodecRegistry(),
    onState: (snapshot) =>
      postEvent(hostEventMessage("plugin-host-state", snapshot)),
    onIssue: (issue) => {
      // Publish structured state separately; retain host diagnostics.
      console.warn(
        `[mamep2026] host plugin issue (${issue.code}${issue.pluginId ? `, ${issue.pluginId}` : ""}): ${issue.technicalMessage}`,
      );
    },
  });
  hostPluginsRef = hostPlugins;

  const activeDeps = createDeps(
    context,
    isDev,
    postEvent,
    hostPlugins,
    pluginStore,
  );
  deps = activeDeps;
  // 宿主侧插件执行面：启动同步一次（已安装的 same-process 插件
  // 立即生效）；后续每次 plugin-store-save 由 ipc 回调再同步。
  void hostPlugins.sync();

  // dev/e2e：MAMEP_FAKE_TCP=1 时启动本地回环 Modbus TCP Server（假 TCP 设备，127.0.0.1:1502）。
  // 与 MAMEP_FAKE_SERIAL 同为宿主进程内注入（仅 dev/test 门控，生产打包不装配）。
  if (isDev && process.env.MAMEP_FAKE_TCP === "1") {
    fakeTcpServer = createDevFakeTcpServer();
    void fakeTcpServer.start().catch(() => {
      // 端口占用等启动失败：e2e 会因连接失败暴露，此处静默。
      fakeTcpServer = null;
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("mamep2026.openMainPanel", () => {
      openMainPanel(context, activeDeps, devUrl);
    }),
    // dev/测试探针命令（e2e/调试用）：返回当前面板引用。
    // 仅扩展宿主进程内代码可调用命令（Webview 无法调用），暴露面板引用无安全风险；
    // 真正敏感的状态探针（debug:get-state RPC）仍由 isDev 门控。
    vscode.commands.registerCommand("mamep2026.debug:getPanel", () => panel),
    // dev/e2e：经真实 HostMessage v2 RPC 路径（schema 校验 → ipc 分发 → 会话 → 串口）
    // 驱动 RTU 闭环（tests/e2e-vscode/run.test.ts）。生产构建禁用；返回 response/error Envelope。
    vscode.commands.registerCommand(
      "mamep2026.debug:rpc",
      (raw: unknown): Promise<HostResponseMessage | HostErrorMessage> => {
        if (!isDev) {
          return Promise.resolve(
            errorEnvelope(
              extractMessageId(raw),
              "DEBUG_PROBE_DISABLED",
              "debug rpc is disabled in production",
              "capability",
            ),
          );
        }
        return handleVscodeInvoke(raw, activeDeps);
      },
    ),
    // 颜色主题变化 → 推送 color-theme-changed 事件。
    vscode.window.onDidChangeActiveColorTheme(() => {
      if (panel !== undefined) postThemeEvent(panel, activeDeps.colorTheme());
    }),
    // 重载/重启后恢复面板（需 activationEvents: onWebviewPanel:mamep2026.mainPanel）。
    vscode.window.registerWebviewPanelSerializer("mamep2026.mainPanel", {
      deserializeWebviewPanel: async (webviewPanel) => {
        panel = webviewPanel;
        setupPanel(webviewPanel, activeDeps);
        webviewPanel.webview.html = getWebviewHtml(
          webviewPanel.webview,
          context.extensionUri,
          devUrl,
        );
        postThemeEvent(webviewPanel, activeDeps.colorTheme());
      },
    }),
  );
}

function openMainPanel(
  context: vscode.ExtensionContext,
  deps: IpcDeps,
  devUrl: string | undefined,
): void {
  if (panel !== undefined) {
    panel.reveal(vscode.ViewColumn.One);
    return;
  }
  const mediaUri = vscode.Uri.joinPath(context.extensionUri, "dist", "media");
  panel = vscode.window.createWebviewPanel(
    "mamep2026.mainPanel",
    "Mamep2026",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      // Webview 只能加载 localResourceRoots 内的资源（安全边界，docs/AGENTS.md §22.2）。
      localResourceRoots: [mediaUri],
    },
  );
  setupPanel(panel, deps);
  // 面板图标：复用共享 UI 的 favicon.svg（dist/media 下，构建期拷贝）。
  const iconPath = vscode.Uri.joinPath(mediaUri, "favicon.svg");
  if (fs.existsSync(iconPath.fsPath)) {
    panel.iconPath = iconPath;
  }
  panel.webview.html = getWebviewHtml(
    panel.webview,
    context.extensionUri,
    devUrl,
  );
}

/** 面板级事件接线（重复打开 / serializer 恢复时先释放旧订阅）。 */
function setupPanel(p: vscode.WebviewPanel, deps: IpcDeps): void {
  for (const disposable of panelDisposables) disposable.dispose();
  panelDisposables = [
    p.webview.onDidReceiveMessage((raw) => {
      void handleVscodeInvoke(raw, deps).then((reply) => {
        // 面板可能已 dispose：postMessage 前校验（onDidDispose 会把 panel 置 undefined）。
        if (panel !== p) return;
        void p.webview.postMessage(reply);
      });
    }),
    p.onDidDispose(() => {
      panel = undefined;
      for (const disposable of panelDisposables) disposable.dispose();
      panelDisposables = [];
      // Webview 关闭即断开（用户决策）：释放 RTU 会话与串口，避免端口占用。
      void deps?.session.dispose();
    }),
    p.onDidChangeViewState((event) => {
      // 面板重新可见时重推主题，保证与宿主当前主题一致。
      if (event.webviewPanel.visible) postThemeEvent(p, deps.colorTheme());
    }),
  ];
}

/** 推送 color-theme-changed 事件（HostMessage v2 event Envelope）。 */
function postThemeEvent(p: vscode.WebviewPanel, theme: ColorThemeKind): void {
  const event: HostEventMessage = {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "event",
    messageId: `evt-${Date.now()}`,
    kind: "color-theme-changed",
    payload: { theme },
  };
  void p.webview.postMessage(event);
}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  devUrl: string | undefined,
): string {
  if (devUrl === undefined) return getProdHtml(webview, extensionUri);
  // dev 模式：主 frame 以 iframe 加载 dev server + 中继脚本桥接 window.mamepHost
  // （详见 webview/html.ts；iframe 内应用用 postMessage 桥，主 frame 中继到扩展宿主）。
  return getDevHtml({ devUrl });
}

/**
 * 生产模式：读取打包进扩展的共享 UI 构建产物（dist/media/index.html），把相对资源路径
 * 重写为 webview.asWebviewUri()（仅允许 localResourceRoots 内资源），并在 module script
 * 之前注入 webview bridge 经典脚本（同步执行、先于 deferred module script，保证
 * window.mamepHost 先于共享 UI 就绪）。
 * CSP：VSCode 1.134+ 的 webview 资源经 file+.vscode-resource.vscode-cdn.net 虚拟源加载
 * （非文档同源），构建期静态 CSP 的 'self' 会拦截脚本；因此用 webview.cspSource（资源源）
 * 重写 CSP meta，并保留 style-src 'unsafe-inline'（antd CSS-in-JS）。
 */
function getProdHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const mediaUri = vscode.Uri.joinPath(extensionUri, "dist", "media");
  const indexHtml = fs.readFileSync(
    vscode.Uri.joinPath(mediaUri, "index.html").fsPath,
    "utf8",
  );
  const bridgeUri = webview.asWebviewUri(
    vscode.Uri.joinPath(mediaUri, "vscode-bridge.js"),
  );
  const toWebviewUri = (mediaPath: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, mediaPath)).toString();

  // Webview 专用 CSP：资源源用 webview.cspSource（VSCode 版本无关），'self' 保留兜底。
  // 策略内容见 ./webview/prod-csp.ts（含插件 Blob Worker 所需 worker-src）。
  const bundledCsp =
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(
      indexHtml,
    )?.[1] ?? "";
  const csp = buildWebviewCsp(webview.cspSource, bundledCsp);

  return (
    indexHtml
      // <base> 指向 media 的 asWebviewUri 根：兜底运行时构造的相对 URL（标准 Webview 模式）。
      .replace(
        "<head>",
        `<head>\n    <base href="${webview.asWebviewUri(mediaUri).toString()}" />`,
      )
      // 用 Webview 专用 CSP 替换构建期静态 CSP meta（'self' 在 1.134+ 会拦截脚本）。
      .replace(
        /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
      .replace(/\.\/assets\/([^"']+\.js)/g, (_match, file: string) =>
        toWebviewUri(`assets/${file}`),
      )
      .replace(/\.\/assets\/([^"']+\.css)/g, (_match, file: string) =>
        toWebviewUri(`assets/${file}`),
      )
      .replace(
        /href="\.\/favicon\.svg"/,
        () => `href="${toWebviewUri("favicon.svg")}"`,
      )
      .replace(
        '<script type="module"',
        `<script src="${bridgeUri}"></script>\n    <script type="module"`,
      )
  );
}

export async function deactivate(): Promise<void> {
  for (const disposable of panelDisposables) disposable.dispose();
  panelDisposables = [];
  panel = undefined;
  // 扩展停用（§22.2）：释放会话（断开连接/释放串口），避免端口残留占用。
  const sessionDisposal = deps?.session.dispose();
  // 释放宿主侧插件执行面：注销插件并清空宿主注册表。
  hostPluginsRef?.dispose();
  hostPluginsRef = undefined;
  // 停止 dev/e2e 假 TCP 设备（若已启动）。
  if (fakeTcpServer !== null) {
    await fakeTcpServer.stop();
    fakeTcpServer = null;
  }
  await sessionDisposal;
  deps = undefined;
}
