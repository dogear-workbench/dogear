---
step: 1
title: B 段收口——zhihu 复测诊断修复 + reddit/降级链验收
status: done
---

## 目标

定位并修复 zhihu 站内搜索解析失败（P3 验收不通过项），跑完 reddit 站内与关 Clash 降级链验证，B 段验收收口。

## 依赖上下文（接力棒输入）

- 前置事实（2026-09-08 真机验收）：`search('装修避坑', {site:'zhihu'})` 站内两条路径（state/DOM）均「解析为空」，随后 Google→DDG→Bing 三级降级（Clash 确认开着，代理不是解释）；受控浏览器窗口已被关掉，失败时页面状态未观察到
- 当前关键文件状态：`electron/main/services/browser/serp-parsers.ts`（或 serp-parsers/ 目录）含 zhihu 解析器（state walk 通用启发式 + DOM 兜底）；`browser-search-service.ts` 内站内引擎与降级链
- 关键决策回顾：P3 已知限制明确「知乎 state walk 是通用启发式待真机微调」——本步就是真机微调

## 计划改动

- [ ] 复测诊断（需用户配合，受控浏览器会重新启动）：派子会话跑 `search('装修避坑', {site:'zhihu'})`，同时观察受控浏览器窗口停留页面。决策树：
  - 停在**验证页/滑块** → 不是 parser bug：让用户人工过一次验证（profile 会记住）后复测；若过验证后站内解析成功则记录为环境因素，parser 不改，但把「知乎可能弹验证页，提示人工过一次」写进降级文案/工具描述
  - 停在**正常结果页**但解析为空 → parser bug：按实际 DOM/state 结构修 zhihu 解析器（state 路径优先，DOM 选择器兜底），加 eval 冒烟用例（mock 页面带 `<meta charset="utf-8">`）
- [ ] reddit 站内验收：`search('renovation mistakes', {site:'reddit'})`（Clash 开）→ 应出带 score/评论数/subreddit 的结果，记录样例
- [ ] 降级链验收：用户关 Clash → 重跑 reddit 站内 → 应降级 `site:reddit.com` 通用链 + degradations 记录 → 用户开回 Clash
- [ ] 附带记录：Bing 降级后 site: 过滤弱（8 条仅 2 条知乎）——评估是否在降级结果后加域名过滤兜底（仅过滤明显非目标域结果），或记录为已知限制

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - zhihu 走了决策树的「环境因素」分支：根因是**未登录软登录墙**（页面正常框架 + 结果区「未搜索到相关内容」+ 登录弹窗，服务端置空结果），parser 两条路径无 bug 未改；把登录提示写进降级文案 + search 工具描述
  - reddit 同为**未登录硬登录墙**（302 → old.reddit.com/login/?reason=lor2；另有 ERR_ABORTED 形态，URL 判据不命中时保守归网络异常不误报）
  - Bing site: 过滤：评估后**实施**（cn.bing.com 完全无视 site:，实测 8 条 0 条目标域；Google/DDG 环境均挂时 Bing 是唯一引擎）——精确 host 匹配含子域、仅站内降级态生效、过滤后为空诚实失败
  - **超出预期的发现**：Google 引擎也 parse_empty（div.g 选择器失效，新容器 #rso > div.MjjYud；标题链接 href 全部换成加密 /goto?url= 混淆串，无可靠 URL 方案）——本步不修，勘察数据在共享区 step1-delivery.md 接力棒段，修复需先做 URL 方案决策
  - 关 Clash 降级链验收：无人值守跳过，待用户配合
- 改动文件清单：`site-search.ts`（refineEmptyReason 空态/登录检测）、`browser-search-service.ts`（urlMatchesDomain + siteDomainFilter 站内降级态域名过滤）、`browser-tools.ts`（search 工具描述 +1 行登录态提示）、`resources/browser-eval/serp-bing-site-mixed.html`（新 mock）、`run-pipeline.mjs`（改 2 + 新增 2 用例）

### 给下一步的接力棒
- 关键签名 / 数据结构：`refineEmptyReason(site, page, label)`（site-search.ts）；`urlMatchesDomain(url, domain)`（browser-search-service.ts）；过滤由 searchWeb 内 siteDomainFilter 非空触发，普通搜索零影响
- 下个 step 该从哪里继续：Step 2 site-knowledge-service（与 Step 1 无依赖）
- 待办或已知限制：
  - 待用户配合：重启 app 生效新主进程代码 → 受控浏览器窗口人工登录知乎/Reddit 各一次 → 复测站内路径（B 段真闭环）→ 关/开 Clash 降级链验收 → DDG bot 挑战页可人工过一次
  - Google parser 修复决策（URL 加密死结，可选：挖页面 JS 内部状态 / 接受不可用调整引擎链优先级）——独立于本计划，未排期
  - 验证：lint 0 errors；build:electron 通过；node run-pipeline 27/27 PASS；真机复测 node 直调 dist searchWeb：zhihu 新文案 + 过滤 8→2 条知乎域 ✓，reddit 过滤后无匹配诚实失败 ✓
