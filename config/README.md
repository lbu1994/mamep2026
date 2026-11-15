# 连接对象配置文件（测试/验证基建）

`config/connections.json` 定义 **Mamep2026 测试/验证脚本连接真实设备**（真实 COM 口 / 真实 Modbus TCP 端口）所需的连接对象，供真实端口 e2e 与探针脚本消费，避免在代码中散落连接参数。

> **应用侧说明**：本文件**仅供测试/验证脚本消费**；应用内连接对象通过 **Settings → 工作区导入**进入工作区（工作区 JSON 含 `connectionProfiles`，导入后 Connection Settings 以 `connectionProfiles[0]` 预填表单）。

## 格式

```jsonc
{
  // 格式版本（当前 1）。
  "schemaVersion": 1,
  // 默认连接对象 id（测试脚本可忽略；可为 null）。
  "activeConnectionId": "rtu-com4-master",
  "connections": [
    {
      // RTU 连接对象
      "id": "rtu-com4-master", // 唯一标识（必填）
      "name": "COM4（com0com 主站）", // 展示名（必填）
      "protocol": "rtu",
      "port": "COM4", // 串口名（必填；COM10+ 亦按不透明字符串处理）
      "baudRate": 9600, // 波特率，默认 9600
      "dataBits": 8, // 数据位 7|8，默认 8
      "stopBits": 1, // 停止位 1|2，默认 1
      "parity": "none", // none|even|odd，默认 none
      "flowControl": "off", // off|rts-cts|xon-xoff，默认 off
      "slaveAddress": 1, // 该连接对象的默认从站地址 0~255，默认 1
      "requestTimeoutMs": 50, // 单次请求响应超时，默认 50
      "retryCount": 1, // 重试次数 0~10，默认 1
    },
    {
      // TCP 连接对象
      "id": "tcp-local-slave",
      "name": "本地 TCP 从站",
      "protocol": "tcp",
      "host": "127.0.0.1", // 主机/IP（原样传递，不解析）
      "port": 1502, // TCP 端口 1~65535
      "unitId": 1, // MBAP 单元标识 0~255，默认 0
      "connectTimeoutMs": 5000, // 连接超时，默认 5000
      "requestTimeoutMs": 50, // 单次请求响应超时，默认 50
      "retryCount": 1, // 重试次数 0~10，默认 1
      "autoReconnect": false, // 自动重连配置，默认 false；当前 UI 不开放修改
    },
  ],
}
```

- 省略的字段按默认值回填（见上表）；字段语义与 `packages/domain` 的 `RtuConnectionProfile`/`TcpConnectionProfile` 对齐（脚本侧 raw JSON 解析，不引入 Zod）。
- `slaveAddress` 是该连接对象的默认从站地址；`port` 是配置文件特有字段；`connectionProfiles` 持久化不包含串口名。

## 消费方（仅测试/验证脚本）

1. **`scripts/e2e-real.mjs`**：经 `scripts/lib/connection-config.mjs` 的 `findConnection()` 读取
   `rtu-com4-master` / `tcp-local-slave` 主站连接参数与 TCP 端口（预检与门控）。
2. **`scripts/prototype/electron-serial-probe.mjs`**：主站连接参数（COM4/9600/8N1）。
3. **三端真实端口 e2e**：各端 `tests/e2e-*/tests-real|real` spec 直接 `readFileSync`
   读取本文件（`rtu-com4-master` / `tcp-local-slave`，测试参数不硬编码）；`modbus-tcp-slave.mjs`
   默认 host/port/unitId 也取自本文件的 `tcp-local-slave`；从站端口 COM5 属于从站自身配置。

## MOCK/FAKE 边界（明确）

- 本配置文件描述的是**真实连接参数**（真实 COM 口 / 真实 TCP 端口），与 MOCK/FAKE 正交。
- MOCK/FAKE 保持为显式、可选的 dev-only 手段，**默认路径即真实设备**：
  - 浏览器 `?mockTransport=1`（`import.meta.env.DEV` 门控，生产构建不含）；
  - VSCode `MAMEP_FAKE_SERIAL=1` / `MAMEP_FAKE_TCP=1`（`extensionMode !== Production` 门控）。
- 不带上述开关 = 走真实设备（本配置文件定义连接参数）。

## 示例场景（com0com + modbus-slave + 本地 TCP 从站）

1. com0com 配置 COM4↔COM5 虚拟串口对（只读写、禁止配置/提权）。
2. 启动从站：`node scripts/modbus-slave/modbus-rtu-slave.mjs`（默认挂 COM5，9600/8N1/从站地址 1，行为与 MockTransport 一致）。
3. TCP：`node scripts/modbus-slave/modbus-tcp-slave.mjs`（默认 127.0.0.1:1502，host/port/unitId 取自本文件 `tcp-local-slave`）。
4. 自动化：`pnpm test:e2e:real`（及三端 `test:e2e:*:real`）经 `scripts/e2e-real.mjs` 预检并自动拉起上述从站后跑三端真实端口 e2e。
