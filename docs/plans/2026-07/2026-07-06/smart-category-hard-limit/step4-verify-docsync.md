---
step: 4
title: 联调 + 手测 + 文档同步
status: pending
---

## 目标

跑一遍端到端真实场景验证，修剩余小 bug，同步 CLAUDE.md / codebase-map / rules 让新架构可被 agent 索引。

## 依赖上下文

**前置 step 产出**：
- Step 1: 后端数据模型 + 工具已就绪
- Step 2: 提示词已改造，提炼源头对齐机制已激活
- Step 3: 存量清理任务链路 + UI 已上线，跑过一次真实清理

**当前关键文件状态**：
- Step 3 完成后 smart-categories.json 应该已经被大幅整理（71→10、58→10）
- Step 3 完成后可能有部分分类被 MERGE 掉了

**关键决策回顾**：
- 不写单测（项目偏好）
- 依赖 build/lint/手测 三重验证

## 计划改动

### 端到端手测清单

- [ ] **场景 1：新入卡走快速通道**
  - 触发一次新组卡的提炼 + 分类
  - 检查日志：agent 打的 tag 是否用了当前分类词汇？matchByThreshold 是否直接命中？（应比 Step 3 之前命中率高）
  - 检查 smart-categories.json：新组被 push 到哪个分类了？decision=match 还是 join？

- [ ] **场景 2：新入卡走 LLM，分类未满**
  - 造一个 tag 完全不匹配任何分类的组卡（可以手动改组卡文件测）
  - 观察 agent 是走 JOIN_EXISTING 还是 NEW_CATEGORY
  - 若 JOIN 且加了 addAnchorTags，看是否被硬上限拦截

- [ ] **场景 3：新入卡走 LLM，分类已满 → MERGE**
  - 需要工作区分类正好 10 个（Step 3 后可能刚好或不够）
  - 构造一个明显是新主题的组卡
  - 观察 agent 是否评估了 MERGE 可能性
  - 若 MERGE 了两个分类：验证 groupIds 合并去重、recentDecisions 里有 merge 记录、旧分类 id 消失

- [ ] **场景 4：撞硬上限的 Error 反馈**
  - 手动改一个分类的 anchorTags 到刚好 10 个
  - 触发一次入卡，agent 尝试 addAnchorTags → 工具应返 Error
  - 观察 agent 是否退让（不加或改用 replaceAnchorTags）

- [ ] **场景 5：存量清理的 idempotent**
  - Step 3 已经跑过一次
  - 再点一次"一键整理"按钮
  - 应该几乎无改动（已经在 10 以内，无同义词可合并）
  - recentDecisions 里 prune 数量应该很少或 0

### 已知风险点排查

- [ ] Organize 任务跟 per-group categorize 的互斥：如果 organize 跑中来了新组卡，是否正确排队？
- [ ] 冷启动（无分类）时，提炼的词汇表注入是否被跳过？
- [ ] MERGE 后 pickRedistributeCandidates 里如果引用了被删的 categoryId 会不会出问题？
- [ ] 前端 categoriesUpdated 事件在 MERGE/PRUNE 之后是否被广播？UI 是否刷新？

### 文档同步

- [ ] 调用 `/doc-sync` skill，让它检查并更新：
  - `CLAUDE.md`（如果有涉及智能分类的段落）
  - `.claude/rules/codebase-map.md`：
    - Agent 工具章节加 PruneCategoryTags
    - Agent 框架末尾的"智能分类链路"段更新（新 MERGE 分支、Organize 任务、词汇表源头对齐）
    - 数据存储加 organize-prompt.md
    - task-types 加 CATEGORIZE_ORGANIZE
  - 涉及规则文件如有需要（可能不需要）

### 完成收尾

- [ ] plan.md 步骤索引全打勾
- [ ] plan.md 末尾加"完成总结"段：实际改动汇总、与原设计的偏差、遗留 TODO（如果有）
- [ ] （可选）跟用户对齐 Step 2 归档 + 周总结的优先级

## 实施回填（做完后填）

### 实际改动
（TBD）

### 给下一步的接力棒
（这是最后一步，接力棒是"给未来阶段 2 归档/周总结实施时的输入"）
（TBD — 至少要写：本次实施后分类系统的稳态观察，为阶段 2 的归档阈值定档提供数据）
