/**
 * Node 串口库薄抽象（docs/TECH_DESIGN.md §34.3.1、§34.3.16）。
 * Adapter 只依赖本接口；serialport 的具体类型/对象/依赖不得泄漏到 Domain、Application、UI、
 * 工作区数据或插件公开 API。真实实现见 real-serial-port.ts，测试注入见 testing/fake-serial-port.ts。
 */

/** 枚举信息：path 为系统原始端口路径（不透明字符串，保证存在），其余字段可选（§34.3.2）。 */
export interface SerialPortInfoLike {
  readonly path: string;
  readonly manufacturer?: string | undefined;
  readonly serialNumber?: string | undefined;
  readonly pnpId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly productId?: string | undefined;
  readonly vendorId?: string | undefined;
}

/** 打开选项（由 RtuConnectionProfile 映射，见 serial-config.ts）。 */
export interface SerialPortOpenLike {
  readonly path: string;
  readonly baudRate: number;
  readonly dataBits?: 7 | 8 | undefined;
  readonly stopBits?: 1 | 2 | undefined;
  readonly parity?: "none" | "even" | "odd" | undefined;
  readonly rtscts?: boolean | undefined;
  readonly xon?: boolean | undefined;
  readonly xoff?: boolean | undefined;
  readonly lock?: boolean | undefined;
}

/** 单个串口实例面：Adapter 使用的库 API 最小集。 */
export interface SerialPortLike {
  readonly isOpen: boolean;
  /** 使用创建时给定的选项打开；失败抛底层错误（由 error-mapping 映射）。 */
  open(): Promise<void>;
  /** 关闭；失败抛底层错误。 */
  close(): Promise<void>;
  /**
   * 提交写入。resolve 表示已提交给库/OS 缓冲（不代表设备已响应，§34.3.8）。
   * 失败抛底层错误。
   */
  write(data: Uint8Array): Promise<void>;
  /** 等待 OS 缓冲排空。 */
  drain(): Promise<void>;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
}

/** 串口工厂面：枚举与创建（宿主注入点，§34.3.16 共享边界）。 */
export interface SerialPortFactoryLike {
  list(): Promise<SerialPortInfoLike[]>;
  create(options: SerialPortOpenLike): SerialPortLike;
}
