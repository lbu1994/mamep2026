/**
 * 虚拟串口集成测试（Layer 2，docs/TECH_DESIGN.md §34.3.20 第二层）。
 * 前置：com0com 虚拟串口对 COM4↔COM5（仓库已有，只读写、禁止配置/提权）。
 * 默认跳过（describe.skipIf）；运行：MAMEP_SERIAL_PROTO=1 时 `pnpm test:serial:virtual`。
 * 覆盖：真实枚举 / FC03 读 / FC10 写回读 / 端口占用 / 关闭重连。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { appendCrc } from "@mamep2026/protocol-modbus";
import type { TransportPort } from "@mamep2026/communication";
import { NodePlatformHost } from "./node-platform-host";

const enabled = process.env.MAMEP_SERIAL_PROTO === "1";

const repoRoot = resolve(import.meta.dirname, "../../..");
const SLAVE_SCRIPT = resolve(
  repoRoot,
  "scripts",
  "modbus-slave",
  "modbus-rtu-slave.mjs",
);
const MASTER_PORT = "COM4";
const SLAVE_PORT = "COM5";
const SLAVE_ADDRESS = 1;

let slave: ChildProcess | null = null;

function startSlave(): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn(process.execPath, [SLAVE_SCRIPT], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    slave = child;
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectReady(new Error(`slave 未在 15s 内就绪:\n${output}`));
      }
    }, 15000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (!settled && output.includes("从站就绪")) {
        settled = true;
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectReady(
          new Error(
            `slave 提前退出 code=${code}（COM5 可能已被占用）:\n${output}`,
          ),
        );
      }
    });
  });
}

function stopSlave(): Promise<void> {
  return new Promise((resolveDone) => {
    const child = slave;
    slave = null;
    if (child === null || child.exitCode !== null) {
      resolveDone();
      return;
    }
    child.on("exit", () => resolveDone());
    child.kill("SIGTERM");
    // 兜底：2s 后强制终止。
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveDone();
    }, 2000);
  });
}

/** 收集字节直至达到 minLength，返回完整字节；超时失败。 */
function readResponse(
  transport: TransportPort,
  minLength: number,
  timeoutMs = 3000,
): Promise<Uint8Array> {
  return new Promise((resolveResponse, rejectResponse) => {
    const chunks: number[] = [];
    const timer = setTimeout(() => {
      unsubscribe();
      rejectResponse(new Error(`响应超时，已收 ${chunks.length} 字节`));
    }, timeoutMs);
    const unsubscribe = transport.onData((chunk) => {
      for (const byte of chunk) chunks.push(byte);
      if (chunks.length >= minLength) {
        clearTimeout(timer);
        unsubscribe();
        resolveResponse(Uint8Array.from(chunks));
      }
    });
  });
}

async function sendAndRead(
  transport: TransportPort,
  request: Uint8Array,
  expectedLength: number,
): Promise<Uint8Array> {
  const pending = readResponse(transport, expectedLength);
  const result = await transport.write(request);
  expect(result.ok).toBe(true);
  return pending;
}

describe.skipIf(!enabled)(
  "virtual serial integration (com0com COM4↔COM5 + modbus-slave)",
  () => {
    let host: NodePlatformHost;

    beforeAll(async () => {
      await startSlave();
      host = new NodePlatformHost();
    }, 20000);

    afterAll(async () => {
      await stopSlave();
    });

    it("枚举真实串口列表，包含 COM4 与 COM5", async () => {
      const result = await host.enumerateSerialPorts();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const paths = result.value.map((h) => h.id);
      expect(paths).toContain(MASTER_PORT);
      expect(paths).toContain(SLAVE_PORT);
    });

    it("打开 COM4 → FC03 读 0x0000 返回 1234 (0x04D2)", async () => {
      const opened = await host.openSerialTransport(
        { id: MASTER_PORT, label: MASTER_PORT },
        createDefaultRtuProfile(),
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const transport = opened.value;
      const openedResult = await transport.open();
      expect(openedResult.ok).toBe(true);
      // com0com 首帧可能被拆分：打开后稍等再发首请求（仓库实测经验）。
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      const request = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x00, 0x00, 0x00, 0x01]),
      );
      const response = await sendAndRead(transport, request, 7);
      const expected = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x02, 0x04, 0xd2]),
      );
      expect([...response]).toEqual([...expected]);
      await transport.close();
    });

    it("FC10 写 0x0001 = 0x1234 → 回读确认", async () => {
      const opened = await host.openSerialTransport(
        { id: MASTER_PORT, label: MASTER_PORT },
        createDefaultRtuProfile(),
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const transport = opened.value;
      await transport.open();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));

      const writeRequest = appendCrc(
        Uint8Array.from([
          SLAVE_ADDRESS,
          0x10,
          0x00,
          0x01,
          0x00,
          0x01,
          0x02,
          0x12,
          0x34,
        ]),
      );
      const writeResponse = await sendAndRead(transport, writeRequest, 8);
      const writeExpected = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x10, 0x00, 0x01, 0x00, 0x01]),
      );
      expect([...writeResponse]).toEqual([...writeExpected]);

      const readRequest = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x00, 0x01, 0x00, 0x01]),
      );
      const readResponseBytes = await sendAndRead(transport, readRequest, 7);
      const readExpected = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x02, 0x12, 0x34]),
      );
      expect([...readResponseBytes]).toEqual([...readExpected]);
      await transport.close();
    });

    it("从站占用 COM5 时打开 COM5 失败（端口占用 → SERIAL_PORT_IN_USE）", async () => {
      const opened = await host.openSerialTransport(
        { id: SLAVE_PORT, label: SLAVE_PORT },
        createDefaultRtuProfile(),
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const transport = opened.value;
      const result = await transport.open();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Windows 下 serialport 对已被 lock=true 占用的端口报 "Access denied"，
        // 经受控字符串匹配映射为 SERIAL_PORT_IN_USE（§34.3.9）。
        expect(result.error.code).toBe("SERIAL_PORT_IN_USE");
      }
    });

    it("关闭后重连同一端口可再次读写", async () => {
      const handle = { id: MASTER_PORT, label: MASTER_PORT };
      const first = await host.openSerialTransport(
        handle,
        createDefaultRtuProfile(),
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      await first.value.open();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      await first.value.close();
      expect(first.value.isOpen()).toBe(false);

      const second = await host.openSerialTransport(
        handle,
        createDefaultRtuProfile(),
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const openedResult = await second.value.open();
      expect(openedResult.ok).toBe(true);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      const request = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x00, 0x00, 0x00, 0x01]),
      );
      const response = await sendAndRead(second.value, request, 7);
      const expected = appendCrc(
        Uint8Array.from([SLAVE_ADDRESS, 0x03, 0x02, 0x04, 0xd2]),
      );
      expect([...response]).toEqual([...expected]);
      await second.value.close();
    });
  },
);
