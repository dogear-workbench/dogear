---
step: 3
title: 详情页布局
status: pending
---

## 目标

skill 型详情页顶部压缩为两行、chips 中文化、右栏加宽左栏字号降档；规则详情页双编辑器改徽章切换。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-mount-matrix.md] 右栏已有加载矩阵区块
- 关键决策回顾：顶部第一行 = 返回 + 中文包名（去英文 key 后缀与类型徽标，徽标挪右栏）；第二行 = skill chips；包描述挪右栏顶部开关上方；左栏整体滚动；chips 显示 SKILL.md 首行标题、缺失显示 key 标灰；右栏 w-72 → 约 5:4；规则页徽章「工作区规则 / 全局规则」切换一次一个编辑器

## 计划改动

- [ ] `app/settings/ability/AbilityPackDetailPage.tsx`：顶部结构压缩两行；skill chips 数据源接 SKILL.md 首行标题（skillMetas 已含或经 IPC 补充）；描述挪右栏；左栏滚动容器调整；右栏宽度比例调整；类型徽标挪右栏
- [ ] `app/settings/ability/RulesPackDetailPage.tsx` / `RuleFileEditor.tsx`：双编辑器改徽章切换（一次渲染一个），编辑态逻辑不变
- [ ] 左栏 Markdown 字号降一档（SegmentBlock / SKILL.md 渲染处）
- [ ] bunx tsc --noEmit / lint / build 全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
