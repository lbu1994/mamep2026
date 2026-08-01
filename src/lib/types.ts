/** 串口配置参数 */
export interface SerialConfig {
  port: string;
  speed: number;
  dataLength: 7 | 8;
  stopBit: 1 | 2;
  parity: 'None' | 'Even' | 'Odd';
  slaveAddress: number;
  rxDelay: number;
}

/** 寄存器表格中一行数据 */
export interface RegisterRow {
  id: number;                // 行号 1-15
  tm: boolean;               // 是否参与 Upload
  name: string;              // 自定义标签
  registerHex: string;       // 十六进制地址
  wp: boolean;               // 写保护 (Demo disabled)
  data: string;              // Data 列显示值 / 写入值
  type: 'HEX' | 'Unsigned Dec.' | 'Signed Dec.';
  comment: string;           // 注释列
  error: boolean;            // 读取失败标记
}

/** 串口连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** 默认串口配置 */
export const DEFAULT_SERIAL_CONFIG: SerialConfig = {
  port: '',
  speed: 9600,
  dataLength: 8,
  stopBit: 1,
  parity: 'None',
  slaveAddress: 1,
  rxDelay: 5,
};

/** 创建默认的寄存器行 */
export function createDefaultRow(id: number): RegisterRow {
  return {
    id,
    tm: false,
    name: '',
    registerHex: '',
    wp: false,
    data: '',
    type: 'HEX',
    comment: '',
    error: false,
  };
}

/** 创建默认的 15 行 */
export function createDefaultRows(): RegisterRow[] {
  return Array.from({ length: 15 }, (_, i) => createDefaultRow(i + 1));
}
