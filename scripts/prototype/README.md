# Node 串口原型 — Electron / VSCode 探针（TECH_DESIGN §34.3.14 / §34.3.15）

独立探针：**不动生产代码**，能力矩阵不翻转（翻转计划记录于 ADR-020 的后续复审条件）。
前置：com0com 虚拟串口对 **COM4↔COM5** 已配置（只读写、禁止配置/提权）；`pnpm install` 已执行。

## Electron 探针（Electron Main 进程）

验证 serialport 原生绑定在 Electron Main 的 ABI 加载、枚举、打开 COM4、
与 modbus-slave（COM5）的 FC03 闭环、关闭与干净退出。自动拉起/关闭从站。

```bash
pnpm prototype:electron
```

预期输出：`FC03 闭环 OK（0x0000 = 1234）`、`DONE`，退出码 0。

### 可能的 ABI 不匹配

serialport 原生绑定默认按**当前 Node ABI** 构建（Node 24）。Electron 43 的 Node ABI 不同，
首次在 Electron 中加载可能报类似：

```
Error: The module '...\bindings.node' was compiled against a different Node.js version
```

处理（二选一）：

1. 用 `@electron/rebuild` 为 Electron 重建 serialport（仓库已有该 devDep）：
   ```bash
   npx electron-rebuild -f -w serialport
   pnpm prototype:electron
   # 验证完 Node 侧测试前，务必重建回 Node ABI：
   npx electron-rebuild -f -w serialport --version 0   # 或重装：pnpm rebuild serialport
   ```
2. 若不改造本机串口测试环境，把「Electron 内原生模块 ABI 加载」作为接线阶段的验证项（见 ADR-020）。

> ⚠️ 重建会改变 `node_modules` 中绑定文件的 ABI。重建为 Electron 后，`pnpm test:serial:virtual`
> 与 `packages/platform-node` 的 Node 侧测试会因 ABI 不匹配失败——**验证完必须重建回 Node ABI**。
> 推荐在独立副本/CI 中做 Electron 重建验证，避免污染本机 Node 测试环境。

## VSCode 探针（真实 Extension Host）

在真实 VSCode 扩展宿主中验证 serialport 加载、枚举、打开 COM4、FC03 闭环、关闭。
自动拉起/关闭从站（runner 由 Node 运行）。

```bash
pnpm probe:vscode:serial
```

输出以 `[probe]` 前缀打印过程与结论。若原生绑定 ABI 与 VSCode 不匹配，会打印
`LOAD FAILED` 诊断（选型验证的预期发现），不抛异常。

> VSCode 探针将 serialport 声明在 `tests/e2e-vscode` 的 devDependencies（仅测试用），
> 不改变 `apps/vscode-extension` 生产依赖。

## 打包后原生模块加载（§34.3.1 / §34.3.14 / §34.3.15）

当前 `scripts/package-electron.mjs` 组装 staging 时排除全部 node_modules，打包产物不含原生模块。
「打包后原生模块可加载」验证需改组装脚本（把 serialport 及其原生绑定拷入 staging），
属接线/打包阶段事项，记录于 ADR-020 后续复审条件，本原型不实施。
