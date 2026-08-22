import type { Clock } from "@mamep2026/communication";

/** Node 宿主真实时钟（setTimeout / Date.now），供 Node Platform Host 使用。 */
export const nodeClock: Clock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const id = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(id) };
  },
};
