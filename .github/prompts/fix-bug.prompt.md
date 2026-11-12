---
description: "Bug 修复工作流（Mamep2026）：根因分析 → 复现测试 → 计划 → 文档 → 修复 → 回归。"
name: "fix-bug"
argument-hint: "描述 Bug 现象或复现步骤"
agent: "agent"
---
# Bug 修复：${input:description}

> Copilot 入口：`/fix-bug`；Codex 对应入口：`$fix-bug`。

按 Mamep2026 固定工作流执行（见 `.agents/skills/dev-workflow/SKILL.md`）：

1. **根因分析**：输出《Bug 分析报告》（根因非症状、触发条件、影响范围），等确认。
2. **复现测试（强制）**：先写复现测试，**确认其失败（红）后再修复**。
3. **计划**：输出修复计划（方案、影响文件、兼容处理、测试策略），等确认。
4. **文档记录**：`docs/bugs/YYYY-MM-DD-描述.md`（套 `docs/templates/bug-report.md`）。
5. **修复实现**：最小化改动；修复后运行复现测试确认通过（绿）。
6. **回归测试**：受影响包单测 + `pnpm typecheck` + `pnpm lint`；涉及界面提醒既有 e2e 冒烟。**测试执行时机由用户决定**，同意后才跑，不得谎报。
