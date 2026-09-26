---
step: 8
title: 收尾验证与文档同步
status: pending
---

## 目标
全量回归验证、代码地图同步、完成总结。

## 依赖上下文（接力棒输入）
- 前置：Step 1-7 全部完成，各 step 实施回填已写
- 调研报告遗留核对项：兼容报告「未完成/跳过」中的 skills-lock.json 未核对（如 Step 2/3 遇到相关内容顺手处理）；plan-store builtin 的 worker 侧引用确认（Step 3 E 项执行时应已做，此处复查）

## 计划改动

- [ ] 全量验证：`bun run lint` + 双侧 tsc + `bun test` 全绿
- [ ] 启动完整冒烟：主会话对话 / 子会话派遣 / 文章库解析微信文章 / 股票工具 / 飞书 bot / 话题状态卡 / 调度器 / 设置保存
- [ ] 复盘行数：重新跑 300+ 行统计，对照清理前后（预期 TOP 从 1486 降至 ~900 以内，300+ 文件数明显下降），记入完成总结
- [ ] **代码地图同步**（doc-sync skill）：微信功能删除、article-service 拆目录、agent-worker tasks/、pi-session tool-assembly、window-factories、workspace-explorer/ 等结构变化全部反映到 docs/codebase-map/；顺带修正地图中已过时的 triggerByConversation / manualTaskDone 标注
- [ ] plan.md 末尾写「完成总结」：实际改动汇总、与原计划偏差、清理效果数据（删了多少行/文件）
- [ ] git log 检查 8 个 commit 完整，最后 `dogear__GitCommit` 确认无未提交残留

## 实施回填（做完后填）
（待执行会话填写）
