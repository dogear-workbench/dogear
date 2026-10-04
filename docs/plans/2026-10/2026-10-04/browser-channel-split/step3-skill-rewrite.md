---
step: 3
title: browser-exploration 重写为双通道方法论
status: done
---

## 目标

SKILL.md 重写为通道无关的双通道并列方法论：通道选择原则（内嵌=无人值守+隔离；扩展=登录态+在场协作）+ 通用探索方法；通道细节下沉到各工具 description，避免与 skill 重复。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-pack-split.md] 方法论包 browser-methodology 已建立，skill 挂载联动已通
- 关键现状：
  - skill 位置：builtin skills 扫描目录下 `browser-exploration/SKILL.md`（Glob `**/browser-exploration/SKILL.md` 定位；2026-09-25 `ef3e1a2c` 曾重写为「内嵌为主」，本次改双通道并列）
  - 现有工具 description 已较完整（navigate/readArticle/observe_page 等均含通道语义指引）；site 三件套 description 含站点档案/策略引导
- 关键决策回顾：skill 只写方法论不写策略数值（数值在 site-policy 代码层，agent 经 site_policy 工具运行时读）；「skill 都可以是一样」——探索循环通道无关，通道差异在工具层。

## 计划改动

- [ ] SKILL.md 重写，结构建议：双通道定位与选择原则（对偶句：内嵌=无人值守+公开内容+环境隔离 / 扩展=登录态+在场协作+用户浏览器轻探索）→ 通用探索循环（observe→find/click→read，ref 代际失效重查，页面状态机应对）→ 站点档案与策略使用纪律（新站先 site_knowledge/site_policy）→ 何时停与移交
- [ ] 通道特有细节核对下沉：tab 生命周期（open/close/list、用完关）、独占模型、present 交付留在对应工具 description，skill 只在通道选择原则处提及
- [ ] 验证：读一遍与三份工具 description 无重复无冲突；dev 起浏览器解析子会话确认 skill 注入与格式渲染正常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① 原文「何时停与移交」落地为「何时停与交付」（内容实为停止 + 交付）；② 发现并修正旧文案与实现冲突：原「内嵌触发风控熔断可换扩展通道」与 site-policy 实现冲突（熔断按会话+域累计，同会话换通道同样被拒，且 site_policy instructions 明确不换通道规避），新版改为「熔断/预算耗尽即停不换通道规避」；③ WEB_RESEARCH_GUIDANCE 触发条件与内容表述两者都改（只改触发会误导扩展-only 子会话，只改内容会让扩展-only 会话缺快档指引）；④ dev 冒烟以静态检查替代（skill-service 扫描路径与 frontmatter 解析实际验证）；⑤ 主会话验收时顺手修正 step1 漏网的 browser-parse Profile description（settings-types.ts:394 旧叙事对齐前端镜像双通道表述，单行文案）。
- 改动文件清单：resources/skill-templates/browser-exploration/SKILL.md（全文重写四段：双通道定位与选择 / 通用探索循环 / 站点档案与访问策略 / 何时停与交付）；pi-session.ts（WEB_RESEARCH_GUIDANCE 触发 473/481 行加 browser-extension）；session-append-templates.ts（MAIN/SUB 版通道无关化 + 「浏览器通道独占」精确为「扩展通道全局独占」）；settings-types.ts（browser-parse description 对齐，主会话顺手）。

### 给下一步的接力棒
- 关键签名 / 数据结构：SKILL.md 现为双通道并列唯一事实源；WEB_RESEARCH_GUIDANCE 触发条件为三包任一（web-mcp / browser / browser-extension），新增浏览器类包时记得同步。
- 下个 step 该从哪里继续：step 4/5 tab 生命周期闭环时，「用完关」纪律随 tab 工具 description 落地（open_tab/close_tab 现只有上限与焦点语义）；SKILL.md 只在「定位与选择」层面动，通道行为细节改对应工具 description。
- 待办或已知限制：无阻塞项；扩展通道描述中「确认卡」与内嵌「等待人工卡片」并存属两侧各自正确，无需改。
