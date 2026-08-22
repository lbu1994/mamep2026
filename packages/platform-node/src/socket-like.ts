/**
 * Node TCP 库薄抽象（docs/TECH_DESIGN.md §34.3.16，Node TCP Adapter）。
 * Adapter 只依赖本接口；Node `net` 的具体类型/对象不得泄漏到 Domain、Application、UI、
 * 工作区数据或插件公开 API。真实实现见 real-socket.ts，测试注入见 testing/fake-socket.ts。
 * 与 SerialPortLike/SerialPortFactoryLike 保持同构，共享同一传输边界语义。
 */

/** 连接选项：host/port 为 TCP 打开参数（unitId 属协议层，不进入传输面）。 */
export interface TcpConnectLike {
  readonly host: string;
  readonly port: number;
}

/** 单个 TCP 连接实例面：Adapter 使用的 Node net API 最小集。 */
export interface SocketLike {
  readonly isOpen: boolean;
  /** 使用创建时给定的 host/port 建立连接；失败抛底层错误（由 error-mapping 映射）。 */
  open(): Promise<void>;
  /** 关闭并释放连接；失败抛底层错误。 */
  close(): Promise<void>;
  /**
   * 提交写入。resolve 表示已提交给 OS 缓冲（不代表对端已响应）。
   * 失败抛底层错误。
   */
  write(data: Uint8Array): Promise<void>;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
}

/** 连接工厂面：宿主注入点（§34.3.16 共享边界）。 */
export interface NetFactoryLike {
  connect(options: TcpConnectLike): SocketLike;
}
