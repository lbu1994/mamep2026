import { afterEach, expect, it, vi } from "vitest";
import { DevFakeSerialFactory } from "./dev-fake-serial";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("delays fake serial responses and cancels pending delivery on close", async () => {
  vi.useFakeTimers();
  vi.stubEnv("MAMEP_FAKE_SERIAL_DELAY_MS", "40");
  const port = new DevFakeSerialFactory().create({
    path: "FAKE-1",
    baudRate: 9600,
  });
  const received = vi.fn();
  port.onData(received);
  await port.open();
  const request = Uint8Array.from([1, 3, 0, 1, 0, 1, 0xd5, 0xca]);
  await port.write(request);
  await vi.advanceTimersByTimeAsync(39);
  expect(received).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(received).toHaveBeenCalledOnce();
  await port.write(request);
  await port.close();
  await vi.advanceTimersByTimeAsync(40);
  expect(received).toHaveBeenCalledOnce();
});
