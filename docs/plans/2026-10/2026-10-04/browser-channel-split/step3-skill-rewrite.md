---
step: 3
title: browser-exploration 重写为双通道方法论
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
