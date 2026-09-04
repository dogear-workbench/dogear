---
step: 3
title: 轻反爬前移（fetch 白名单分流进浏览器层）
status: done
---

## 目标

`fetchRawHtml` 失败时按错误类型分流：轻反爬（403/429/503/超时/连接重置）直接进浏览器层（真实浏览器指纹可过），其余诚实报错；浏览器也失败不走 AI 兜底。

## 依赖上下文（接力棒输入）

- 现状：`tipc/article.ts:159-165` fetchRawHtml 抛错直接 `return { error: '抓取失败: ...' }`，浏览器层（3.5 编排）根本没机会
- 现有 3.5 编排入口：`readArticleWithBrowser(input.url, { taskMeta })`，返回 `{ ok, errorClass, ... }`，need_login 走人工流程（tipc/article.ts:228-318）
- 设计约束：白名单只认结构化错误字段；AI 兜底仅保留给「fetch 成功但格式怪异」路径

## 计划改动

- [ ] `article-service.ts` fetchRawHtml：抛 `FetchError`（class 或含判别字段的对象），携带 `status?: number` 与 `code?: string`（ECONNRESET / ETIMEDOUT / ENOTFOUND / CERT 等）；HTTP 非 2xx 与网络异常都走它
- [ ] `tipc/article.ts` parseArticle：catch 后判断——白名单（403/429/503/超时类 code/ECONNRESET）→ 跳过平台脚本与 Readability，直接进浏览器层编排（成功落盘 layer:browser、need_login 走人工、其余失败 `return { error }` 不建 stub 不提 AI）；非白名单 → 现状 return error（错误信息含结构化字段摘要）
- [ ] parse history：分流路径补记录（fetch_fail_browser / fetch_fail）
- [ ] 测试：browser-eval 增加 mock 反爬任务（本地 http server 返回 403，断言走浏览器层成功）或以最小 mock 验证分流逻辑；现有 9 任务回归不破

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `saveArticle` / `saveRawHtmlStub` 的 `rawHtml` 改为可选（分流路径无预取 HTML，不写 raw.html）；现有调用方均传 rawHtml，行为不变
  - `fetchAndParseArticle` 内部 fetch 分支改为复用 `fetchRawHtml`，错误同样结构化（当前唯一调用方总传 rawHtml，该分支不可达，仅保持一致）
  - 非白名单 fetch 失败也记 history（layer: fetch_fail，含 fetchError 摘要），计划未明说但利于统计
- 改动文件清单：
  - `electron/main/services/article-service.ts`：`FetchError` class（status?/code?）+ `isBrowserRetryableFetchError` 白名单判定（403/429/503；ECONNRESET/ETIMEDOUT/ECONNABORTED/UND_ERR_*_TIMEOUT）+ `fetchRawHtml` 结构化抛错 + `ArticleParseLayer` 扩展 `fetch_fail_browser`/`fetch_fail` + saveArticle/saveRawHtmlStub rawHtml 可选
  - `electron/main/tipc/article.ts`：抽出 `runBrowserArticleStage` 共用编排（成功落盘/need_login 人工流程，失败不记 history 由调用方决定后续）+ `parseArticleViaBrowserAfterFetchFail`（分流进浏览器层，失败 return error 不建 stub 不提 AI）+ `describeFetchError` 摘要；parse history 补 fetchError 字段
  - `resources/browser-eval/tasks.json`：新增 `antibot-pipeline-fallback`（type=antibot）
  - `resources/browser-eval/run-pipeline.mjs`：antibot 分支（本地 http server 对普通 fetch 返回 403、对真实浏览器导航 sec-fetch-mode=navigate 返回文章页；断言 FetchError 结构化/白名单命中/浏览器层救活/404 与 DENY 码不命中白名单）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `class FetchError extends Error { status?: number; code?: string }`；`isBrowserRetryableFetchError(err): boolean` 只认这两个字段，不解析错误字符串
  - `runBrowserArticleStage(params) → { kind: 'ok'|'need_login', article } | { kind: 'failed', errorClass, message }`；historyLayer 由调用方传 'browser' 或 'fetch_fail_browser'
  - 分流路径浏览器层成功时不写 raw.html（无预取 HTML）；need_login 走 broadcastBrowserLoginRequired 人工流程不变
- 下个 step 该从哪里继续：step4（子会话 browser 能力）；本 step 的分流判定可直接被 profile 能力层复用
- 待办或已知限制：
  - 白名单 code 集合覆盖 undici 超时族（UND_ERR_CONNECT/HEADERS/BODY_TIMEOUT）；若后续换 fetch 实现需重查错误码来源
  - fetch 白名单路径的编排顺序（跳过脚本/Readability）在 tipc 层，pipeline 只能用纯函数 + 浏览器层端到端验证，已覆盖核心路径
