---
step: 5
title: 收口——全量回归 + 方法论真机实测 + P3 step5 勾选 + doc-sync
status: done
---

## 目标

全量验证 + 新方法论真机实测 + P3 验收文档收口，本计划完成。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 B 段收口结果（zhihu 修复/降级链验收记录）；Step 2-4 站点档案全链路 + Profile 方法论
- 当前关键文件状态：`docs/plans/2026-09/2026-09-07/browser-p3/step5-acceptance.md` 真机清单大部分未勾选（A2+A3 与 A1 已于 2026-09-08 真机验证通过，待补勾选与证据标注）
- 关键决策回顾：真机实测风控红线沿用（滑块/验证码即停）；验证脚本 node 执行

## 计划改动

- [x] 全量回归：`bun run lint` 0 errors（99 warnings 存量）；`tsc -p tsconfig.electron.json` 0 错误；`bun run build:electron` 通过；`bun test` 285 pass + 1 skip / 0 fail；node 跑 `resources/browser-eval/` 全部冒烟 11 个全 PASS（site-policy 45 / extension-ownership 18 / observe-href 9 / nm-protocol 6 / nm-navigate 15 / nm-read-state 14 / nav-tracker 15 / stale-protocol 5 / profile-migration 11 / site-knowledge 26 / extension-site-tools 16）+ run-pipeline 27/27
- [ ] 方法论真机实测（**需用户在场**）：派一个浏览器解析子会话做小红书调研小任务（不给步骤剧本，只给目标，如「找 3 篇全屋定制避坑笔记，记标题/赞数/要点」），观察：① 是否先取站点档案 ② 页面偏离时是否自主恢复 ③ 是否用 site_finding 沉淀新发现 ④ 失败收敛行为。结果记录回本文件 —— **本次无人值守执行跳过，遗留待用户在场（见实施回填）**
- [x] P3 收口：`2026-09-07/browser-p3/step5-acceptance.md` 真机清单按 2026-09-08 真机验收事实勾选（A 段全过附证据；B 段登录墙环境因素部分完成；预算账本代码级核实 + 真机佐证）；「字段路径回填工具描述」已按本计划设计变更改为进站点档案并注明；plan.md 已补完成总结
- [x] doc-sync：`docs/codebase-map.md` 增量补丁（site-knowledge-service / extension-site-tools 新条目，extension-tools 8 工具 + navigate 指针 + acquireGate action=null + site 工具旁路 policyGate，browser-search-service 域名过滤兜底，site-search refineEmptyReason，browser-tools search 登录态提示，settings Profile 方法论 + 三旧值迁移，browser-eval 冒烟清单 + run-pipeline 27 + mock SERP 7 页，扩展链路 site 工具旁路）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：方法论真机实测需用户在场，本次无人值守执行跳过（唯一遗留）；其余全做。改动仅限 docs，未碰代码
- 改动文件清单：`2026-09-07/browser-p3/step5-acceptance.md`（真机清单勾选 + 实施回填）、`2026-09-07/browser-p3/plan.md`（完成总结待用户项收敛 + 已知限制补 Google parse_empty）、本计划 `plan.md`（Step 5 打勾 + 完成总结段）、`docs/codebase-map.md`（doc-sync 增量补丁）、本文件回填

### 给下一步的接力棒
- 关键签名 / 数据结构：无新增（本 step 纯文档收口）；上游关键签名见 step1-4 文档（refineEmptyReason / urlMatchesDomain / readSiteKnowledge / appendSiteFinding / siteKnowledgePointer / createSiteToolDefs）
- 下个 step 该从哪里继续：本计划已收口，无下个 step。遗留真机项（方法论实测 / 登录复测 / 关 Clash 降级链 / 重启 app）见 plan.md 完成总结「遗留待用户」段；未决问题（失败收敛 N=3 实战观察、Google 修复 URL 方案决策）待后续计划承接
- 待办或已知限制：DDG bot 挑战页需人工过一次；Google 引擎在自动化环境 parse_empty（div.g 失效 + /goto URL 加密）
