---
step: 3
title: 代码接线
status: done
---

## 目标

execProfile 挂载链路、CreateTask 语义文案、能力包注册、执行提示词四点接线，全部随新语义生效并通过构建与测试。

## 依赖上下文（接力棒输入）

- 前置 step 产出：code-discipline skill 已存在（name=`code-discipline`）；staged-execution 已瘦身为纯分步编排
- 现状锚点：
  - `electron/main/services/task-queue.ts:30-32` 挂载查表：`default` 空清单、`'code-impl': ['staged-execution']`
  - `electron/main/agents/tools/task-tools.ts:53`（注册指引）与 `:63`（zod describe）两处文案
  - `electron/main/agents/ability-registry.ts:212-220` code-workflow 包 skills 数组（现 6 项）
  - `electron/main/services/task-execution-prompt.ts` buildExecutionPrompt 的 execProfile 双分支
  - `electron/main/agents/session-append-templates.ts` MAIN_AGENT_DELEGATION_APPEND（吸收 general.md 迁出的派遣成本判断）
- 语义定义（新）：**动代码即 code-impl；分步与否由 plan 文档形态决定**（stepN-*.md=分步；设计文档/单文档=单步）。执行会话按 planPath 形态选用纪律：单步只用 code-discipline；分步叠加 staged-execution

## 计划改动

- [ ] `electron/main/services/task-queue.ts` 查表改为 `'code-impl': ['code-discipline', 'staged-execution']`，表上方注释同步语义（执行会话按 planPath 形态自行选用，两 skill 同时挂载仅增索引成本）
- [ ] `electron/main/agents/tools/task-tools.ts` 两处文案改为：注册指引——「execProfile 判断标准：任务要动代码即填 code-impl（执行会话挂 code-discipline 工程纪律；plan 为分步文档 stepN-*.md 时再叠加 staged-execution 编排）；调研/整理类不填」；zod describe 同义压缩
- [ ] `electron/main/agents/ability-registry.ts` code-workflow 包 skills 数组加 `'code-discipline'`（保持字母序或数组现有顺序风格，看清再插）
- [ ] `electron/main/services/task-execution-prompt.ts` code-impl 分支提示词改为按 plan 形态二选一：「plan 为分步文档（stepN-*.md）→ 按 staged-execution 编排逐 step 派子会话实施；为设计文档/单文档 → 本会话直接实施，全程遵守 code-discipline（勘察/验收自检/提交规范）」。default 分支不动
- [ ] `electron/main/agents/session-append-templates.ts` MAIN_AGENT_DELEGATION_APPEND 的「子会话复用判断」节之前插入「派遣成本判断」小节，内容从 general.md 原文迁移改写：「探索类任务（要读 ≥2 个不熟悉的文件、需 ≥3 轮搜索迭代、或回答『在哪里/怎么实现』类问题）→ 派子会话，主会话只看摘要；已知文件路径的单点查询、改一两行 → 主会话直接做，子会话有启动开销；不为『用子会话』而拆分本可一次做完的任务」
- [ ] 检查测试并跑通：`electron/main/agents/ability-registry.test.ts`（code-workflow skills 断言如有需同步）、`electron/main/agents/tool-registration-smoke.test.ts`、task-queue / task-execution-prompt 相关测试（grep 定位）；命令：`bun run build:electron` → 相关测试文件逐一 `bun test` → `bun run lint`
- [ ] doc-sync 前置：本步不更新 codebase-map（Step 4 统一做）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：step 文档现状锚点漂移——buildExecutionPrompt 双分支已被 97b55d25（10-01）合并为通用模板+mountedSkills，子会话按计划意图恢复显式 execProfile 分支：default/缺省渲染与 97b55d25 后现状逐字一致（主会话已对照 diff 核实），code-impl 注入二选一规则行；旧决策「新 execProfile 提示词零改动」被本次设计有意覆盖（两 skill 同挂时需模板给裁决依据）。另：EXECUTION_PROMPT_PREVIEW 不动（场景页零改动）；ability-registry.test.ts 无 skills 数组内容断言，无需同步；mountedSkills 注释顺带修正与新分支冲突的旧表述
- 改动文件清单：
  - `electron/main/services/task-queue.ts`（:36-39 查表双 skill + 注释，:311 透传 execProfile）
  - `electron/main/agents/tools/task-tools.ts`（:53/:63 两处文案）
  - `electron/main/agents/ability-registry.ts`（:218 code-workflow 加 code-discipline，字母序）
  - `electron/main/services/task-execution-prompt.ts`（:10-11 可选 execProfile 字段，:18-23 codeImplModeLines，:35 规则行插入）
  - `electron/main/agents/session-append-templates.ts`（:46-47 派遣成本判断节，general.md 原版 3 条迁移改写，原文取自 dcb90c61^）
  - `electron/main/services/task-execution-prompt.test.ts`（+2 用例：code-impl 含规则行 / default 不含）
- 测试结果（build/test/lint）：build:electron tsc 零错误；task-execution-prompt 6 pass + ability-registry / tool-registration-smoke / task-store 63 pass（主会话复跑 3 文件 45 pass 0 fail）；lint 0 errors / 70 warnings 全存量。环境注记：本机 bun run 需 PATH 前置 ~/.bun/bin 与 node v22.2.0

### 给下一步的接力棒
- 实际改动的文件与行号锚点（doc-sync 要引用）：见上「改动文件清单」各行号
- 下个 step 该从哪里继续：Step 4（codebase-map 同步 + 挂载链路端到端验证）
- 待办或已知限制：①skill 模板分发可见性——code-discipline 走 skillsOverride 挂载，Step 4 需目验真任务 available_skills；②NOTES_DISCIPLINE 的 staged-impl 指向系 staged-impl 本次不动的全局决策，遗留；③agent-core.md 的 buildExecutionPrompt 描述已过期（现为模板分支+挂载行并存），Step 4 更新；④执行模式通用行与 code-impl 规则行有轻微措辞张力，规则行更具体可覆盖，未动
