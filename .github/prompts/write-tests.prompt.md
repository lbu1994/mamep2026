---
description: "按项目既有风格生成 vitest 测试用例（Mamep2026）。"
name: "write-tests"
argument-hint: "选择代码或说明要覆盖的功能"
agent: "agent"
---
# 生成测试用例：${input:description}

> Copilot 入口：`/write-tests`；Codex 对应入口：`$write-tests`。

为选中的代码/功能生成 vitest 测试，遵循项目既有测试风格：

1. 使用项目现有测试框架与模式（vitest；调度测试用 Virtual Clock + FakeTransport，见 `packages/test-kit`）。
2. 命名格式：`should <expected behavior> when <condition>`。
3. 覆盖：正常路径、边界（Null/Empty/Min/Max）、异常路径。
4. 通过公共 API 验证行为，不测私有方法。
5. 外部依赖使用项目既有 Mock 策略。
6. **不要**先跑测试——仅产出用例供用户审阅；是否执行由用户决定（docs/AGENTS.md §27）。
