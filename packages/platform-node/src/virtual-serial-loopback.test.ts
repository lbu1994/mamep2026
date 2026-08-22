/**
 * 虚拟串口原始字节回环测试（Layer 2，docs/TECH_DESIGN.md §34.3.20 第二层）。
 * 前置：com0com 虚拟串口对 COM4↔COM5（仓库已有，只读写、禁止配置/提权）。
 * 与 integration 测试不同：本文件不启动从站，直接双端打开 COM4↔COM5，
 * 验证 serialport 真实绑定下的原始字节透传（含 0x00/0xFF）与关闭释放。
 * 默认跳过；运行：MAMEP_SERIAL_PROTO=1 时 `pnpm test:serial:virtual`。
 */
import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import { NodePlatformHost } from "./node-platform-host";

const enabled = process.env.MAMEP_SERIAL_PROTO === "1";

function readExact(
  transport: TransportPort,
  byteCount: number,
  timeoutMs = 3000,
): Promise<Uint8Array> {
  return new Promise((resolveResponse, rejectResponse) => {
    const chunks: number[] = [];
    const timer = setTimeout(() => {
      unsubscribe();
      rejectResponse(new Error(`回环超时，已收 ${chunks.length} 字节`));
    }, timeoutMs);
    const unsubscribe = transport.onData((chunk) => {
      for (const byte of chunk) chunks.push(byte);
      if (chunks.length >= byteCount) {
        clearTimeout(timer);
        unsubscribe();
        resolveResponse(Uint8Array.from(chunks));
      }
    });
  });
}

describe.skipIf(!enabled)(
  "virtual serial loopback (com0com COM4↔COM5, no slave)",
  () => {
    const host = new NodePlatformHost();

    it("COM4→COM5 与 COM5→COM4 原始字节透传（含 0x00/0xFF）", async () => {
      const m4 = await host.openSerialTransport(
        { id: "COM4", label: "COM4" },
        createDefaultRtuProfile(),
      );
      const m5 = await host.openSerialTransport(
        { id: "COM5", label: "COM5" },
        createDefaultRtuProfile(),
      );
      expect(m4.ok && m5.ok).toBe(true);
      if (!(m4.ok && m5.ok)) return;
      const t4 = m4.value;
      const t5 = m5.value;
      const opened4 = await t4.open();
      const opened5 = await t5.open();
      expect(opened4.ok && opened5.ok).toBe(true);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));

      const payload = Uint8Array.from([0x00, 0xff, 0x01, 0x00, 0xfe, 0xff]);

      // COM4 写 → COM5 收。
      const pending5 = readExact(t5, payload.length);
      const write1 = await t4.write(payload);
      expect(write1.ok).toBe(true);
      const received5 = await pending5;
      expect([...received5]).toEqual([...payload]);

      // COM5 写 → COM4 收。
      const pending4 = readExact(t4, payload.length);
      const write2 = await t5.write(payload);
      expect(write2.ok).toBe(true);
      const received4 = await pending4;
      expect([...received4]).toEqual([...payload]);

      await t4.close();
      await t5.close();
      expect(t4.isOpen()).toBe(false);
      expect(t5.isOpen()).toBe(false);
    });

    it("多次写入与关闭后可重开", async () => {
      const open4 = await host.openSerialTransport(
        { id: "COM4", label: "COM4" },
        createDefaultRtuProfile(),
      );
      const open5 = await host.openSerialTransport(
        { id: "COM5", label: "COM5" },
        createDefaultRtuProfile(),
      );
      expect(open4.ok && open5.ok).toBe(true);
      if (!(open4.ok && open5.ok)) return;
      const t4 = open4.value;
      const t5 = open5.value;
      await t4.open();
      await t5.open();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));

      for (let i = 0; i < 5; i++) {
        const pending = readExact(t5, 2);
        const wrote = await t4.write(Uint8Array.from([i, 0xff - i]));
        expect(wrote.ok).toBe(true);
        const got = await pending;
        expect([...got]).toEqual([i, 0xff - i]);
      }

      await t4.close();
      await t5.close();

      // 重开同一端口对。
      const again4 = await host.openSerialTransport(
        { id: "COM4", label: "COM4" },
        createDefaultRtuProfile(),
      );
      const again5 = await host.openSerialTransport(
        { id: "COM5", label: "COM5" },
        createDefaultRtuProfile(),
      );
      expect(again4.ok && again5.ok).toBe(true);
      if (!(again4.ok && again5.ok)) return;
      await again4.value.open();
      await again5.value.open();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
      const pending = readExact(again5.value, 1);
      await again4.value.write(Uint8Array.from([0xab]));
      expect([...(await pending)]).toEqual([0xab]);
      await again4.value.close();
      await again5.value.close();
    });
  },
);
