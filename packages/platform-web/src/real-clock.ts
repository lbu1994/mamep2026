import type { Clock } from "@mamep2026/communication";

/** 浏览器真实时钟（setTimeout / Date.now）。 */
export const browserClock: Clock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const id = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};
