/**
 * VSCode 端骨架 e2e（真实 VSCode + 扩展，生产构建路径）：
 * 1) 激活 → 命令 mamep2026.openMainPanel 打开主面板；
 * 2) Webview 生产 HTML：asWebviewUri 资源 + bridge 注入 + CSP style-src + 不含 dev server；
 * 3) Webview 内 bridge 启动后向上发送 get-color-theme request（HostMessage v1 类型化 RPC
 *    上行，VscodeAppHost 初始化主题的真实路径）——扩展宿主 handleVscodeInvoke 已接
 *    onDidReceiveMessage 并响应（响应/错误路径由 apps/vscode-extension/src/ipc.test.ts 覆盖）。
 * 运行：pnpm test:e2e:vscode（自动先 build:vscode）。
 */
import * as assert from "assert";
import * as vscode from "vscode";

const VIEW_TYPE = "mamep2026.mainPanel";
// HostMessage v1 协议版本字面量（本测试包为 CJS/node10 解析，无法 import 共享包 TS 源码）。
const HOST_MESSAGE_PROTOCOL_VERSION = 1 as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HostMessage v1 request Envelope（debug:rpc 真实路径校验用）。 */
function hostRequest(
  kind: string,
  payload: Record<string, unknown> = {},
  messageId = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
): unknown {
  return {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "request",
    messageId,
    kind,
    payload,
  };
}

/** 经真实 HostMessage RPC 路径（debug:rpc → handleVscodeInvoke → 会话 → 串口）驱动 RTU。 */
async function rpcEnvelope(
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<{
  type: string;
  kind?: string;
  payload?: unknown;
}> {
  return (await vscode.commands.executeCommand(
    "mamep2026.debug:rpc",
    hostRequest(kind, payload),
  )) as {
    type: string;
    kind?: string;
    payload?: unknown;
  };
}

/** RTU 连接配置（与 UI Connection Settings 默认一致）。 */
function rtuProfile(): Record<string, unknown> {
  return {
    id: "e2e-conn",
    name: "RTU",
    protocol: "rtu",
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off",
    requestTimeoutMs: 1000,
    retryCount: 1,
    interRequestDelayMs: 50,
    addressAdjust: "off",
    recentPortHint: null,
  };
}

function registerRow(addressValue: number | null, cellText: string): unknown {
  return {
    rowId: "e2e-row",
    order: 1,
    name: "e2e",
    comment: "",
    addressDraft: "",
    addressValue: addressValue === null ? null : { value: addressValue },
    dataType: "hex",
    pollingEnabled: false,
    traceEnabled: false,
    cellText,
    lastKnownRawValue: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * VSCode RTU 闭环（硬性 P0）：经真实 HostMessage RPC 路径验证
 * 枚举 → 连接 → FC0x10 写 → FC03 读 → 状态 → 断开，全链路走 Extension Host
 * 的 Node Serial Adapter（MAMEP_FAKE_SERIAL=1 注入 DevFakeSerialFactory）。
 */
async function runRtuLoop(): Promise<void> {
  // 1. serial-enumerate：应枚举出假端口 FAKE-1（下拉框数据源）。
  const enumerate = await rpcEnvelope("serial-enumerate");
  assert.strictEqual(
    enumerate.type,
    "response",
    "serial-enumerate should succeed",
  );
  const ports = enumerate.payload as Array<{ portId: string; label: string }>;
  const fake = ports.find((p) => p.portId === "FAKE-1");
  assert.ok(
    fake !== undefined,
    "fake serial port FAKE-1 should be enumerated (MAMEP_FAKE_SERIAL)",
  );

  // 2. session-connect。
  const connect = await rpcEnvelope("session-connect", {
    portId: "FAKE-1",
    profile: rtuProfile(),
    slaveAddress: 1,
  });
  assert.strictEqual(connect.type, "response", "session-connect should succeed");

  // 3. session-write-row：地址 1 写 0x1234（FC0x10）。
  const write = await rpcEnvelope("session-write-row", {
    row: registerRow(1, "1234"),
  });
  assert.strictEqual(write.type, "response", "session-write-row should succeed");
  assert.deepStrictEqual(write.payload, { kind: "write-succeeded-no-verify" });

  // 4. session-read-row：地址 1 读回 0x1234（FC03）。
  const read = await rpcEnvelope("session-read-row", {
    row: registerRow(1, ""),
  });
  assert.strictEqual(read.type, "response", "session-read-row should succeed");
  assert.strictEqual(
    read.payload,
    0x1234,
    "FC03 read should return the value written via FC10",
  );

  // 5. session-get-state：connected。
  const state = await rpcEnvelope("session-get-state");
  assert.strictEqual(state.type, "response");
  assert.strictEqual(
    (state.payload as { connectionState: string }).connectionState,
    "connected",
  );

  // 6. session-disconnect → disconnected。
  const disconnect = await rpcEnvelope("session-disconnect");
  assert.strictEqual(disconnect.type, "response", "session-disconnect should succeed");
  const stateAfter = await rpcEnvelope("session-get-state");
  assert.strictEqual(
    (stateAfter.payload as { connectionState: string }).connectionState,
    "disconnected",
  );
}

/** TCP 连接配置（MAMEP_FAKE_TCP 假设备 127.0.0.1:1502，与 UI Connection Settings 一致）。 */
function tcpProfile(): Record<string, unknown> {
  return {
    id: "e2e-tcp-conn",
    name: "TCP",
    protocol: "tcp",
    host: "127.0.0.1",
    port: 1502,
    unitId: 0,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
    interRequestDelayMs: 50,
  };
}

/**
 * VSCode TCP 闭环（2026-08-23 两端 TCP 接线）：经真实 HostMessage RPC 路径验证
 * 连接 → FC0x10 写 → FC03 读 → 状态 → 断开（MAMEP_FAKE_TCP=1 的 DevFakeTcpServer）。
 */
async function runTcpLoop(): Promise<void> {
  // 1. session-tcp-connect（profile 即连接参数，无串口句柄）。
  const connect = await rpcEnvelope("session-tcp-connect", {
    profile: tcpProfile(),
  });
  assert.strictEqual(
    connect.type,
    "response",
    "session-tcp-connect should succeed",
  );

  // 2. session-write-row：地址 1 写 0x1234（FC0x10）。
  const write = await rpcEnvelope("session-write-row", {
    row: registerRow(1, "1234"),
  });
  assert.strictEqual(
    write.type,
    "response",
    "session-write-row (tcp) should succeed",
  );
  assert.deepStrictEqual(write.payload, { kind: "write-succeeded-no-verify" });

  // 3. session-read-row：地址 1 读回 0x1234（FC03）。
  const read = await rpcEnvelope("session-read-row", {
    row: registerRow(1, ""),
  });
  assert.strictEqual(
    read.type,
    "response",
    "session-read-row (tcp) should succeed",
  );
  assert.strictEqual(
    read.payload,
    0x1234,
    "FC03 read should return the value written via FC10 (tcp)",
  );

  // 4. session-get-state：connected。
  const state = await rpcEnvelope("session-get-state");
  assert.strictEqual(state.type, "response");
  assert.strictEqual(
    (state.payload as { connectionState: string }).connectionState,
    "connected",
  );

  // 5. session-disconnect → disconnected。
  const disconnect = await rpcEnvelope("session-disconnect");
  assert.strictEqual(
    disconnect.type,
    "response",
    "session-disconnect (tcp) should succeed",
  );
}

/**
 * 面板关闭释放（Webview 关闭即断开，用户决策）：连接 → 关闭面板 → 会话释放
 * （串口不残留占用）→ 重新连接成功。
 */
async function runPanelCloseRelease(): Promise<void> {
  await vscode.commands.executeCommand("mamep2026.openMainPanel");
  await sleep(300);
  const panel = (await vscode.commands.executeCommand(
    "mamep2026.debug:getPanel",
  )) as vscode.WebviewPanel | undefined;
  assert.ok(panel !== undefined, "panel should be open");

  const connect = await rpcEnvelope("session-connect", {
    portId: "FAKE-1",
    profile: rtuProfile(),
    slaveAddress: 1,
  });
  assert.strictEqual(connect.type, "response", "connect before close");

  await panel.dispose();
  await sleep(300);

  // 关闭面板后会话已释放：重新连接应成功（串口未被占用 EBUSY）。
  const reconnect = await rpcEnvelope("session-connect", {
    portId: "FAKE-1",
    profile: rtuProfile(),
    slaveAddress: 1,
  });
  assert.strictEqual(
    reconnect.type,
    "response",
    "reconnect after panel close should succeed (session released)",
  );
  await rpcEnvelope("session-disconnect");
}

export async function run(): Promise<void> {
  // 1. 命令打开主面板。
  await vscode.commands.executeCommand("mamep2026.openMainPanel");
  await sleep(500);

  // 2. dev 探针取面板引用（extensionDevelopmentPath → ExtensionMode.Development）。
  const panel = (await vscode.commands.executeCommand(
    "mamep2026.debug:getPanel",
  )) as vscode.WebviewPanel | undefined;
  assert.ok(
    panel !== undefined,
    "mamep2026.debug:getPanel should return the main panel in development mode",
  );
  assert.strictEqual(panel.viewType, VIEW_TYPE);

  // 3. 生产 HTML 断言：资源已重写为 asWebviewUri（scheme 与 VSCode 版本相关，不断言具体 scheme）
  //    + bridge 注入 + CSP style-src + 无裸相对路径 + 不引用 dev server。
  const html = panel.webview.html;
  assert.ok(
    html.includes("dist/media"),
    "assets should be rewritten to webview resource URIs (asWebviewUri)",
  );
  assert.ok(
    html.includes("vscode-bridge.js"),
    "webview bridge script should be injected before the module script",
  );
  assert.ok(
    html.includes("style-src") && html.includes("'unsafe-inline'"),
    "CSP should allow inline styles (antd CSS-in-JS)",
  );
  assert.ok(
    !html.includes('src="./assets/'),
    "assets should not use bare relative paths",
  );
  assert.ok(
    !html.includes("localhost:5173"),
    "production html should not reference the dev server",
  );

  // 4. Webview bridge 启动后向上发送类型化 RPC request（VscodeAppHost 初始化主题）。
  //    缓冲式监听：面板创建后立即挂接，避免漏掉早期到达的消息。
  const rpcSeen = await new Promise<boolean>((resolve) => {
    const seen = new Set<string>();
    const timeout = setTimeout(() => resolve(seen.size > 0), 30_000);
    const sub = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const msg = raw as { type?: string; kind?: string };
      if (msg.type === "request" && typeof msg.kind === "string") {
        seen.add(msg.kind);
      }
      if (msg.kind === "get-color-theme" || msg.kind === "get-capabilities") {
        clearTimeout(timeout);
        sub.dispose();
        resolve(true);
      }
    });
  });
  assert.ok(
    rpcSeen,
    "webview should send a typed RPC request (get-color-theme / get-capabilities)",
  );

  // 5. VSCode RTU 闭环（硬性 P0）：枚举 → 连接 → 写 → 读 → 断开。
  await runRtuLoop();

  // 6. VSCode TCP 闭环（2026-08-23）：连接 → 写 → 读 → 断开。
  await runTcpLoop();

  // 7. 面板关闭释放：连接 → 关闭面板 → 会话释放 → 可重连。
  await runPanelCloseRelease();
}
