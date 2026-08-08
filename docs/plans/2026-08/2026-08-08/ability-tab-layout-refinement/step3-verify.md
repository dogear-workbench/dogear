---
step: 3
title: 验证与收尾
status: pending
---

## 目标

确保 lint/build 通过，运行时基本检查无崩溃。

## 依赖上下文（接力棒输入）

- Step 1 + Step 2 均已完成
- ToolDef 有 shortDescription，前端 AbilityTab 已重构

## 计划改动

- [ ] `bun run lint` 通过
- [ ] `bun run build:electron` 通过（主进程改动）
- [ ] `bun run build:renderer` 或 `bun run dev:renderer` 通过（前端改动）
- [ ] 手动检查：设置页能力 Tab 打开不崩溃，工具列表平铺正常，点击工具弹浮窗正常，Skill 分类无 cross-session-review 在自定义

## 实施回填（做完后填）

### 实际改动
（待填）

### 完成总结
（待填）
