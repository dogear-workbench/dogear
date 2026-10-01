---
step: 3
title: 收尾
status: done
---

## 目标
文案与场景页联动核查、codebase-map 同步、提交。

## 计划改动
- [x] 核查场景页定时任务行文案仍准确：groupNote「扩展工具包与 skill 在定时任务编辑页按任务配置」、reason「skill 挂载在定时任务编辑页按任务配置」等（装配语义未变，预期无需改；如发现不准确处一并修）
- [x] 核查编辑页周边文案（保存校验提示等）与新矩阵一致
- [x] codebase-map 同步：data-center.md（CustomAbilityMatrix 替换两组件）、agent-core.md（装配正常加载）相关段落
- [x] git 提交

## 实施回填（做完后填）

### 实际改动
- 与计划差异：data-center.md 由 step2 顺手同步，本步补 agent-core.md 两处（custom-agent-task 装配描述改正常加载、skill-loader 共用描述）；场景页 4 处「按任务配置」文案核查均准确无需改；编辑页周边文案无回归
- 改动文件清单：docs/codebase-map/agent-core.md、step3-wrapup.md、plan.md
- 提交：f55932bd（step1）/ ec435fe7（step2）/ 本步收尾

### 给下一步的接力棒
- 关键签名 / 数据结构：CustomAbilityMatrix({ toolPacksOverride, skillsOverride, onChange })；装配侧 loadAllSkillEntries().filter(Set.has) → formatSkillIndexForPrompt + createSkillTool
- 下个 step 该从哪里继续：无后续 step，计划完成
- 待办或已知限制：UI 目验清单见共享区 20261001-matrix-step2-delivery.md（9 条，前 6 条建议人工过）；新增 extension 包自动入矩阵但 PACK_NOTES 无文案时回退注册表 description
