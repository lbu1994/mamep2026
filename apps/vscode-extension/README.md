# Mamep2026 — Modbus 开发调试工具（VSCode 端）

Mamep2026 是一款跨平台 Modbus 调试工具，本扩展将共享 UI 以 Webview 形式集成到 VS Code，通信能力在 Extension Host 中全量承载。支持 Modbus RTU（串口）与 Modbus TCP 双协议。

> 本 README 同时作为 VSIX 市场说明（staging 打包直接引用），因此不含相对链接/图片/SVG。

## 功能特性

- **Modbus RTU（串口）**：串口枚举下拉选择、连接/断开、FC03 读寄存器、FC10 写寄存器
- **Modbus TCP**：host/port/Unit ID 连接配置、读写闭环
- **寄存器表**：多表（Sheet）管理不连续保持寄存器，行编辑、插入、剪切/粘贴、多行选择、行级快捷键与右键菜单
- **单行/全表读取**、**WP 轮询**（连续读取）、**TM 追踪窗**（时序采样）
- **通信日志**：字节级日志，支持自动滚动/暂停/复制
- **工作区持久化**：自动保存与恢复（IndexedDB）
- **工作区导入/导出**：Settings 弹窗导入/导出工作区（含连接对象 `connectionProfiles`）
- 浅/深主题、中英双语（en-US / zh-CN）

## 安装

### 方式一：VSIX 安装（推荐）

1. 在仓库根目录执行 `pnpm dist:vscode`，生成 `release/mamep2026-<version>.vsix`
2. VS Code 命令面板（`Ctrl+Shift+P`）→ **Extensions: Install from VSIX...** → 选择该文件
3. 命令面板 → **Mamep2026: 打开主面板** 启动

### 方式二：源码构建

```bash
pnpm install        # 安装依赖（pnpm 11）
pnpm dev:vscode     # 开发模式（Extension Development Host，Webview 指向 dev server）
pnpm build:vscode   # 生产构建（共享 UI + 扩展宿主）
pnpm dist:vscode    # 打包 VSIX
```

## 使用说明

1. 打开主面板后，点击 **Connection Settings** 配置连接：
   - **RTU**：选择串口、设置从站地址（每张表独立）、波特率与 Rx Delay
   - **TCP**：填写 host / port / Unit ID / 超时 / 重试
   - 连接对象可通过 **Settings → 工作区导入** 导入（工作区 JSON 含连接对象 `connectionProfiles`，导入后此处预填）
2. 点击 **Connect** 建立连接，状态胶囊会显示 连接中/已连接/告警/失败
3. 在寄存器表中编辑地址/数据类型/值，执行**单行读取**、**全表读取**或**写入**；开启 WP 轮询按间隔自动刷新
4. 底部 **Communication Log** 查看字节级收发记录；**Trace** 追踪窗查看指定行的时间序列采样

## 开发

- 架构：共享 UI 在 `apps/web`（Vite + React + antd v6），Extension Host 在 `apps/vscode-extension/src`，跨边界走版本化安全 IPC（HostMessage v1）
- 测试：`pnpm test:e2e:vscode`（真实 VS Code 集成测试）、`pnpm test:e2e:vscode:real`（真实串口/TCP 从站，需 com0com 环境）
- 扩展宿主调试探针：`MAMEP_FAKE_SERIAL=1` / `MAMEP_FAKE_TCP=1` / `MAMEP_FAKE_DIALOG=1`（仅非生产模式生效，供 e2e 使用）

## 已知限制

- `readAllRows`（全表读取）支持取消：远程批任务经 `session-batch-cancel` 取消宿主侧任务，UI 提供取消入口；`BatchReadHandle` 契约与本地路径一致
- TCP 会话内 Unit ID 不支持动态修改（工具栏从站地址对 TCP 无效，宿主已守卫）
- 扩展当前仅打包不发布（VSIX 由 `pnpm dist:vscode` 本地生成）

## 版本

版本号跟随仓库根 `package.json` 的 `version`（打包时注入）。
