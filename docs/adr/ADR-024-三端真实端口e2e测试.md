# ADR-024：三端真实端口 e2e 测试（com0com + 真实从站 + UI 级断言）

- 状态：已确认
- 日期：2026-08-24
- 决策来源：用户指令（为三端追加「真实端口」e2e：RTU 走 com0com 真实串口、TCP 走本地
  回环真实端口，双协议覆盖连接与寄存器读写成功/失败场景；浏览器端弹出选择并记录复用，
  Electron/VSCode 自动选 COM4；VSCode 端做到与其他端一致的 UI 级断言）

## 背景

- 三端真实连接路径已就绪（ADR-016/017/021/022/023）：浏览器 `WebSerialTransport`、
  Electron RTU=Renderer Web Serial + TCP=主进程、VSCode=`NodePlatformHost`（serialport/net）
  + `RtuSessionHost`/`TcpSessionHost`；MOCK/FAKE 为显式 dev 手段，默认路径已走真实设备。
- 既有 e2e 全部基于 MOCK/FAKE（`?mockTransport=1`、`MAMEP_FAKE_SERIAL/TCP=1`），缺少
  **真实端口**（com0com 虚拟串口对 + 真实从站进程 + 本地回环 TCP）的自动化闭环；
  且 VSCode 端 e2e 仅 RPC 级断言（`debug:rpc`），未覆盖 UI 行为（状态点/错误提示/通信日志）。
- 需要：三端真实端口 e2e（默认测试路径），门控（缺环境 skip 不失败），保留 MOCK 为显式
  可选手段，测试参数来自 `config/connections.json`（不硬编码），VSCode 与其他端一致的 UI 级断言。

## 已确认决策（用户 2026-08-24）

1. **浏览器串口选择**：系统 Web Serial picker（真实授权路径）+ localStorage 记录
   （key `mamep:real-serial-port`，存 {portId,label,selectedAt}）+ 运行内复用
   （`test.describe.serial` 共享 page/连接，一次运行只弹一次选择框）；跨运行打印上次选择
   对照。**零生产代码改动**。每次运行仍需在系统 picker 手动选一次（Web Serial 授权无法
   由 Playwright 自动化），运行内共享连接不重复弹。
2. **运行编排**：独立命令（`test:e2e:web:real` / `:electron:real` / `:vscode:real`）+
   统一入口（`test:e2e:real`）。主站连接参数沿用 `config/connections.json`
   （rtu-com4-master / tcp-local-slave）；从站端口维持从站自身配置（ADR-023 决策 7）。
3. **TCP 从站**：独立进程 `scripts/modbus-slave/modbus-tcp-slave.mjs` + 规则共享模块
   （`scripts/modbus-slave/lib/modbus-core.mjs`，RTU/TCP 从站单一事实源）。
4. **失败场景**：从站 7 区域 + 边界（地址 0 / 0xFFFF）+ 扩展场景（分片响应、延迟/迟到
   响应），RTU 与 TCP 从站规则保持一致。
5. **VSCode UI 级断言**：改用 `vscode-test-playwright`（ruifigueira，`0.0.1-beta2`，pin
   精确版本）驱动真实 VS Code 的 Webview（生产 webview），与其他端一致的 UI 级断言。

## 决策

1. **共享从站核心（`scripts/modbus-slave/lib/modbus-core.mjs`）**：从 `modbus-rtu-slave.mjs`
   提取协议/规则/日志/CRC，供 RTU 与 TCP 从站复用，避免规则漂移；`DEFAULT_RULES` 7 区与
   `DEFAULT_MOCK_RULES` 一一对应。**扩展行为**（真实从站配置用，不在 `DEFAULT_MOCK_RULES` 内）：
   - `{ "delayedResponse": ms }` — 按区间延迟响应（如 1500ms > 应用超时 1000ms → 主站
     超时/重试后迟到帧被丢弃，验证 `LATE_RESPONSE_DISCARDED` 路径）；
   - `{ "splitResponse": { chunkSize, chunkDelayMs } }` — 响应拆段发送（半包/粘包组帧健壮性）。
   RTU 从站重构复用该模块（`--self-test` 保证行为不变）；TCP 从站默认 host/port/unitId 读
   `config/connections.json` 的 `tcp-local-slave`（唯一事实源），`--config`/`--host`/`--port` 可覆盖。
2. **统一编排与门控（`scripts/e2e-real.mjs <web|electron|vscode|all>`）**：
   - 预检（缺环境 → 打印清晰 SKIP 提示、退出码 0 不失败）：RTU 用 serialport `list()` 检查
     主站口（rtu-com4-master.port）与从站口（modbus-slave.config.json.port）均存在；TCP
     探测 tcp-local-slave 端口可监听（被占用时做一次轻量 FC03 探测，能应答视为已有从站复用）。
   - 就绪后：设 `MAMEP_REAL=1` → 拉起所需从站（RTU: COM5 / TCP: 127.0.0.1:1502）等待就绪 →
     跑对应端命令 → 回收从站 → 透传退出码。
   - 各 spec 另有 `test.skip(MAMEP_REAL !== "1")` 防御，未设门控时默认套件不受影响。
3. **三端测试落地**：
   - **浏览器（`tests/e2e-web/tests-real/real-serial.spec.ts` + `playwright.real.config.ts`）**：
     系统 Edge 有头（headless 无法弹 picker）；dev server 由 config 的 webServer 拉起；用户
     在系统 picker 选 COM4 → localStorage 记录 → 共享连接跑全矩阵。
   - **Electron（`tests/e2e-electron/tests-real/real-serial.spec.ts` / `real-tcp.spec.ts` +
     `playwright.real.config.ts`）**：生产构建路径；RTU 走「串口下拉枚举（用户手势）→ 自动选
     config 指定串口 COM4」；TCP 走「切 Modbus TCP → 按 config tcp-local-slave 填表」。全自动。
   - **VSCode（`tests/e2e-vscode/real/real-rtu.spec.ts` / `real-tcp.spec.ts` +
     `playwright.real.config.ts`，vscode-test-playwright）**：`extensionDevelopmentPath` 加载扩展，
     生产 webview（未设 `MAMEP_DEV_URL` → `getProdHtml`）；`workbox.frames()` 定位
     `vscode-webview://` frame 后驱动共享 UI；RTU 串口下拉 `serial-enumerate`（RPC，无手势要求）
     选 COM4；TCP 按 config 填表；**UI 级断言**（状态点/aria-label/Tooltip/通信日志/无 console 错误）。
     fixture 每测试新建 VS Code 实例，故每协议单测试 + `test.step()` 覆盖全矩阵控制启动次数。
4. **能力矩阵/安全边界**：不变（modbusRtu/serialPorts/modbusTcp/connectionConfig 已如实）；
   无新增 HostMessage kind、无安全边界改动（contextIsolation/sandbox 保持）；浏览器不追加 TCP。
5. **MOCK/FAKE 保留边界**：`?mockTransport=1`、`MAMEP_FAKE_SERIAL=1`/`MAMEP_FAKE_TCP=1`
   保持为显式可选 dev 手段，不删除；real 用例由 `MAMEP_REAL=1` 门控（runner 设置），与 MOCK 正交，
   默认套件（`test:e2e:web/electron/vscode`）不含 real spec。
6. **测试参数不硬编码**：主站连接参数从 `config/connections.json` 读取（runner 与各 spec 内
   Node fs 读取）；从站端口从从站自身配置读取（ADR-023 决策 7）。
7. **文档同步**：本 ADR + TECH_DESIGN（真实端口 e2e 章节）+ 根 AGENTS.md 进度段 +
   docs/AGENTS.md 实现状态 + `scripts/modbus-slave/README.md`（TCP 从站/共享规则/扩展行为）。

## 备选方案

- **浏览器应用内自定义选择页**：不走系统 Web Serial picker，不符合真实授权语义，未选。
- **浏览器 dev-only 自动恢复钩子（getPorts 匹配记录）**：可免去每次运行手动选择，但需少量
  生产（dev 门控）代码，与「零生产代码改动」冲突；记为后续可选项。
- **TCP 从站测试进程内回环**：等同既有 fake TCP server，不算真实外部从站，未选（用独立进程）。
- **VSCode 继续 RPC 级断言**：不满足「与其他端一致的 UI 级断言」，未选（用户明确要求 UI 级）。

## 影响与验证

- 新增：`scripts/modbus-slave/lib/modbus-core.mjs`、`modbus-tcp-slave.mjs`、
  `modbus-tcp-slave.config.json`、`scripts/e2e-real.mjs`、三端 `playwright.real.config.ts` +
  real spec、`tests/e2e-vscode/tsconfig.real.json`、`docs/adr/ADR-024*`。
- 修改：`modbus-rtu-slave.mjs`（复用 lib）、`modbus-slave.config.json`（扩展区间）、从站 README、
  根与三端 `package.json`（`test:e2e:*:real` / `test:real` + vscode-test-playwright 依赖）、
  TECH_DESIGN、根 AGENTS.md、docs/AGENTS.md、config/README。
- 验证：RTU/TCP 从站 `--self-test` 全绿；`pnpm typecheck`/`pnpm lint` 全绿；既有 MOCK 套件回归；
  门控（缺环境 SKIP 不失败）；真实验收（`pnpm test:e2e:web:real` 人工选 COM4 一次 →
  `:electron:real` → `:vscode:real` → `test:e2e:real`）。
- 风险：vscode-test-playwright 为社区 beta（0.0.1-beta2），已 pin 版本并兼容 @playwright/test
  1.62（peer `>=1.41 <2`）；若内部 API 兼容问题，备选为 `@vscode/test-electron` + Playwright
  `_electron.launch` 直接驱动（`evaluateInVSCode` 等价能力用 `debug:rpc` 探针替代）。
