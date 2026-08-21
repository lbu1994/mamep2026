# Modbus RTU 从站（模拟设备）使用说明

独立进程的 Node.js Modbus RTU 从站，默认挂载 **COM5**，行为与仓库 dev Mock 模拟设备
（`packages/platform-web/src/mock-transport.ts` + `mock-scenarios.ts`）**完全一致**。
配合 com0com 虚拟串口对 **COM4 ↔ COM5**，让 Mamep2026 应用（连接 COM4）走真实串口
完成 RTU 调试闭环。

## 环境前提

- 已安装 com0com 并建立 COM4 ↔ COM5 回环对（**只读使用，禁止任何配置操作**，配置需管理员权限）；
- 仓库根已安装 `serialport@13`（原生绑定已构建），本工具不重装/不重建。

## 快速启动

```powershell
# 无 --config：自动读取脚本同目录 modbus-slave.config.json（不存在则用内建默认配置）
node scripts/modbus-slave/modbus-rtu-slave.mjs

# 显式指定配置文件（默认配置即 scripts/modbus-slave/modbus-slave.config.json）
node scripts/modbus-slave/modbus-rtu-slave.mjs --config scripts/modbus-slave/modbus-slave.config.json

# 回环自测：同进程开 COM4（主）+ COM5（从），脚本化断言全部行为清单
node scripts/modbus-slave/modbus-rtu-slave.mjs --self-test
```

启动日志示例（默认 `logLevel: "info"` + `logFrames: true`，收发帧为十六进制，便于与应用通信日志对照）：

```
从站已启动: COM5 @ 9600 8N1，从站地址 1
初始寄存器: 0x0000=0x04D2, 0x0001=0x0000
从站就绪，等待请求。Ctrl+C 退出。
[RX] 01 03 00 00 00 01 84 0A
[TX] 01 03 02 04 D2 3A D9
```

## 配置文件

字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `"COM5"` | 从站挂载的串口 |
| `baudRate` | `9600` | 波特率 |
| `dataBits` | `8` | 数据位（5–8） |
| `stopBits` | `1` | 停止位（1/1.5/2） |
| `parity` | `"none"` | 校验位（none/even/odd/mark/space） |
| `slaveAddress` | `1` | 从站地址（0–255；广播地址 0 默认不支持，仅响应相同地址） |
| `responseDelayMs` | `0` | 模拟设备响应延迟（毫秒） |
| `logLevel` | `"info"` | debug/info/warn/error |
| `logFrames` | `true` | 是否输出收发帧十六进制（`[RX]`/`[TX]`） |
| `registers` | `{}` | 初始寄存器值：`{ "<十进制地址>": <值> }`，默认 0 |
| `rules` | 见下 | 地址区间 → 读写行为；缺省时与 `DEFAULT_MOCK_RULES` 相同 |

`rules` 中 `read`/`write` 行为枚举（与 Mock 的 `MockOpBehavior` 对齐）：

- `"normal"` — 正常：返回成功响应
- `{ "exception": <code> }` — 返回指定 Modbus 异常码（0x01 非法功能 / 0x02 非法数据地址 / 0x03 非法数据值）
- `{ "writeValueGate": <max> }` — 写专用：值 ≤ max 成功，超出回异常 0x03；读按正常处理
- `"no-response"` — 不回任何帧（触发请求超时/重试路径）

默认地址区间规则（与 `DEFAULT_MOCK_RULES` 一一对应）：

| 区间 | 读 | 写 | 用途 |
| --- | --- | --- | --- |
| `0x0000–0x000f` | 成功 | 成功 | 正常区 |
| `0x0100–0x010f` | 成功 | 异常 0x02 | 只读区 |
| `0x0200–0x020f` | 异常 0x02 | 成功 | 只写区 |
| `0x0300–0x030f` | 异常 0x02 | 异常 0x02 | 寄存器不存在 |
| `0x0400–0x040f` | 成功 | 值须 ≤ 0x7FFF，超限异常 0x03 | 非法数据值 |
| `0x0500–0x050f` | 异常 0x01 | 异常 0x01 | 不支持功能 |
| `0x0600–0x060f` | 无响应 | 无响应 | 设备无响应（超时/重试） |

规则按数组顺序匹配，第一条命中生效；规则外地址回退为正常行为。

## 协议行为（响应帧均追加 CRC16-Modbus）

- **FC03 读**：`[slave, 0x03, 0x02, valueHi, valueLo] + CRC`（共 7 字节，与 Mock 一致），返回当前寄存器值；
- **FC0x10 写**：写入后回执 `[slave, 0x10, addrHi, addrLo, 0x00, 0x01] + CRC`（共 8 字节）；
- **异常响应**：`[slave, fc|0x80, exceptionCode] + CRC`（共 5 字节）；
- **不支持的功能码**：回异常 `0x01`（非法功能）；
- **健壮性**：CRC 校验失败静默丢弃、从站地址不匹配忽略、帧长度 < 8 字节忽略、
  串口数据分片按 RTU 3.5 字符静默间隔缓冲组帧（不假设一次收齐）。

## 与 Mamep2026 应用联调

1. 启动从站（挂 COM5）：
   ```powershell
   node scripts/modbus-slave/modbus-rtu-slave.mjs
   ```
2. 启动网页端 dev server：`pnpm dev`（http://localhost:5173）。
3. 在应用连接 COM4：
   - **浏览器 Web Serial**：连接设置弹窗中选 **COM4**（系统选口，注意确认实际选中 COM4）；
   - **Electron**：自动选第一个可用端口（`select-serial-port` 最小授权），确认实际选中的是 COM4；
   - 连接参数须与从站一致（9600/8N1，从站地址 1）。
4. 完成读、写、轮询（WP）、Trace、通信日志闭环；`0x0600–0x060f` 无响应区间可验证
   请求超时/重试路径（与 dev Mock 的 NoResponse 场景一致）。

> 注意：浏览器 Web Serial 选口为系统授权流程，无法由 Playwright 自动化，需人工确认选中的是 COM4。

## 自测（--self-test）

同进程打开主站（默认 COM4，可用 `--master-port` 覆盖）+ 从站（配置端口），脚本化断言：

1. FC03 读正常区返回当前值；
2. FC10 写回执 + 重读值已更新；
3. 只读区写回异常 0x02；
4. 只写区读回异常 0x02；
5. 不存在区读/写均异常 0x02；
6. 非法值区：写 0x8000（超 0x7FFF）异常 0x03、合法值成功；
7. 不支持功能区读/写均异常 0x01；
8. 未知功能码（0x06）回异常 0x01；
9. 短帧（< 8 字节）忽略无响应；
10. 坏 CRC 帧静默丢弃无响应；
11. 从站地址不匹配忽略无响应；
12. no-response 区读/写均无响应（超时路径）。

全部 PASS 退出码 0，任一失败退出码 1。

## 常见问题

- **`无法打开串口 COM5`**：端口被占用（应用已连接 COM5？）或不存在；确认从站端口空闲、com0com 对已建立。
- **应用连不上 / 读超时**：确认应用与从站串口参数一致（9600/8N1、从站地址 1），且应用实际选中 COM4。
- **日志看不到收发帧**：`logFrames` 置 `true`，或 `logLevel` 降到 `debug`。

## 红线

- **com0com 只读**：本工具与联调流程只读写 COM4/COM5，**禁止任何配置操作**（`setupc`
  install/change/remove、改端口参数等），配置需管理员权限，不得提权。
- **不扩展产品范围**：本工具为独立测试脚本，不修改 `apps/`、`packages/` 下任何代码。
