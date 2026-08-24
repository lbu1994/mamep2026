# Modbus 从站（模拟设备）使用说明

独立进程的 Node.js Modbus 从站，分 RTU 与 TCP 两种传输（同一套协议/规则核心，
见下方「共享核心」）：

- **Modbus RTU 从站**（`modbus-rtu-slave.mjs`）：默认挂载 **COM5**，配合 com0com
  虚拟串口对 **COM4 ↔ COM5**，让 Mamep2026 应用（连接 COM4）走真实串口完成 RTU 调试闭环。
- **Modbus TCP 从站**（`modbus-tcp-slave.mjs`）：默认监听 **127.0.0.1:1502**（host/port/
  unitId 取自 `config/connections.json` 的 `tcp-local-slave`），让桌面端走真实 TCP 闭环。

两者行为与仓库 dev Mock 模拟设备（`packages/platform-web/src/mock-transport.ts` +
`mock-scenarios.ts`）**完全一致**（7 个默认地址区间），并额外支持扩展行为（分片/延迟，
见下），供真实端口 e2e 验证半包/粘包与迟到响应路径。

## 共享核心

协议/规则/日志/CRC 复用 `lib/modbus-core.mjs`（RTU / TCP 从站单一事实源，避免规则漂移）；
行为归一化、规则顺序匹配、响应投递（含扩展行为）均在其中。算法与常量以
`packages/protocol-modbus/src/crc16.ts`、`rtu-frame.ts` 为权威，修改须同步。

## 环境前提

- 已安装 com0com 并建立 COM4 ↔ COM5 回环对（**只读使用，禁止任何配置操作**，配置需管理员权限）；
- 仓库根已安装 `serialport@13`（原生绑定已构建），本工具不重装/不重建。

## 快速启动

```powershell
# RTU 从站（默认 COM5，读取脚本同目录 modbus-slave.config.json）
node scripts/modbus-slave/modbus-rtu-slave.mjs

# RTU 从站回环自测：同进程开 COM4（主）+ COM5（从），脚本化断言全部行为清单
node scripts/modbus-slave/modbus-rtu-slave.mjs --self-test

# TCP 从站（默认 127.0.0.1:1502，host/port/unitId 取自 config/connections.json 的 tcp-local-slave）
node scripts/modbus-slave/modbus-tcp-slave.mjs

# TCP 从站回环自测：同进程开主站（临时端口）+ 从站，脚本化断言全部行为清单
node scripts/modbus-slave/modbus-tcp-slave.mjs --self-test

# TCP 从站自定义端口
node scripts/modbus-slave/modbus-tcp-slave.mjs --port 1503
```

启动日志示例（RTU，默认 `logLevel: "info"` + `logFrames: true`，收发帧为十六进制）：

```
从站已启动: COM5 @ 9600 8N1，从站地址 1
初始寄存器: 0x0000=0x04D2, 0x0001=0x0000
从站就绪，等待请求。Ctrl+C 退出。
[RX] 01 03 00 00 00 01 84 0A
[TX] 01 03 02 04 D2 3A D9
```

TCP 从站启动日志：

```
从站已启动: 127.0.0.1:1502，unitId 1。Ctrl+C 退出。
```

## 配置文件

RTU 从站（`modbus-slave.config.json`）字段：

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

TCP 从站（`modbus-tcp-slave.config.json`）字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `host` / `port` / `unitId` | `config/connections.json` 的 `tcp-local-slave` | 监听地址/端口/应答 unitId（命令行 `--host`/`--port` 可覆盖） |
| `responseDelayMs` | `0` | 模拟设备响应延迟（毫秒） |
| `logLevel` / `logFrames` | `"info"` / `true` | 日志 |
| `registers` / `rules` | 同 RTU | 初始寄存器 / 地址区间规则 |

`rules` 中 `read`/`write` 行为枚举（与 Mock 的 `MockOpBehavior` 对齐 + 扩展）：

- `"normal"` — 正常：返回成功响应
- `{ "exception": <code> }` — 返回指定 Modbus 异常码（0x01 非法功能 / 0x02 非法数据地址 / 0x03 非法数据值）
- `{ "writeValueGate": <max> }` — 写专用：值 ≤ max 成功，超出回异常 0x03；读按正常处理
- `"no-response"` — 不回任何帧（触发请求超时/重试路径）
- `{ "delayedResponse": <ms> }` — **扩展**：该区间响应延迟 ms 后再发（如 1500ms > 应用
  超时 1000ms → 主站超时/重试后迟到帧被丢弃，验证迟到响应路径）
- `{ "splitResponse": { "chunkSize": n, "chunkDelayMs": m } }` — **扩展**：响应帧按
  chunkSize 字节拆段、间隔 m ms 发送（模拟半包/粘包，验证主站组帧健壮性）

默认地址区间规则（与 `DEFAULT_MOCK_RULES` 一一对应）+ 扩展区间（配置文件自带）：

| 区间 | 读 | 写 | 用途 |
| --- | --- | --- | --- |
| `0x0000–0x000f` | 成功 | 成功 | 正常区 |
| `0x0100–0x010f` | 成功 | 异常 0x02 | 只读区 |
| `0x0200–0x020f` | 异常 0x02 | 成功 | 只写区 |
| `0x0300–0x030f` | 异常 0x02 | 异常 0x02 | 寄存器不存在 |
| `0x0400–0x040f` | 成功 | 值须 ≤ 0x7FFF，超限异常 0x03 | 非法数据值 |
| `0x0500–0x050f` | 异常 0x01 | 异常 0x01 | 不支持功能 |
| `0x0600–0x060f` | 无响应 | 无响应 | 设备无响应（超时/重试） |
| `0x0700–0x070f` | 延迟 1500ms | 延迟 1500ms | 扩展：延迟/迟到响应 |
| `0x0800–0x080f` | 拆段 2B/5ms | 拆段 2B/5ms | 扩展：半包/粘包 |

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
   - **Electron / VSCode**：串口下拉枚举后自动选择 COM4（Electron 经主进程 select-serial-port
     最小授权；VSCode 经 Extension Host serialport 枚举），确认实际选中的是 COM4；
   - 连接参数须与从站一致（9600/8N1，从站地址 1）。
4. 完成读、写、轮询（WP）、Trace、通信日志闭环；`0x0600–0x060f` 无响应区间可验证
   请求超时/重试路径（与 dev Mock 的 NoResponse 场景一致）；`0x0700–0x070f` 延迟区间、
   `0x0800–0x080f` 分片区间验证迟到响应与半包/粘包组帧。

### 真实端口 e2e（自动化）

三端真实端口 e2e 由 `scripts/e2e-real.mjs` 统一编排：预检（COM4/COM5 存在、TCP 端口可
监听）→ 自动拉起从站（RTU: COM5 / TCP: 127.0.0.1:1502）→ 跑对应端测试 → 回收从站；
缺环境时 SKIP 提示不失败。命令见根 package.json（`pnpm test:e2e:real` 及三端
`test:e2e:*:real`）。浏览器端启动时需在系统串口选择器手动选中 COM4 一次（Web Serial
授权无法自动化），选择结果记录于 localStorage，运行内复用。

> 注意：浏览器 Web Serial 选口为系统授权流程，无法由 Playwright 自动化，需人工确认选中的是 COM4。

## 自测（--self-test）

**RTU**（`modbus-rtu-slave.mjs --self-test`，同进程开主站默认 COM4，可用 `--master-port` 覆盖）：

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

**TCP**（`modbus-tcp-slave.mjs --self-test`，同进程开主站临时端口 + 从站）：与上述 1–8、
12 对应（MBAP 分帧/unitId 匹配），另加：unitId 不匹配忽略无响应、分片区拆段后仍正确组帧、
延迟区短超时内无响应、规则外地址（0xFFFF）回退正常。

全部 PASS 退出码 0，任一失败退出码 1。

## 常见问题

- **`无法打开串口 COM5`**：端口被占用（应用已连接 COM5？）或不存在；确认从站端口空闲、com0com 对已建立。
- **应用连不上 / 读超时**：确认应用与从站串口参数一致（9600/8N1、从站地址 1），且应用实际选中 COM4。
- **日志看不到收发帧**：`logFrames` 置 `true`，或 `logLevel` 降到 `debug`。

## 红线

- **com0com 只读**：本工具与联调流程只读写 COM4/COM5，**禁止任何配置操作**（`setupc`
  install/change/remove、改端口参数等），配置需管理员权限，不得提权。
- **不扩展产品范围**：本工具为独立测试脚本，不修改 `apps/`、`packages/` 下任何代码。
