/**
 * 自动重连协调器（docs/TECH_DESIGN.md §9.4：是否自动重连不由 Adapter 决定，而由
 * Application 层的连接策略决定；docs/AGENTS.md §11.4/§11.5、§19.2）。
 *
 * 职责边界：
 * - 仅用于 TCP（由 TcpSessionHost 装配，RtuSessionHost 不涉及）；
 * - 会话连接成功且 profile.autoReconnect=true 时 arm；用户主动 disconnect / 新 connect / dispose 时 disarm；
 * - 收到 interrupted（对端断开/传输错误）且 armed 时启动重连循环：
 *   reconnect-waiting → 指数退避等待（注入 Clock，禁散落 setTimeout）→ reconnecting →
 *   经注入 openTransport 重建传输并重连 → 成功回 connected（宿主 connect 自动恢复轮询/追踪）；
 *   失败按退避继续，达到 maxAttempts 转 failed 并上报 app-message；
 * - 用户主动断开/新连接/dispose 用 generation 计数使挂起的等待与尝试失效（幂等、异常安全），
 *   计时器不取消、到点后由 generation 拦截，避免悬挂 Promise（§11.5 停止自动重连）；
 * - 重连状态经 events.onStateChange 推送 UI，getState() 供宿主 getConnectionState() 协调。
 *
 * 策略默认值（内部，不入 profile/表单/持久化）：defaultConfig.tcp 的
 * reconnectMaxAttempts / reconnectBaseIntervalMs / reconnectMaxIntervalMs。
 */
import type {
  ConnectionState,
  Clock,
  TransportPort,
} from "@mamep2026/communication";
import {
  defaultConfig,
  type Result,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type { SessionHostEvents } from "./session-host-core";

export interface ReconnectCoordinatorOptions {
  clock: Clock;
  events: SessionHostEvents;
  /** 重建 TCP 传输（由平台宿主注入，重新 openTcpTransport；不做协议/适配层决策）。 */
  openTransport: (
    profile: TcpConnectionProfile,
  ) => Promise<Result<TransportPort>>;
  /** 用新传输执行重连（TcpSessionHost 接线：内部走 connect 路径，成功后恢复轮询/追踪并重新 arm）。 */
  performReconnect: (transport: TransportPort) => Promise<Result<void>>;
  /** 最大尝试次数（默认 defaultConfig.tcp.reconnectMaxAttempts）。 */
  maxAttempts?: number;
  /** 退避基值 ms（默认 defaultConfig.tcp.reconnectBaseIntervalMs）。 */
  baseIntervalMs?: number;
  /** 退避封顶 ms（默认 defaultConfig.tcp.reconnectMaxIntervalMs）。 */
  maxIntervalMs?: number;
}

/** 重连生命周期状态（空闲为 null；宿主回退到会话自身状态）。 */
export type ReconnectLifecycleState =
  | "reconnect-waiting"
  | "reconnecting"
  | "failed"
  | null;

export class ReconnectCoordinator {
  private readonly clock: Clock;
  private readonly events: SessionHostEvents;
  private readonly openTransport: (
    profile: TcpConnectionProfile,
  ) => Promise<Result<TransportPort>>;
  private readonly performReconnect: (
    transport: TransportPort,
  ) => Promise<Result<void>>;
  private readonly maxAttempts: number;
  private readonly baseIntervalMs: number;
  private readonly maxIntervalMs: number;

  private profile: TcpConnectionProfile | null = null;
  private armed = false;
  /** 代际计数：arm/disarm 时递增，使挂起的等待/尝试失效（幂等取消）。 */
  private generation = 0;
  private attempt = 0;
  private state: ReconnectLifecycleState = null;

  constructor(options: ReconnectCoordinatorOptions) {
    this.clock = options.clock;
    this.events = options.events;
    this.openTransport = options.openTransport;
    this.performReconnect = options.performReconnect;
    this.maxAttempts =
      options.maxAttempts ?? defaultConfig.tcp.reconnectMaxAttempts;
    this.baseIntervalMs =
      options.baseIntervalMs ?? defaultConfig.tcp.reconnectBaseIntervalMs;
    this.maxIntervalMs =
      options.maxIntervalMs ?? defaultConfig.tcp.reconnectMaxIntervalMs;
  }

  /** 连接成功时调用：仅 autoReconnect=true 时启用；重置尝试计数与状态。 */
  arm(profile: TcpConnectionProfile): void {
    this.profile = profile;
    this.armed = profile.autoReconnect;
    this.generation += 1;
    this.attempt = 0;
    this.state = null;
  }

  /** 用户主动断开 / 新 connect / dispose：停止自动重连（generation 使挂起尝试失效）。 */
  disarm(): void {
    this.armed = false;
    this.generation += 1;
    this.state = null;
  }

  /** 会话状态回调（interrupted 触发重连循环）。 */
  onSessionState(state: ConnectionState): void {
    if (state === "interrupted" && this.armed && this.profile !== null) {
      this.startReconnectLoop();
    }
  }

  /** 重连生命周期内返回当前状态（reconnect-waiting/reconnecting/failed）；否则 null。 */
  getState(): ReconnectLifecycleState {
    return this.state;
  }

  private startReconnectLoop(): void {
    const gen = this.generation;
    this.attempt = 0;
    void this.runAttempt(gen);
  }

  private isActive(gen: number): boolean {
    return this.armed && gen === this.generation;
  }

  private async runAttempt(gen: number): Promise<void> {
    if (!this.isActive(gen)) return;
    this.attempt += 1;
    if (this.attempt > this.maxAttempts) {
      this.fail(gen);
      return;
    }

    this.state = "reconnect-waiting";
    this.events.onStateChange("reconnect-waiting");
    await this.wait(this.backoffDelay(this.attempt));
    if (!this.isActive(gen)) return;

    this.state = "reconnecting";
    this.events.onStateChange("reconnecting");
    const profile = this.profile;
    if (profile === null) return;
    const openResult = await this.openTransport(profile);
    if (!this.isActive(gen)) return;
    if (!openResult.ok) {
      // 打开失败（如对端拒绝）：计为一次失败尝试，继续退避重试。
      await this.runAttempt(gen);
      return;
    }

    const connectResult = await this.performReconnect(openResult.value);
    if (!this.isActive(gen)) return;
    if (connectResult.ok) {
      // 重连成功：宿主 reconnect 路径内部已恢复轮询/追踪并重新 arm，循环结束。
      this.state = null;
      return;
    }
    // 连接建立失败（对端又断开/拒绝）：继续下一次尝试。
    await this.runAttempt(gen);
  }

  /** 等待退避间隔。不取消计时器：disarm 仅使 generation 失效，到点后由 isActive 拦截。 */
  private wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.schedule(() => resolve(), delayMs);
    });
  }

  private backoffDelay(attempt: number): number {
    return Math.min(this.baseIntervalMs * 2 ** (attempt - 1), this.maxIntervalMs);
  }

  /** 达到尝试上限：转 failed 并上报 app-message（此后停止自动重连，等待用户手动）。 */
  private fail(gen: number): void {
    if (!this.isActive(gen)) return;
    this.armed = false;
    this.state = "failed";
    this.events.onStateChange("failed");
    this.events.onMessage({
      timestamp: this.clock.now(),
      level: "error",
      messageKey: "messages.reconnectFailed",
      detail: null,
    });
  }
}
