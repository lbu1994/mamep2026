# Android 端插件安装与可执行插件（Phase 5）

- **日期**：2026-09-13
- **状态**：已完成（真机 e2e 全绿）
- **决策记录**：[docs/adr/ADR-056-Android插件安装与可执行插件.md](../adr/ADR-056-Android插件安装与可执行插件.md)（架构与安全决策以 ADR 为准，本文只记需求口径与交付结果）
- **来源**：`ToDoList.md` 阶段二「[verify] 插件 Phase 5：Android 端可执行插件（ADR-054 §7.2）」

## 需求

把 Android 端补齐到与其它三端一致的插件能力：**能安装插件**（纯清单与可执行）、
**能执行可执行插件**（Blob Worker 隔离 / 同进程），并完成 Phase 5 的另一半——
**APK/AAB 发布打包与签名**。

## 需求澄清结论（用户确认）

| 问题           | 结论                                                      |
| -------------- | --------------------------------------------------------- |
| 范围           | 真机验证通过即**一并落地**（不只出结论）                  |
| APK/AAB 签名   | **包含**在本次内                                          |
| 安装入口       | 一并把 `pluginInstall` 由 `"unsupported"` 改为 `"upload"` |
| 执行能力判定   | **运行时探测**（不静态翻转、不按 WebView 版本号门控）     |
| 同进程执行     | 与桌面端一致（不单独门控）                                |
| 真机验证执行者 | AI                                                        |
| 错误提示       | 与桌面端一致即可（复用既有错误键）                        |
| 文件过滤       | **放宽**（规避 ROM 的 MIME 过滤）                         |
| 安全边界       | **不变**（默认隔离 / 同进程需显式授权 / CSP 不放宽）      |

## 事实纠正（实施前发现）

- ADR-054 §7.2 与待办原文「Android 纯清单插件当前已可安装」**不成立**：当时
  `androidCapabilities.pluginInstall === "unsupported"`，`PluginManagerSection` 在点击安装时直接报错返回，
  **任何插件（含纯清单）都装不了**。已随本次一并修正（能力位 + 文档）。

## 交付结果

- `pluginInstall: "upload"`（隐藏 `<input type="file">` + 客户端读文本）；`accept` 放宽为 `.json,.mjs,.js`；
- `executablePlugins` 由 `probePluginExecutionSupport()` 运行时探测后经 `resolveAndroidCapabilities()` 覆盖
  （静态 `false` 为 fail-closed 基线）；Android Host 工厂改 async，能力在 UI 首次读取前定型；
- 发布打包签名：`pnpm build:android:release` → APK + AAB（材料缺失则 unsigned + 提示，不冒用 debug key）；
- 新增 `tests/e2e-android/tests/plugin-runtime.spec.ts`（7 用例）。

## 验证

- 单测：`platform-web` 73（+4）、`platform-android` 81（+3）、`apps/web` 126（+5）、`ui` 406（+1）；
  全仓 `pnpm test` 28/28 tasks、`pnpm typecheck` 32/32、`pnpm lint` EXIT=0。
- 真机（vivo V2303A / Android 16 / 无线调试，生产 APK）：`pnpm test:e2e:android`
  **16 passed / 2 skipped / 0 failed**；插件 spec **7/7**（探针 / 入口 / `.json` 安装 / `.mjs` 隔离安装 /
  reload 后 Blob Worker 仍加载 + 卸载 / same-process 同步贡献生效 + 卸载 / 无 console 错误）。
- 签名接线：临时 keystore（口令本地生成、不打印、验证后删除）→ `apksigner verify` 通过；
  无材料分支产出 `app-release-unsigned.apk` + 提示；debug 构建零回归。
- 浏览器回归：`pnpm test:e2e:web` 全绿。

## 已知限制

见 [ADR-056 §6](../adr/ADR-056-Android插件安装与可执行插件.md)：系统 SAF 选择器 UI 未自动化、
`same-process` 未单独门控、探测粒度（每次启动一次 + 3s 超时）、发布密钥由用户持有、
Android `logExport`/`workspaceImport`/`workspaceExport` 仍为 `"unsupported"`（Phase 4 文件通道）。
