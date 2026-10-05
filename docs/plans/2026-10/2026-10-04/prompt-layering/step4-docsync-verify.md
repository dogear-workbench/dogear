---
step: 4
title: doc-sync 与端到端自查
status: pending
---

## 目标

代码地图与实际一致；挂载链路端到端核对；整个重构收口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 3 回填的实际改动文件与行号锚点
- 本计划全部文件清单见 plan.md「涉及模块」

## 计划改动

- [ ] doc-sync：更新 `docs/codebase-map/agent-core.md`——skill 体系段补 code-discipline、staged-execution 职责变化（纯分步编排）、task-queue 查表新值、CreateTask 语义（动代码即 code-impl、形态决定分步）、task-execution-prompt 分支变化；settings.md 若提及 agent.md 模板/用户级规则，同步 general.md 模板变化
- [ ] 端到端自查（只读核对，逐项在交付文档记录结论）：
  - code-workflow 包开启的工作区：code-discipline 出现在 skill 索引（读 ability-registry 解析逻辑推演即可，不启应用）
  - code-impl 任务入队：task-queue skillsOverride 两个 skill 均挂载
  - 单步 code-impl 任务（如浏览器扩展任务 a0cqxgqz 的 plan 形态）执行会话读到的提示词分支正确（设计文档 → 直接实施分支）
  - 用户级 + 工作区 agent.md 拼接注入（pi-session.ts:476 逻辑未动，确认即可）
  - general.md 模板与用户级 agent.md 内容一致；「恢复模板」不再写回「子会话使用」节
- [ ] git log 核对四个 step 各一笔提交、message 符合规范、无 AI 署名 trailer
- [ ] 交付文档（共享区 step4-delivery.md）：各步提交 hash、端到端自查逐项结论、遗留问题

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 端到端自查全部通过/未通过项：
- 遗留问题：
