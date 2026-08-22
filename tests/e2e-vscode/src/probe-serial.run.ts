/**
 * VSCode Extension Host 串口探针（原型，docs/TECH_DESIGN.md §34.3.15）。
 * 运行于真实 VSCode 扩展宿主（@vscode/test-electron）：
 * 尝试加载 serialport 原生模块 → 枚举 → 打开 COM4 → 与 modbus-slave（COM5）FC03 闭环 → 关闭。
 * 若原生绑定 ABI 与 VSCode 不匹配，打印 LOAD FAILED 诊断并如实报告（选型验证的预期发现）。
 * 运行：pnpm probe:vscode:serial（runner 自动拉起/关闭从站）。
 * 说明：本文件由 tsc 编译为 CJS（dist/probe-serial.run.js），在扩展宿主中执行。
 */

const SLEEP_MS = 200;
const RESPONSE_TIMEOUT_MS = 3000;
const MASTER_PORT = "COM4";
const SLAVE_ADDRESS = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** CRC16（Modbus RTU）。权威实现见 packages/protocol-modbus/src/crc16.ts。 */
function crc16(bytes: Uint8Array): Uint8Array {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return Uint8Array.from([crc & 0xff, (crc >> 8) & 0xff]);
}

function appendCrc(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes);
  out.set(crc16(bytes), bytes.length);
  return out;
}

export async function run(): Promise<void> {
  const report: string[] = [];
  report.push(
    `[probe] VSCode Extension Host versions: ${JSON.stringify({
      node: process.versions.node,
      electron: process.versions.electron,
    })}`,
  );

  let SerialPort: (typeof import("serialport"))["SerialPort"];
  try {
    ({ SerialPort } = await import("serialport"));
  } catch (cause) {
    report.push(
      `[probe] LOAD FAILED（serialport 原生绑定可能为 Node ABI，需为 VSCode 重建）: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    report.push(
      "[probe] 结果：选型验证的预期发现，记录于 ADR-020（原生模块在目标宿主 ABI 兼容性待接线阶段处理）。",
    );
    console.log(report.join("\n"));
    return;
  }

  try {
    const ports = await SerialPort.list();
    report.push(`[probe] 枚举: ${ports.map((p) => p.path).join(", ")}`);
    const target = ports.find((p) => p.path === MASTER_PORT);
    if (target === undefined) {
      report.push(
        `[probe] 未找到 ${MASTER_PORT}（com0com 未配置？），跳过打开。`,
      );
      console.log(report.join("\n"));
      return;
    }

    const port = new SerialPort({
      path: MASTER_PORT,
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false,
    });
    await new Promise<void>((resolveOpen, rejectOpen) => {
      port.open((error) => (error ? rejectOpen(error) : resolveOpen()));
    });
    report.push(`[probe] ${MASTER_PORT} 已打开`);
    await sleep(SLEEP_MS);

    const request = appendCrc(
      Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x00, 0x00, 0x00, 0x01]),
    );
    const response = await new Promise<Buffer>(
      (resolveResponse, rejectResponse) => {
        const chunks: number[] = [];
        const onData = (chunk: Buffer) => {
          for (const byte of chunk) chunks.push(byte);
          if (chunks.length >= 7) {
            port.off("data", onData);
            resolveResponse(Buffer.from(chunks));
          }
        };
        port.on("data", onData);
        setTimeout(() => {
          port.off("data", onData);
          rejectResponse(new Error("FC03 响应超时"));
        }, RESPONSE_TIMEOUT_MS);
        port.write(request);
      },
    );
    report.push(`[probe] FC03 响应: ${response.toString("hex")}`);

    await new Promise<void>((resolveClose, rejectClose) => {
      port.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
    report.push(`[probe] ${MASTER_PORT} 已关闭`);
    report.push("[probe] DONE");
  } catch (cause) {
    report.push(
      `[probe] FAILED: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  console.log(report.join("\n"));
}
