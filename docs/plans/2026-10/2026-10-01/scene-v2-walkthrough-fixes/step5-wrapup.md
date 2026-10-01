---
step: 5
title: 收尾
status: done
---

## 目标
全链路目验、codebase-map 同步、按 step 粒度补齐提交。

## 依赖上下文（接力棒输入）
- 前置 step1-4 回填的接力棒（各自改动文件清单）
- codebase-map：`docs/codebase-map/index.md` 路由 + settings/agent 相关分域文件（上一轮 v2 同步过，本轮核对增量：提示词统一、skillsOverride、场景页行结构、browser 单开关）

## 计划改动
- [ ] 目验清单：场景页六行（主会话扩展只剩 code-workflow 可展开；临时会话无 workspace-rules 格子；子会话/定时任务扩展区是说明+跳转；状态抽取/文章解析提示词全文富渲染且卡片大气）；Profile 编辑器 browser 单开关；定时任务编辑页 skill 选择保存后重开回显；任务执行（可造一个测试任务）提示词为统一模板（人工 UI 目验，主会话另行安排给用户执行）
- [x] 文案终检：全页面无「裁决/回落/机制级/装配」类术语残留（代码语境词不出现在面向用户文案）
- [x] doc-sync：更新 codebase-map 对应分域文件与 index
- [x] git 提交（按 step 拆分或合并为一笔，message 说清 8 点修正）（主会话统一执行）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 文案终检：修正 4 处面向用户文案的「装配」（ability-scene.ts 三处 + SceneTab 徽标「未装配」→「没装上」同步注释）；grep 复查 app/settings/scene/、app/data-center/scheduler/、ability-scene.ts，其余命中均在代码注释（按约定不动），面向用户字符串已无四术语残留
  - doc-sync：更新 agent-core.md（skill-loader loadAllSkillEntries、ability-scene 七行新结构、task-queue 统一提示词+skillsOverride、custom-agent-task 挂载段）、settings.md（scene/ 行新结构、SubAgentTab browser 单开关、注意事项行数口径）、data-center.md（CustomSkillsSection、sanitizeSkillsOverride、buildMountedSkillsSection、task-executor 透传）三份分域文件；index.md 路由结构无变化未动
  - 目验清单为人工 UI 目验，不由本步执行（主会话另行安排给用户）
- 改动文件清单：
  - electron/main/tipc/ability-scene.ts（3 处文案）
  - app/settings/scene/SceneTab.tsx（徽标文案+注释）
  - docs/codebase-map/agent-core.md / settings.md / data-center.md
  - docs/plans/2026-10/2026-10-01/scene-v2-walkthrough-fixes/step5-wrapup.md（本回填）
- 验证：`bun run build:electron` 通过；`npx tsc --noEmit -p tsconfig.json` 通过

### 给下一步的接力棒
- 无后续 step，场景 v2 走查修正计划实施项全部完成
- 待办：本轮收尾改动（文案 + codebase-map + 本回填）由主会话统一 commit；目验清单交用户人工执行
