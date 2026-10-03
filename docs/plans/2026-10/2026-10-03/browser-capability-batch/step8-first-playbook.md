---
step: 8
title: 首个策略模板 + doc-sync 收尾
status: pending
---

## 目标

把小红书调研打法写成首个策略模板 skill（要点式），验证自动匹配触发；doc-sync 同步代码地图；批次收尾。

## 依赖上下文（接力棒输入）

- 模板机制（设计文档拍板）：自定义 skill 存 config 目录 `skills/`（`C:\Users\Dreama\AppData\Roaming\dogear\.dogear\skills\`，现空）；skill-loader 三目录索引自动进系统提示，description 匹配自动触发 + 显式点名必命中
- 写法（用户拍板）：**要点式**——控制流要点（外层循环/内层预算自适应/异常分支/终止条件），不写死操作序列；结构知识引用站点档案（`site_knowledge` 工具现读），不复制进模板
- 迭代漏斗：模板本体人工/主会话维护；现场发现走 `site_finding` 追加站点档案（agent 可写）
- 原料：小红书 P2 实施的打法提示词（`docs/plans/2026-09/2026-09-06/browser-p2-xhs/`）、两层站点档案（工作区层 xiaohongshu.com.md 正式地图含数据路径/直链拼法；全局层含扩展通道 read_state 路径）
- 骨架示例见设计文档「策略模板」节

## 计划改动

- [ ] 写 `skills/xiaohongshu-research/SKILL.md`：frontmatter（name/description 触发场景：调研小红书笔记/搜索用户讨论/找种草内容）+ 正文（流程骨架要点 + 关键坑引用「先调 site_knowledge 取小红书档案」+ 节奏预算提示 + 终止条件）
- [ ] description 写法兼顾自动匹配关键词覆盖（小红书/种草/笔记/用户讨论）
- [ ] 验证：新开会话说「帮我调研小红书上关于 X 的讨论」，确认 skill 索引出现且自动命中（或至少显式点名可加载）
- [ ] doc-sync：本批次新增工具（wait_for/readArticle/extension screenshot）、read 图片能力、注入扫描层进代码地图
- [ ] 批次完成总结回填 plan.md

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 模板清单与触发验证结果：
