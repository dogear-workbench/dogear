---
step: 2
title: skill 层三文件
status: pending
---

## 目标

新建 code-discipline（不分步代码实施工程纪律的单一来源）；staged-execution 瘦身为纯分步编排；brainstorming 衔接段引用化。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 已落用户级 agent.md（「拿不准先问」已在人格层生效）
- 关键边界：skill 模板随应用分发到所有工作区，内容不得写死 dogear 项目命令/路径；对系统段与 agent.md 的既有约定一律「引用不复述」
- 现状文件：`resources/skill-templates/staged-execution/SKILL.md`（200+ 行）、`resources/skill-templates/brainstorming/SKILL.md`（「后续衔接」节含分步判断标准逐字重复）

## 计划改动

- [ ] 新建 `resources/skill-templates/code-discipline/SKILL.md`，全文如下（框架逐字保留，标注 ⟨…⟩ 处按括号内要求措辞）：

```markdown
---
name: code-discipline
description: 代码实施的工程纪律（实施前勘察 / 验收自检 / 提交规范）。所有动代码的任务在实施阶段适用——不分步的单步任务直接按本 skill 执行；分步任务（stepN-*.md）叠加 staged-execution 的编排协议。
---

# 代码实施纪律

分步不分步都适用的实施阶段纪律。项目特有硬约束（注释风格、行数上限、模块红线）以各工作区 agent.md 为准，本 skill 不重复；改前勘察以系统「git 历史意识」段为准，不重复。

## 实施前

- 查 git 历史与未提交改动（dogear__GitLog / dogear__GitStatus / dogear__GitDiff），避免重复造轮子或覆盖他人未提交改动
- 读关联模块代码确认影响面；影响面拿不准 → 停下问用户，不带一半把握动手
- 确认改动清单边界：本次任务要动哪些文件、不碰哪些

## 实施中

- 只改计划内文件；发现需要越界改动 → 停下说明，不静默扩大 scope
- 不留半成品：不放 TODO、不放空 stub，写完即完整

## 实施后（验收自检）

- ⟨按项目 agent.md 常用命令区执行 lint 与构建——改了主进程/后端代码必须重新编译构建产物，前端热重载不覆盖⟩
- 对照任务目标逐条核对实现完整性，而非「代码写完了」
- 新增 store / service / IPC 路由 / Agent 工具 / 页面后，评估是否触发 doc-sync

## 提交规范

- 只 commit 本次任务相关文件：git status + git diff 核对，混入无关文件 → 停下问用户
- message：⟨type⟩(⟨模块⟩): ⟨一句话说清做了什么与为什么⟩，参照项目现有 commit history 的命名
- 验收通过即 commit，不攒批
- ⟨项目若明确禁止 AI 署名 trailer（如 Co-Authored-By），一律不加；永不 --no-verify、永不 --force⟩
```

- [ ] 重写 `resources/skill-templates/staged-execution/SKILL.md`，结构如下（删/留清单）：
  - frontmatter：description 改为「按已有分步实施计划（docs/plans/**/stepN-*.md）编排执行的主/子会话协议：step 状态流转、分派、回填打勾、每 step 一提交。触发：主会话读到 stepN-*.md 且用户意图是开始/继续实施；工程纪律按 code-discipline，协作协议按系统协作规范段。」
  - **留**：何时触发/不触发、前置检查、铁律（主会话不直接写业务代码 + <20 行单文件例外）、分派规则（每 step 一个子会话、task 三块模板、独立块可并行）、执行循环（status 流转/回填/打勾/commit 时机）、失败处理（3 次失败停机/跨 step 连锁停下问/工作区脏先问）、分步反模式、与 staged-impl 接力表
  - **删**：主/子分工表（改为一句「派遣/等待/验收/复用按系统『主会话与子会话协作规范』段」）；验收清单全文（改为「按 code-discipline 验收自检 + 核对交付未越 stepN 范围」）；提交规范全文（改为「按 code-discipline 提交规范，仅 commit 该 step 计划改动 + stepN.md + plan.md」）
  - 目标：全文压到 100 行内，删掉的内容不得丢语义（被引用的两处单一来源已覆盖）
- [ ] 编辑 `resources/skill-templates/brainstorming/SKILL.md`「后续衔接」节：把逐字重复的判断标准三条（跨 ≥3 文件且步骤有依赖 / 需跨会话续做 / 架构层变更）替换为一句「满足分步条件（标准见系统『笔记存卡纪律』段：跨 ≥3 文件且有依赖 / 需跨会话续做 / 架构层变更）时」——保留括号内极简摘要 + 指向权威源，其余文字不变
- [ ] 三文件完成后通读一遍：确认无「同一约定在两个 skill 内文都出现全文」的情况

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- code-discipline 最终 frontmatter description 原文（Step 3 的 ability-registry 注册要用 name）：
- staged-execution 瘦身后行数：
- 下个 step 该从哪里继续：
- 待办或已知限制：
