# Mamep2026

Mamep2026 是一款面向嵌入式开发和设备调试的跨平台 Modbus 工具，可在浏览器、Electron、VSCode 插件和 Android 客户端中使用，通过同一套界面完成设备连接、寄存器监控与读写操作。

它支持 Modbus RTU/TCP、多标签寄存器表、不连续地址和连续范围读写、单行与全表操作、周期轮询、写后回读、通信日志、数据追踪、工作区保存与导入导出，以及浅色/深色主题和中英文界面。厂商扩展功能通过插件提供，便于在不膨胀核心工具的前提下扩展协议、表类型和数据类型。

## 技术栈

- TypeScript（strict）+ pnpm 11 monorepo + Turborepo。
- React 19、Vite 8、Ant Design 6，浏览器、Electron、VSCode 和 Android 共用同一套界面与领域模型。
- Zustand 管理界面与工作区状态，React Hook Form 和 Zod 负责表单及运行时校验，i18next 提供中英文界面。
- 浏览器、VSCode Webview 和 Android 使用 IndexedDB 保存本地工作区；Electron 使用应用数据目录中的版本化 JSON 文件。
- Electron 43 提供桌面壳和主进程能力；VSCode 扩展通过 Extension Host 与 Webview 运行共享界面；Android 使用 Capacitor 8、原生 TCP 及 USB-RS485 串口插件；Node 串口由 serialport 13 提供。
- 跨进程与跨平台调用统一使用类型化消息、运行时校验和能力白名单，渲染界面不直接访问 Node.js 或原生设备 API。
- 测试使用 Vitest、React Testing Library 和 Playwright，覆盖单元、验收、四端端到端测试及真实 RTU/TCP 设备联调。

## 仓库结构

- `apps/web/`：浏览器界面及 Electron Renderer，同时生成 VSCode 和 Android 使用的共享 UI 构建产物。
- `apps/electron/`：Electron 主进程与 preload，负责窗口、安全消息桥、TCP 会话和本地工作区持久化。
- `apps/vscode-extension/`：VSCode 扩展与 Extension Host，通过 Webview 加载共享界面并提供宿主侧通信能力。
- `apps/android/`：Capacitor 容器及 Android 原生工程，提供 TCP、USB-RS485、生命周期和应用打包能力。
- `packages/`：共享领域与基础设施包，包括寄存器模型、Modbus 协议、数据转换、通信会话、工作区、日志、插件 API、平台适配、共享 UI、主题和测试工具。
- `plugins/`：手动安装的扩展，包括地址调整、自定义功能码、安川协议、示例面板和主题色；`pnpm build:plugins` 将可安装产物生成到 `release/plugins/`。
- `config/`：真实设备和自动化联调使用的连接参数。
- `scripts/`：开发、构建、打包、图标、测试编排和 RTU/TCP 模拟从站工具。
- `tests/`：验收测试，以及 Web、Electron、VSCode、Android 的端到端测试。
- `tooling/`：仓库共享的 TypeScript 配置。

## 常用命令

### 开发与构建

- `pnpm dev`：启动浏览器开发服务器，默认地址为 `http://localhost:5173`。
- `pnpm dev:electron`：启动 Electron 模式的 Vite 开发服务器；另开终端执行 `pnpm start:electron` 打开桌面窗口。
- `pnpm dev:vscode`：构建扩展并启动 VSCode 开发窗口。
- `pnpm dev:slave`、`pnpm dev:electron:slave`、`pnpm dev:vscode:slave`：同时启动对应的开发环境和 Modbus 从站。
- `pnpm build`：构建浏览器版本。
- `pnpm build:electron`：构建 Electron Renderer 及其桌面运行文件。
- `pnpm build:vscode`：构建 VSCode Webview 和 Extension Host。
- `pnpm build:android`：同步 Android 工程并构建调试 APK。
- `pnpm build:android:release`：构建发布 APK 和 AAB；未配置签名材料时生成未签名 APK。
- `pnpm build:plugins`：构建可安装的外部插件到 `release/plugins/`。
- `pnpm preview`：本地预览浏览器构建产物。

### 测试与检查

- `pnpm test`：运行全仓库单元测试。
- `pnpm test:acceptance`：运行核心验收测试。
- `pnpm test:e2e:web`、`pnpm test:e2e:electron`、`pnpm test:e2e:vscode`：分别运行三端端到端测试。
- `pnpm test:e2e:android`：连接已授权 Android 真机，运行 TCP 端到端测试。
- `pnpm test:e2e:real`：编排并运行真实 RTU/TCP 设备测试；缺少设备环境时跳过。
- `pnpm test:serial:virtual`：运行虚拟串口验证。
- `pnpm test:all`：从干净环境运行单元测试、验收测试、三端端到端测试、真实端口测试、虚拟串口、lint 和类型检查。
- `pnpm lint`、`pnpm typecheck`：运行全仓库 ESLint 与 TypeScript 检查。
- `pnpm format`、`pnpm format:check`：格式化或检查格式。

测试日志统一写入 `test-reports/run-<时间戳>/`。每项测试生成独立日志和 `summary.json`，全量回归额外生成 `result.json`。可通过 `MAMEP_TEST_ALL_STEPS=lint,typecheck` 只运行指定的全量回归步骤。

## 快速开始

安装依赖后可直接启动浏览器版本：

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:5173` 后可配置真实设备。使用 `http://localhost:5173/?mockTransport=1` 可启用开发环境内置的模拟 Modbus RTU，无需串口即可体验连接、读写、轮询和追踪。模拟传输只在开发构建中启用。

浏览器仅支持 Modbus RTU；Electron、VSCode 和 Android 支持 Modbus TCP。Android 还支持 USB-RS485。真实设备参数在应用的连接设置中填写。

### 启动四端

| 端       | 命令                                                                 | 说明                                                                 |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 浏览器   | `pnpm dev`                                                           | 在浏览器中打开 `http://localhost:5173`。                              |
| Electron | `pnpm dev:electron`，再运行 `pnpm start:electron`                    | 开发模式连接 Vite 服务；生产模式加载 Electron 构建产物。             |
| VSCode   | `pnpm dev:vscode`                                                    | 构建扩展并启动 VSCode 开发窗口，通过 Webview 加载共享界面。          |
| Android  | `pnpm build:android`                                                 | 使用 JDK 24 或更低版本及 Android SDK 构建，然后通过 `adb install` 安装。 |

### 打包分发

```bash
pnpm dist:portable        # Windows x64 Electron 免安装版
pnpm dist:vscode          # VSCode 扩展 VSIX
pnpm build:android:release # Android 发布 APK 与 AAB
```

Electron 免安装版生成在 `release/win-unpacked/`，目标电脑无需安装 Node.js 或 pnpm。VSCode 扩展生成在 `release/mamep2026-<version>.vsix`。Android 发布产物位于 `apps/android/android/app/build/outputs/`；配置签名材料后生成已签名 APK，否则生成未签名 APK，AAB 用于应用市场发布。

## 文档索引

TODO