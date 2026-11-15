import type { RequestRoute } from "./request-route";
import type { Result } from "./result";

/**
 * 轮询/全表读取结果的不可变身份。
 *
 * 结果必须能证明它属于哪个表、哪一次目标绑定以及哪条发送路由；仅靠 row key
 * 和地址无法区分“同地址、不同 Unit ID/协议”或行重绑前后的请求。
 */
export interface PollResultContext {
  readonly key: string;
  readonly sheetId: string;
  /** 实际发出的用户/设备地址；不得使用 0 作为 Read All 的哨兵值。 */
  readonly address: number;
  readonly route: RequestRoute;
  /** 同一轮询目标每次绑定变化时递增。 */
  readonly requestGeneration: number;
}

/** 送往 UI 的逐行结果；connectionGeneration 用于隔离断线重连前的在途结果。 */
export interface PollResultEvent extends PollResultContext {
  readonly connectionGeneration: number;
  readonly result: Result<number | number[]>;
}
