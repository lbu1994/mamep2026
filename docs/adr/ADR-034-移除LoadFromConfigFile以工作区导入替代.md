# ADR-034：移除 Load from Config File，以工作区导入替代

- 状态：已确认
- 日期：2026-08-29
- 决策来源：用户指令（移除连接设置中的 json 导入功能，使用设置中的工作区导入替代）

## 背景

- ADR-023（2026-08-24）落地「Load from Config File」：Connection Settings 分组从
  `config/connections.json` 选择连接对象 → 预填表单（RTU 自动匹配串口名 + 同步从站地址；TCP 直连
  预填 host/port/unitId）。桌面端（Electron/VSCode）读文件系统（`connection-config-load` kind +
  三端 `config-loader.ts`），浏览器经 `?connectionConfig=<base64>` URL 载入。
- ADR-033（2026-08-29）落地工作区导入/导出：Settings 弹窗导入版本化工作区 JSON（含
  `connectionProfiles`、v1→v4 迁移与断链检测，不裁剪字段），导入后 Connection Settings 以
  `connectionProfiles[0]` 预填连接表单。
- 两个能力职责重叠（都是「把外部连接对象带进连接设置」），用户要求移除连接设置中的 json 导入
  功能，由工作区导入统一承担。

## 已确认决策（用户 2026-08-29）

1. **删除应用侧「Load from Config File」全链路**（UI 分组、`connection-config-load` kind、
   三端 `config-loader.ts`、`packages/connection-config` 包、能力矩阵 `connectionConfig` 字段、
   浏览器 `?connectionConfig=<base64>` URL 载入、VSCode 设置项 `mamep2026.connectionConfigPath`、
   相关 i18n 键与测试）。
2. **替代**：连接对象导入由 Settings → 工作区导入承担（工作区 JSON 已含 `connectionProfiles`，
   导入后连接设置以 `connectionProfiles[0]` 预填表单，等效旧功能）。
3. **保留测试基建**：`config/connections.json`（JSON，schemaVersion 1）+ `scripts/lib/connection-config.mjs`
   供测试/验证脚本消费（`scripts/e2e-real.mjs` 预检、`electron-serial-probe`、real e2e spec 直读，
   ADR-024）——测试参数不硬编码，删除会破坏 real e2e。
4. **执行顺序=文档先行**：先删改文档要求（本 ADR + AGENTS.md/TECH_DESIGN/config README）再动代码，
   避免实施者回查文档忘记目标。

## 决策细节

1. **删除清单**：
   - UI：`packages/ui` `ConnectionSettingsModal`「Load from Config File」分组（连接对象 Select →
     预填表单 + RTU 端口匹配 + 从站地址同步）；`connection-settings-model.ts` `loadConnectionToSettings`；
     `AppHost.loadConnectionConfig()` 接口；i18n `configGroup/configLoadPlaceholder/configEmpty/
     configSource/configInvalidJson/configInvalid`（en/zh）。
   - 契约：`packages/platform-api` `connection-config-load` kind + `ConnectionConfigLoadResponse` +
     `loadConnectionConfig()`（`MamepHostApi`/`VscodeHostApi`/`vscode-bridge`）。
   - 共享包：`packages/connection-config`（`ConnectionConfigFile` schema/解析/映射）。
   - 桌面端：`apps/electron/src/main/config-loader.ts`、`apps/vscode-extension/src/config-loader.ts`
     + 各自 ipc 分支、preload/extension 装配；VSCode 设置项 `mamep2026.connectionConfigPath`。
   - 浏览器：`apps/web/src/connection-config-url.ts`（`?connectionConfig=` URL 载入）+ AppHost 字段/方法。
   - 能力矩阵：`PlatformCapabilities.connectionConfig`（`"file" | "import" | "unsupported"`）整体删除，
     同步 `packages/domain`、`packages/platform-node`（node-platform-host / node-tcp-platform-host）、
     `browserCapabilities`、文档与断言。
2. **保留**：`config/connections.json`、`scripts/lib/connection-config.mjs`（仅测试/探针消费）；
   `workspace` 的 `connectionProfiles` 与连接对象 schema 不变；Connection Settings 表单与连接逻辑不变。
3. **文档同步**：根 AGENTS.md、docs/AGENTS.md、TECH_DESIGN（能力矩阵 + §18.4.1）、config/README.md、
   vscode-extension README、README、ADR-023 标记废弃。

## 备选方案

- **保留两个入口**：职责重叠、维护双链路成本高，未选。
- **仅删桌面端保留浏览器 URL**：URL 参数唯一消费者即被删分组，保留无意义，未选。

## 影响与验证

- 删除：`packages/connection-config`、`apps/electron/src/main/config-loader.*`、
  `apps/vscode-extension/src/config-loader.*`、`apps/web/src/connection-config-url.*`、
  `ConnectionSettingsModal.config.test.tsx`、`tests/e2e-web/tests/connection-config.spec.ts`。
- 修改：契约/能力矩阵/三端宿主与 preload/ipc/extension、`ConnectionSettingsModal`、
  `connection-settings-model`、i18n、相关单测/e2e/real 注释、文档。
- 验证：typecheck/lint/单测全绿；三端 mock e2e 无 console 错误；real e2e 预检读 config 正常；
  e2e 补「工作区导入含连接对象 → 连接设置预填」替代路径用例。
