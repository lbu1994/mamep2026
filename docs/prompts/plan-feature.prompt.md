---
description: "新功能开发完整工作流（Mamep2026）：需求澄清 → 计划 → 文档 → 实现 → 测试 → 回归，各阶段暂停等确认。"
name: "plan-feature"
argument-hint: "描述新功能需求"
agent: "agent"
---
# 新功能开发：${input:description}

> Codex 入口：`$plan-feature`。本文件是迁出存档的 Copilot prompt 模板；如需 Copilot 自动发现，请复制回 `.github/prompts/`。

按 Mamep2026 固定工作流执行（见 `.agents/skills/dev-workflow/SKILL.md`），每步结束暂停等确认：

1. **需求澄清**：输出《需求澄清清单》（边界条件、异常场景、性能/安全、对现有模块影响、未确认项），等确认。
2. **计划（Plan）**：输出实施计划（影响文件、变更点、测试策略、风险回滚），等用户确认「计划通过」再动手。
3. **文档记录**：在 `docs/features/YYYY-MM-DD-描述.md` 建记录（套 `docs/templates/feature-request.md`）；架构级决策另补 `docs/adr/`，并更新根 `AGENTS.md` 开发进度。
4. **代码变更**：最小化、单一职责；先读相关测试与类型定义；遵守红线（不新增内置插件、UI 不直连串口/TCP/FS、不用 any 蒙混）。
5. **测试**：先列出测试策略征求用户；**测试执行时机由用户决定**（docs/AGENTS.md §27），同意后才跑，不得谎报；核心逻辑遵循「先写失败测试（红）→ 实现（绿）」。
6. **回归**：受影响包单测 + `pnpm typecheck` + `pnpm lint`；涉及界面提醒 `pnpm dev` 冒烟，先征得同意。
