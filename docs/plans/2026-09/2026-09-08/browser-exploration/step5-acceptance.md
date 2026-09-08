---
step: 5
title: 收口——全量回归 + 方法论真机实测 + P3 step5 勾选 + doc-sync
status: pending
---

## 目标

全量验证 + 新方法论真机实测 + P3 验收文档收口，本计划完成。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 B 段收口结果（zhihu 修复/降级链验收记录）；Step 2-4 站点档案全链路 + Profile 方法论
- 当前关键文件状态：`docs/plans/2026-09/2026-09-07/browser-p3/step5-acceptance.md` 真机清单大部分未勾选（A2+A3 与 A1 已于 2026-09-08 真机验证通过，待补勾选与证据标注）
- 关键决策回顾：真机实测风控红线沿用（滑块/验证码即停）；验证脚本 node 执行

## 计划改动

- [ ] 全量回归：`bun run lint` 0 errors；`tsc -p tsconfig.electron.json` 0 错误；`bun run build:electron` 通过；`bun test` 0 fail；node 跑 `resources/browser-eval/` 全部冒烟（含新增 site-knowledge / extension-site-tools / zhihu 修复用例）
- [ ] 方法论真机实测（**需用户在场**）：派一个浏览器解析子会话做小红书调研小任务（不给步骤剧本，只给目标，如「找 3 篇全屋定制避坑笔记，记标题/赞数/要点」），观察：① 是否先取站点档案 ② 页面偏离时是否自主恢复 ③ 是否用 site_finding 沉淀新发现 ④ 失败收敛行为。结果记录回本文件
- [ ] P3 收口：`2026-09-07/browser-p3/step5-acceptance.md` 真机清单勾选——A2（href）、A2+A3（详情可达 + 路径）、A1（busy + 空闲释放，2026-09-08 真机证据）、B（按 Step 1 实际结果）；「字段路径回填工具描述」改为「进首批站点档案」并注明设计变更；plan.md 补完成总结
- [ ] doc-sync：`docs/codebase-map.md` 补 site-knowledge-service / 新工具 / Profile 迁移条目

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
