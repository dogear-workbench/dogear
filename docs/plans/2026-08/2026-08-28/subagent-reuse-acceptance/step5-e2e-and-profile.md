---
step: 5
title: 端到端验证 + Profile 手动调整
status: in_progress
---

## 目标

真实会话走查完整闭环，并完成用户 settings 的 Profile 调整（设计 §架构 C）。

## 依赖上下文（接力棒输入）

- Step 1-4 全部完成：机制 + 提示词已就位。
- 用户实际配置位置：`%APPDATA%/Dogear/.dogear/settings.json`（打包版）或项目 `.dogear/settings.json`（开发版），subAgent.profiles 数组。
- 当前 Profile 快照（2026-08-28 核对）：「默认」（实施，全工具 + memory，GLM-5.3-Flash）、「探索」（调研，禁 write/edit + reference + memory，GLM-5.3-Flash）、「股票」（停用）。

## 计划改动

- [x] settings 手动调整（用户操作或主会话代改）：
  - 「默认」：`enabledAbilities.reference: true`；description 补「实施完成后交付通知与摘要走共享区或正文」
  - 「探索」：description 补「交付默认在消息正文，复杂报告才写共享区」；article 开关用户定
  - 实施 Profile 模型档位是否提档：用户定（改 modelSelection.tier）
- [x] `bun run build:electron` 重编译，重启应用使主进程改动生效（编译已完成；重启待用户操作）
- [ ] e2e 走查（在真实主会话里逐项验证）：
  1. 派一个无 outputPath 的调研子会话（通讯型）→ 确认创建成功、契约无「交付路径」行
  2. 子会话正文交付 → 主会话收到 delivery + 自述
  3. 主会话追问 → 子会话已停机，确认自动调起 + 唤醒消息为追问原文
  4. 验收不合格场景 → 追问返工 → 再交付
  5. 重启应用 → ResumeSession 一个停机子会话 → 确认降级恢复成功
- [ ] 走查发现的问题回填到本文件与 plan.md 完成总结

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
