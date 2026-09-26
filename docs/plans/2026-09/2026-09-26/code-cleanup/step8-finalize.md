---
step: 8
title: 收尾验证与文档同步
status: done
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

## 实施回填（2026-09-26 完成）

- 全量验证：lint 0 errors（70 warnings 存量）、双侧 tsc 零错误、bun test 319 pass/0 fail/1 skip（1100 expect calls）、build:electron + vite build 通过
- 行数复盘：总变化 136 文件 +5284/-10440（净删 5156 行）；TS 文件 546→530；900+ 行巨型文件 9→2（pi-session 1486→1142、stock-analysis-tools 1143→1061，其余 7 个全部拆解）；300+ 文件 78→76（拆分产物中部分新文件仍超 300，但巨型文件清零）
- 代码地图同步：docs/codebase-map/ 9 文件 40 处变更（微信条目删净、已删文件零残留、article/ tasks/ tool-assembly/ window-factories/ workspace-explorer/ 等新结构全部补条目）；计划点名的 triggerByConversation/manualTaskDone 标注已不存在（代码早已统一 on_task_done），实际过时点 Trigger 八种→九种已修；顺带修 PARSE_ARTICLE 走 pi runOnce、plan-store version:2、group-context-builder 缺条目等
- git：8 个 refactor(cleanup) commit 完整（step2 拆两个：主提交 + package.json 补提交）
- 遗留：交互冒烟需用户日常使用验证（飞书 bot、文章解析链、多窗口、设置页保存等，见完成总结）

## 实施回填（做完后填）
（待执行会话填写）
