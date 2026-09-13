---
step: 5
title: 整体验证与文档同步
status: pending
---

## 目标
全量构建通过 + 手动动线验证 + codebase-map 同步。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1-4 全部完成（接力棒见各 step 实施回填）
- 验证环境注意：用户跑的是打包版（configDir = `AppData/Roaming/Dogear/.dogear`），本地 `bun run dev` 是开发态（configDir = 项目 .dogear）——手动验证可在 dev 下做，或 build 后验证打包版

## 计划改动
- [ ] `bun run lint` + `bun run build:electron` 全绿
- [ ] 手动动线（dev 或打包版）：
  1. 设置页 → 子会话派遣 → 默认/浏览器解析 Profile 的能力域出现「联网搜索」且已勾；自定义 Profile 可勾选
  2. 设置页 → 能力 → 随便挑一个有 skill 的包（如股票分析）关→开总闸，检查包内 skill 与工具组细闸被自动补上（关总闸不动细闸）
  3. 新建主会话：系统提示词含「联网调研分工」段（工作区 web-mcp 已开必现）；工具列表 webSearch/webReader 描述的 fallback 指引正确（当前工作区 browser 细闸未开时应为「派浏览器解析子会话」文案）
  4. 派默认 Profile 子会话问一个需要联网的问题，确认它能调 webSearch
  5. 数据中心 → 定时计划 → 任务编辑器工具区出现「浏览器」「联网搜索」可选
- [ ] `docs/codebase-map.md` 同步：ability-registry（web-mcp 细闸/去 mainOnly）、web-mcp-tools（fallbackHint 三态）、session-append-templates（新段）、pi-session（子会话挂载与段拼装）、scheduler 两文件、SubAgentTab/AbilityTab 行内描述

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
