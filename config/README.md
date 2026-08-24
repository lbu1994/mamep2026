# 连接对象配置文件（ADR-023）

`config/connections.json` 定义 **Mamep2026 应用连接真实设备**（真实 COM 口 / 真实 Modbus TCP 端口）所需的连接对象，供应用 UI「从配置载入」与测试/验证脚本消费，消除代码中散落的硬编码（COM4/COM5/127.0.0.1:1502 等）。

## 格式

```jsonc
{
  // 格式版本（当前 1）。
  "schemaVersion": 1,
  // 默认选中连接对象 id（「从配置载入」下拉的默认选中项；可为 null）。
  "activeConnectionId": "rtu-com4-master",
  "connections": [
    {
      // RTU 连接对象
      "id": "rtu-com4-master",        // 唯一标识（必填）
      "name": "COM4（com0com 主站）",   // 展示名（必填）
      "protocol": "rtu",
      "port": "COM4",                  // 串口名（必填；COM10+ 亦按不透明字符串处理）
      "baudRate": 9600,                // 波特率，默认 9600
      "dataBits": 8,                   // 数据位 7|8，默认 8
      "stopBits": 1,                   // 停止位 1|2，默认 1
      "parity": "none",                // none|even|odd，默认 none
      "flowControl": "off",            // off|rts-cts|xon-xoff，默认 off
      "slaveAddress": 1,               // 该连接对象的默认从站地址 0~255，默认 1
      "requestTimeoutMs": 1000,        // 单次请求响应超时，默认 1000
      "retryCount": 1,                 // 重试次数 0~10，默认 1
      "interRequestDelayMs": 50,       // Rx Delay（请求间隔，兼作 WP 轮询间隔），默认 50
      "addressAdjust": "off"           // off|on，默认 off
    },
    {
      // TCP 连接对象
      "id": "tcp-local-slave",
      "name": "本地 TCP 从站",
      "protocol": "tcp",
      "host": "127.0.0.1",             // 主机/IP（原样传递，不解析）
      "port": 1502,                    // TCP 端口 1~65535
      "unitId": 1,                     // MBAP 单元标识 0~255，默认 0
      "connectTimeoutMs": 5000,        // 连接超时，默认 5000
      "requestTimeoutMs": 1000,        // 单次请求响应超时，默认 1000
      "retryCount": 1,                 // 重试次数 0~10，默认 1
      "autoReconnect": false,          // 自动重连（P1，UI 灰显），默认 false
      "interRequestDelayMs": 50        // 请求间隔，默认 50
    }
  ]
}
```

- 省略的字段按默认值回填（见上表）；校验由 `packages/connection-config` 的 Zod schema 完成（判别联合 `protocol`）。
- `slaveAddress` 是**该连接对象的默认从站地址**：UI 载入时同步到当前表从站地址（不改变「从站地址按表独立」模型）；`port` 是配置文件特有字段（区别于 `connectionProfiles` 持久化——持久化不含串口名，ADR-017 边界不变）。

## 存放位置与加载方式（三端）

| 端 | 能力矩阵 | 加载方式 |
| --- | --- | --- |
| Electron | `connectionConfig: "file"` | 主进程读文件：环境变量 `MAMEP_CONNECTION_CONFIG` 指定路径 > exe 目录（打包）/ 仓库根（dev）`config/connections.json` > 用户数据目录 `config/connections.json` |
| VSCode | `connectionConfig: "file"` | Extension Host 读文件：设置项 `mamep2026.connectionConfigPath` > 工作区根 `config/connections.json` > 用户主目录 `config/connections.json` |
| 浏览器 | `connectionConfig: "import"` | 无文件系统：UI「导入 JSON…」或 URL 参数 `?connectionConfig=<base64>`（base64 编码的完整配置文件 JSON） |

加载结果经 HostMessage v1 `connection-config-load` kind（Zod 校验 + 白名单）从桌面端宿主传给 Renderer。

## 生效时机

**重连 / 重启时重新读取**（打开连接设置弹窗时加载），无热更新：修改 `config/connections.json` 后，重新打开 Connection Settings 或重启应用即生效。

## 消费方

1. **应用 UI**：Connection Settings 弹窗「Load from Config File」——选择连接对象 → 预填表单（RTU 自动匹配串口名、同步从站地址；TCP 直接预填 host/port/unitId）→ 关闭时照常合并进 `connectionProfiles[0]` 持久化。
2. **测试 / 验证脚本**：`scripts/` 下真实设备路径（如 `electron-serial-probe`）从本文件读取主站连接参数，不再硬编码。
3. **三端真实端口 e2e（ADR-024）**：`scripts/e2e-real.mjs` 与各端 `tests/e2e-*/tests-real|real` spec 从本文件读取主站连接参数（`rtu-com4-master` / `tcp-local-slave`）与门控端口；`modbus-tcp-slave.mjs` 默认 host/port/unitId 也取自本文件的 `tcp-local-slave`（从站端口 COM5 属从站自身配置，ADR-023 决策 7）。

## MOCK/FAKE 边界（明确）

- 本配置文件描述的是**真实连接参数**（真实 COM 口 / 真实 TCP 端口），与 MOCK/FAKE 正交。
- MOCK/FAKE 保持为显式、可选的 dev-only 手段，**默认路径即真实设备**：
  - 浏览器 `?mockTransport=1`（`import.meta.env.DEV` 门控，生产构建不含）；
  - VSCode `MAMEP_FAKE_SERIAL=1` / `MAMEP_FAKE_TCP=1`（`extensionMode !== Production` 门控）。
- 不带上述开关 = 走真实设备（本配置文件定义连接参数）。

## 示例场景（com0com + modbus-slave + 本地 TCP 从站）

1. com0com 配置 COM4↔COM5 虚拟串口对（只读写、禁止配置/提权）。
2. 启动从站：`node scripts/modbus-slave/modbus-rtu-slave.mjs`（默认挂 COM5，9600/8N1/从站地址 1，行为与 MockTransport 一致）。
3. 应用连接 `rtu-com4-master`（COM4）即完成真实串口协议栈的 FC03 读 / FC10 写闭环。
4. TCP：`node scripts/modbus-slave/modbus-tcp-slave.mjs`（默认 127.0.0.1:1502，host/port/unitId 取自本文件 `tcp-local-slave`），应用连接 `tcp-local-slave`。
5. 自动化：`pnpm test:e2e:real`（及三端 `test:e2e:*:real`）经 `scripts/e2e-real.mjs` 预检并自动拉起上述从站后跑三端真实端口 e2e（ADR-024）。
