---
name: code-discipline
description: 代码实施的工程纪律（实施前勘察 / 验收自检 / 提交规范）。所有动代码的任务在实施阶段适用——不分步的单步任务直接按本 skill 执行；分步任务（stepN-*.md）叠加 staged-execution 的编排协议。
---

# 代码实施纪律

分步不分步都适用的实施阶段纪律。项目特有硬约束（注释风格、行数上限、模块红线）以各工作区 agent.md 为准，本 skill 不重复；改前勘察以系统「git 历史意识」段为准，不重复。

## 实施前

- 开工先查记忆：用 dogear__RecallMemory 检索本次任务相关关键词（坑 / 决策 / 模式），命中即吸收进方案，避免重复踩坑
- 查 git 历史与未提交改动（dogear__GitLog / dogear__GitStatus / dogear__GitDiff），避免重复造轮子或覆盖他人未提交改动
- 读关联模块代码确认影响面；影响面拿不准 → 停下问用户，不带一半把握动手
- 确认改动清单边界：本次任务要动哪些文件、不碰哪些

## 实施中

- 只改计划内文件；发现需要越界改动 → 停下说明，不静默扩大 scope
- 不留半成品：不放 TODO、不放空 stub，写完即完整

## 实施后（验收自检）

- 按项目 agent.md 常用命令区执行 lint 与构建——改了主进程/后端代码必须重新编译构建产物，前端热重载不覆盖
- 对照任务目标逐条核对实现完整性，而非「代码写完了」
- 新增 store / service / IPC 路由 / Agent 工具 / 页面后，评估是否触发 doc-sync

## 提交规范

- 只 commit 本次任务相关文件：git status + git diff 核对，混入无关文件 → 停下问用户
- message：`<type>(<模块>): <一句话说清做了什么与为什么>`，参照项目现有 commit history 的命名
- 验收通过即 commit，不攒批
- 项目若明确禁止 AI 署名 trailer（如 Co-Authored-By），一律不加；永不 --no-verify、永不 --force
