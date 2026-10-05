---
step: 4
title: doc-sync 与端到端自查
status: done
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
- 与计划差异：settings.md 检查后不改（仅 WorkspaceRuleDialog 提及 agent.md 编辑器，无模板内容描述，全 codebase-map grep「子会话使用|general.md」零命中）；a0cqxgqz 分支核对为推演成立（该任务创建于 Step 3 接线前，历史实参未传 execProfile；tasks.json 在当前环境不存在无法目验运行时，遗留①）；step3 回填个别锚点与实测 ±1，交付文档已按实测行号记录
- 改动文件清单：`docs/codebase-map/agent-core.md`（5 处：task-queue 条目更新、新增 task-execution-prompt.ts 条目、ability-registry 条目补 code-workflow 7 skill、task-tools 条目判断标准更新、session-append-templates 条目补派遣成本判断节）

### 给下一步的接力棒
- 端到端自查全部通过/未通过项：5 项全过——①code-workflow 包开启→code-discipline 进索引（skill-template-service.ts:22-26 + pi-session.ts:429-473 推演链）；②code-impl 入队→skillsOverride 双 skill（task-queue.ts:38-41/:232 + pi-session.ts:465-468）；③a0cqxgqz 单步分支推演正确（plan 形态=设计文档→直接实施分支）；④pi-session.ts:476 拼接注入未动（四笔提交 16 文件不含 pi-session.ts）；⑤general.md 与用户级 agent.md diff 完全一致、恢复模板链路不再写回「子会话使用」节
- 遗留问题：①真任务运行时目验 <available_skills>（待用户验收时挂单步 code-impl 任务目验）；②NOTES_DISCIPLINE 指向 staged-impl（全局决策不动，后续范围）；③tasks.json 环境缺失无法运行时目验；④执行模式通用行与 code-impl 规则行轻微措辞张力（规则行更具体可覆盖）；⑤agent-core.md 既有漂移（skill 三源索引实际在 pi-session.ts 本体而非 tool-assembly.ts，非本次引入未动）；另：工作区 agent.md 硬约束第一条去重被禁写区拦截，已挂用户勾选卡待 UI 处理
