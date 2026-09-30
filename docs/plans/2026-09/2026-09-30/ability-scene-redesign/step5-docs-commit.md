---
step: 5
title: 文档同步与提交
status: done
---

## 目标

codebase-map 与实际代码一致；plan 收尾；改动落 git 提交。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] core-profile 删除；[step2] category + getSceneOverview；[step3] 能力页只读化；[step4] 场景 tab 上线
- 本步为纯收尾，无代码功能改动

## 计划改动

- [x] `docs/codebase-map/settings.md`：能力页改为「只读展示+三大类分组」描述、新增场景 tab 与 scene/ 组件、SubAgentTab 文案修正注记、config-mutations.ts 共享模块条目
- [x] `docs/codebase-map/agent-core.md`：能力包 14→13（core-profile 移除）、AbilityPack.category 字段、getSceneOverview IPC、memory 工具组删画像工具
- [x] `docs/codebase-map/data-center.md`：记忆面板删画像查看块描述（若该文件提及）——核对 step1 已顺手改过且无残留，本次零改动
- [x] `plan.md` 末尾补「完成总结」：实际改动汇总、与原计划偏差
- [x] 全链路目验一遍：能力页只读、场景页六场景开关与恢复默认、新建会话正常装配（日志确认无 core-profile）——无人值守无法真正目验 UI，改为静态核验：build:electron / build:renderer / tsc --noEmit 全绿，UI 目验留给用户审核
- [ ] `dogear__GitCommit`：能力区重构（场景 tab + 只读化 + core-profile 退役），message 一行说清做了什么与为什么；不加 Co-Authored-By ——由派出方主会话执行

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - data-center.md 核对后零改动（step1 已顺手改且无画像残留）
  - 顺带修正 settings.md page.tsx 过时描述（dirty 三按钮 confirm → 全实时保存+受控八页，该描述早于本系列就已滞后）与 index.md 检索词（能力包 UI → 能力/场景页，聊天词补「场景」）
  - agent-core.md 原无 memory 工具条目，画像删除以一句附注落在 ability-registry 条目尾部
  - 目验项改静态核验：三构建全绿（exit 0），UI 目验留给用户
- 改动文件清单：docs/codebase-map/settings.md、agent-core.md、index.md；docs/plans/.../plan.md、step5-docs-commit.md

### 给下一步的接力棒

- 关键签名 / 数据结构：无代码改动，代码侧接力棒见 step4 回填
- 下个 step 该从哪里继续：本计划已收尾，仅剩 git commit 由主会话执行（step1-4 已各自成提交，本次文档改动可单独一笔或并入收尾提交）
- 待办或已知限制：UI 全链路目验（能力页只读、场景页开关/恢复默认、新建会话装配）待用户人工审核
