---
step: 8
title: 首个策略模板 + doc-sync 收尾
status: done
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
  - 「两层站点档案」实情澄清：site-knowledge 是单文件单层（getConfigDir()/site-knowledge/），「两层」指档案内「正式地图/探索发现」两区块，模板按实际结构写，与迭代漏斗意图一致
  - 触发验证：子会话与主会话分别用 pi-agent-core loadSkills（skill-loader 同款解析链）实测索引命中（total 11，xhs hit 1，diagnostics 0）；新开会话自动命中留用户日常验证
  - doc-sync 由主会话按 doc-sync skill 完成：browser.md（extension-tools 新工具与拆分、site-policy 预算节奏、injection-scan 新行、扩展侧 wait-actions/content-extract）、agent-core.md（vision-shunt/content-blocks）、chat.md（图片附件三入口）、data-center.md（workspace-file-tools 锚点）；故意未记：两处 bug 修复（screenshot 空文件/click 误报）、manifest 版本号
- 改动文件清单：
  - 新：`C:\Users\Dreama\AppData\Roaming\dogear\.dogear\skills\xiaohongshu-research\SKILL.md`（config 目录，非工作区 git）
  - `docs/codebase-map/{browser,agent-core,chat,data-center}.md`

### 给下一步的接力棒
- 模板清单与触发验证结果：xiaohongshu-research 已进 skill 索引（关键词：小红书/xhs/种草/笔记/用户讨论/口碑/测评）；要点式结构：前置必调 site_knowledge → 外层关键词循环（宽→窄→同义，上限=搜索预算5）→ 内层预算自适应采样（read_state 直取优先）→ 节奏预算（工具层强制）→ 异常分支（风控熔断/登录墙/site_finding 沉淀）→ 终止三条件 → 产出格式
- 后续模板迭代：现场发现走 site_finding 追加档案探索发现区；模板本体人工/主会话维护
- 子会话实测踩坑记录：NodeExecutionEnv 反斜杠绝对路径会被剥离当相对路径拼 cwd，正斜杠正常（生产三目录索引一直正常，仅脚本验证时注意）
