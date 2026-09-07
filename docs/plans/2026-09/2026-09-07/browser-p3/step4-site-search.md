---
step: 4
title: B reddit/zhihu 站内搜索引擎
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：（reddit 需 Clash 存活；真机实测留 step5）
