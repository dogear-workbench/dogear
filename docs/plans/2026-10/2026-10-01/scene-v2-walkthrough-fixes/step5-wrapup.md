---
step: 5
title: 收尾
status: pending
---

## 目标
全链路目验、codebase-map 同步、按 step 粒度补齐提交。

## 依赖上下文（接力棒输入）
- 前置 step1-4 回填的接力棒（各自改动文件清单）
- codebase-map：`docs/codebase-map/index.md` 路由 + settings/agent 相关分域文件（上一轮 v2 同步过，本轮核对增量：提示词统一、skillsOverride、场景页行结构、browser 单开关）

## 计划改动
- [ ] 目验清单：场景页六行（主会话扩展只剩 code-workflow 可展开；临时会话无 workspace-rules 格子；子会话/定时任务扩展区是说明+跳转；状态抽取/文章解析提示词全文富渲染且卡片大气）；Profile 编辑器 browser 单开关；定时任务编辑页 skill 选择保存后重开回显；任务执行（可造一个测试任务）提示词为统一模板
- [ ] 文案终检：全页面无「裁决/回落/机制级/装配」类术语残留（代码语境词不出现在面向用户文案）
- [ ] doc-sync：更新 codebase-map 对应分域文件与 index
- [ ] git 提交（按 step 拆分或合并为一笔，message 说清 8 点修正）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
