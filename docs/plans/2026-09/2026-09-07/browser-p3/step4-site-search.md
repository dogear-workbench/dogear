---
step: 4
title: B reddit/zhihu 站内搜索引擎
status: done
---

## 目标

`dogear__browser__search` 加可选 `site` 参数：reddit（old.reddit 静态解析，带 score/评论数/subreddit）与 zhihu（搜索页解析，带作者/赞同数）；站内失败自动降级 `site:域名` 通用链。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：`electron/main/agents/tools/browser-tools.ts:390` search 工具签名 `(query, maxResults?)`，engine 读 `settings.browserSearchEngine`；`electron/main/services/browser/browser-search-service.ts` 现有引擎编排（auto/降级链）+ SERP 解析器 + `degradations` 返回结构
- `browser-manager.ts` 的 PAC 分流域现含 google/ddg 系（`.google.com / .googleusercontent.com / .gstatic.com / .googleapis.com / .ggpht.com / duckduckgo.com`），reddit 系域名同待遇追加
- 关键决策回顾：reddit/zhihu 走受控浏览器（公开内容，不碰扩展通道、不加 SitePolicy）；不传 site 完全向后兼容；降级丢互动量但保可用，原因进 degradations

## 计划改动

- [ ] `electron/main/services/browser/browser-search-service.ts`：
  - `searchWeb` 签名加 `site?: 'reddit' | 'zhihu'`；有 site 走站内引擎分支，失败降级为 `{query} site:{domain}` 喂现有通用链，`degradations` 记原因
  - reddit 引擎：`https://old.reddit.com/search?q={query}&sort=top&t=year`（实施时可调 relevance/top，回填记录），静态 HTML 解析（选择器以实际 DOM 为准宽松匹配），结果元数据 `score / comments / subreddit / age`
  - zhihu 引擎：`https://www.zhihu.com/search?q={query}&type=content`，渲染等待后优先读页面 `__INITIAL_STATE__`（受控浏览器侧用 `new Function('return () => ...')()` evaluate 先例，见记忆 playwright-evaluate-no-dom-lib），DOM 卡片兜底；元数据 `author / votes`（页面给什么取什么，取不到不硬造）
  - 站内结果统一 `{rank, title, url, snippet, meta?}`，meta 为站点专属一行文本
- [ ] `electron/main/services/browser/browser-manager.ts`：PAC 分流域加 `.reddit.com / .redditstatic.com / .redd.it`（知乎直连不加）
- [ ] `electron/main/agents/tools/browser-tools.ts`：search 工具 zod 加 `site: z.enum(['reddit','zhihu']).optional()`，描述写明「需要站内互动量排序（高赞/高票）时用它；不传走通用引擎」；结果文本带 meta 行
- [ ] `resources/browser-eval/`：mock 站内 SERP 页 ×2（file:// + `<meta charset="utf-8">`）+ 解析断言 + `run-agent.mjs` 加 site search 任务
- [ ] `bun run build:electron` + `node resources/browser-eval/run-pipeline.mjs` 全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **重大发现：patchright(1.62.3) 的 page.evaluate 落在隔离世界，读不到页面脚本写入的 window 全局**（file:// 与 http:// 均复现；document 共享所以 DOM 解析不受影响）。知乎 `__INITIAL_STATE__` 若按常规 page.evaluate 读永远拿不到。已在 `site-search.ts` 的 readZhihuState 改用 **CDP Runtime.evaluate 直连主世界**（expression 用 `(${fn.toString()})()`，returnByValue 取值，含 WHY 注释）；CDP 原生会话枚举确认主世界（default context）里页面全局可见。mock 里内联脚本设 state 的写法因此可行
  2. mock 页 ×2 → **×3**：知乎拆成 state 版（serp-zhihu-state.html，仅 `__INITIAL_STATE__`、无 DOM 卡片）与 DOM 兑底版（serp-zhihu-dom.html，无 state），两条数据路径分别断言；另有 reddit 版。注意 mock 页相对链接在 file:// 下会解析为 file:// 被协议过滤器剔除，必须写绝对 https URL
  3. run-agent.mjs 本体零改动：site search 任务直接加在 tasks.json（runner 本就从 tasks.json 读任务）
  4. reddit 搜索参数维持 `sort=top&t=year`（目标即互动量排序）
  5. `SearchSerpUrls` 增加 reddit/zhihu 覆盖键（mock URL 注入的现成通道，计划未列但必要）；结果统一结构 `{rank,title,url,snippet,meta?}`，meta 站点专属一行文本（缺失不硬造）
  6. 新建 `site-search.ts`（142 行）承载 SITE_SEARCH_CONFIG + runSiteAttempt（含 zhihu 渲染等待、state 优先、DOM 兑底），避免 browser-search-service.ts 膨胀
- 改动文件清单：
  - `electron/main/services/browser/site-search.ts`（新建：SiteSearchId/SITE_SEARCH_CONFIG/runSiteAttempt/readZhihuState-CDP）
  - `electron/main/services/browser/serp-parsers.ts`（ParsedSerpItem 加 meta?；新增 parseRedditSerp / parseZhihuSerp / extractZhihuStateCards，均宽松匹配+去重）
  - `electron/main/services/browser/browser-search-service.ts`（SearchWebOptions.site；SearchTarget = SearchEngineId | SiteSearchId；SearchOutcome.engine/SearchDegradation.from/to 拓宽；site 分支：站内尝试→失败降级 `{query} site:{domain}` 喂现有链，degradations 记录站点→引擎；降级后 outcome.query 反映实际搜索词）
  - `electron/main/services/browser/browser-manager.ts`（PAC_PROXY_DOMAINS 加 .reddit.com/.redditstatic.com/.redd.it；知乎直连未加）
  - `electron/main/agents/tools/browser-tools.ts`（search 工具 zod 加 site enum；描述写明站内互动量排序用途；结果行带 meta；SEARCH_ENGINE_LABELS 加 reddit/zhihu）
  - `resources/browser-eval/serp-reddit.html / serp-zhihu-state.html / serp-zhihu-dom.html`（新建，均带 `<meta charset="utf-8">`）
  - `resources/browser-eval/run-pipeline.mjs`（+5 site 用例：reddit 解析含 meta 断言 / zhihu state 路径 / zhihu DOM 兑底 / 站内解析空降级 site: / 站内导航失败降级；startSerpServer 加 /hang/ 挂起路由）
  - `resources/browser-eval/tasks.json`（+search-agent-site-reddit / search-agent-site-zhihu 两个基线采集任务，notes 说明）

### 验证记录
- `bun run build:electron` 通过；`node resources/browser-eval/run-pipeline.mjs` **25/25 PASS**（含 5 个新 site 用例，zhihu-state 8.3s 是 waitForSelector 8s 等待、navfail 15s 是 goto 超时，均为预期成本）
- 全部既有冒烟无回归：site-policy 45 PASS / extension-ownership 18 PASS / observe-href 9 PASS / stale-protocol / nm-navigate / nm-protocol / nm-read-state / nav-tracker / profile-migration 全过
- `bun test`：285 pass / 1 skip / **0 fail**（286 tests，与基线一致）；`bun run lint`：0 errors（99 warnings 均既有）

### 给下一步的接力棒
- **step5 真机验收 B 段**：reddit（需 Clash 存活）出带 score 结果；关 Clash 重试 → 降级 site:reddit.com 通用链 + degradations 提示；zhihu 直连出结果。真机注意观察动作流命中哪条路径：detail「知乎状态数据解析成功」= state 路径，「解析成功」= DOM 兑底
- old.reddit 选择器按经典版式宽松匹配（div.search-result-link / a.search-title / .search-result-body / .search-score / .search-comments / a.search-subreddit-link / time[title]），真机若有出入只需调 serp-parsers.ts 的 parseRedditSerp；zhihu DOM 按 ContentItem 体系写（.SearchResult-Card / .ContentItem-title a / .AuthorInfo-name / meta[itemprop=upvoteCount] / .VoteButton--up），新版哈希类名需真机探后回填
- zhihu state walk 是通用启发式：收集 type ∈ {answer,article,post,zvideo} 且有 title 且可派生 URL 的卡片（question 包装 objectType=search_result 或裸对象均识别），深度≤8、节点≤20000、卡片≤50、URL 去重；真实知乎字段若命名不同，调 extractZhihuStateCards 谓词即可
- SearchSerpUrls 现含 5 键（google/ddg/bing/reddit/zhihu），是 site 引擎测试注入 mock 的现成通道；`searchWeb` 降级后 outcome.query 为 `{原词} site:{domain}`，工具层直接透出
- 遗留已知点：连接拒绝类导航失败（chrome-error 页提交）会污染紧随的下一跳 goto（“interrupted by another navigation”），生产上表现为链尾 nav_failed 整体失败，agent 重试即可恢复；冒烟里用 /hang/ 超时路由规避了这个不确定竞争

### 待办或已知限制
- reddit 真机依赖 Clash 存活（PAC 已分流）；zhihu 直连；真机实测全部留 step5
- patchright 升级后需复测 readZhihuState 的 CDP 路径与 page.evaluate 世界行为（若官方修复 evaluate 世界归属，可退回 page.evaluate）
