---
name: write-tests
description: "Mamep2026 测试生成入口。按现有 Vitest 模式生成用例，默认只编写不执行。"
---

# 生成测试用例

本 Skill 是 Mamep2026 测试生成的 Codex 显式入口。用户指定的代码、功能或范围位于调用参数中；缺少目标时先询问。

1. 阅读目标和调用方代码、相邻测试及 `packages/test-kit` 中可复用设施。
2. 遵循现有 Vitest 结构，使用测试名 `should <expected behavior> when <condition>`。
3. 覆盖正常路径、边界和异常路径，通过公共 API 验证行为。
4. 外部依赖使用项目既有 Fake/Mock 策略，不测私有实现。
5. 默认只生成或修改用例，不执行测试；用户明确授权执行后再运行。

若编写用例时发现需要修改产品代码，先说明该发现，不擅自进入修复。
