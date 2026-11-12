---
description: "对当前变更做回归验证（Mamep2026）：定位影响面、跑相关测试、输出摘要。"
name: "regression-check"
argument-hint: "说明本次变更范围（可选）"
agent: "agent"
---
# 回归验证：${input:description}

> Codex 入口：`$regression-check`。本文件是迁出存档的 Copilot prompt 模板；如需 Copilot 自动发现，请复制回 `.github/prompts/`。

对当前变更做回归检查，**执行前先征求用户同意**（测试执行时机由用户决定，docs/AGENTS.md §27）：

1. 识别变更影响模块（按 `packages/*` 分层与调用关系）。
2. 运行受影响包单测：`pnpm --filter <受影响包> test`。
3. 运行静态检查：`pnpm typecheck`、`pnpm lint`。
4. 涉及界面/传输：提醒 `pnpm dev` 冒烟或相关 e2e（`test:e2e:web`/`electron`/`vscode`）。
5. 输出摘要：通过数/总数、失败项详情、建议；通过标准 = 相关测试全过、无新 warning。
