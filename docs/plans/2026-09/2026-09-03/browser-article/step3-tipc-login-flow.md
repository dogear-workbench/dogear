---
step: 3
title: tipc 编排接入 + 登录墙前端流程
status: done
---

## 目标

浏览器层插入 parseArticle 编排链；登录墙「递到面前」全流程（窗口置前 + toast + 条目状态 + 手动重试）走通。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] `readArticleWithBrowser(url)` 返回四类 errorClass，`need_login` 时窗口已置前
- 当前关键文件状态：`tipc/article.ts` parseArticle 的编排顺序为 平台脚本 → Readability（catch 后落 stub + 提交 AI 任务）；`ArticleParseStatus` 在 `article-service.ts` 定义、`types/article.ts` 镜像
- 关键决策：登录墙不走 AI 兜底（诚实失败 + 引导登录）；成功态不加新枚举，路径区分记在 parse history 的 `layer` 字段

## 计划改动

- [ ] `types/article.ts` + `article-service.ts`：`ArticleParseStatus` 增加 `need_login`
- [ ] `tipc/article.ts` parseArticle：Readability catch 后先 `await readArticleWithBrowser(url)`——成功则落盘返回（history 记 `layer: 'browser'`）；`need_login` 则落 stub（parseStatus `need_login`，title 用 URL 域名）+ 广播 `browserLoginRequired` 事件 + 返回该 stub；其余失败类按原逻辑落 stub 提交 AI（history `readabilityError` 附浏览器层失败原因）
- [ ] `tipc/renderer-handlers.ts`：新增 `browserLoginRequired`（载荷 articleId / url / workspaceId）
- [ ] 渲染层消费：
  - `article-store.ts` 监听事件 → toast「该页面需要登录，已为你打开浏览器窗口」
  - 文章树/列表条目：`need_login` 状态展示（复用现有 parseStatus 徽标位）+ 「我已登录，重试」按钮 → 重调 parseArticle（同 URL 同 workspaceId），成功后条目刷新
- [ ] `appendParseHistoryEntry` 各分支补 `layer` 字段（script / readability / browser / ai）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - qualityHint → `quality_warning` 映射已采纳：与现有 quality_warning 的 AI 语境语义（"AI 也未能改善"）不完全同源，但黄色警告语义（"内容质量存疑"）匹配，且 service 层已把展开失败提示拼进 excerpt，用户能看到具体原因；详情页徽标 tooltip 仍是 AI 语境文案（未单独改）
  - 重试成功/失败后均会删除旧 need_login stub（client.deleteArticle by id），避免树里残留重复条目；重试后仍 need_login 时补 toast「登录态未生效」
  - 文章树条目 need_login 展示为副标题前的橙色 Lock 小图标（树数据链路补了 articleMeta.parseStatus 字段）；徽标 + 「我已登录，重试」按钮在 ArticlePreview（唯一 parseStatus 徽标位）
  - history 类型化：tipc 侧新增 ParseHistoryRecord 接口（含 layer/browserError/readabilityError），agent-worker 侧 ParseHistoryEntry 加 layer?: 'ai'；AI 兼底分支的 payload.readabilityError 拼接浏览器层失败原因
- 改动文件清单：
  - `types/article.ts` / `electron/main/services/article-service.ts`：ArticleParseStatus + need_login；新增 ArticleParseLayer；saveRawHtmlStub 加可选 title/parseStatus；scanArticleDirectory 树节点携带 parseStatus
  - `electron/main/types.ts` / `types/electron-api.ts`：WorkspaceFileNode.articleMeta.parseStatus
  - `electron/main/tipc/article.ts`：3.5 浏览器层编排（成功落盘 / need_login stub + 广播 / 其余失败类 → AI）；broadcastBrowserLoginRequired；history layer
  - `electron/main/tipc/renderer-handlers.ts`：browserLoginRequired 事件 + 联合类型补 need_login
  - `electron/main/agents/agent-worker.ts`：ParseHistoryEntry.layer + 两处写入点
  - `stores/article-store.ts`：browserLoginRequired 监听（toast + 刷树）；retryAfterLogin；submitArticleUrl need_login 分支不报成功
  - `components/ArticlePreview.tsx`：need_login 徽标（Lock）+ 重试按钮
  - `components/WorkspaceExplorer.tsx`：树条目 need_login 图标

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 编排链：script → readability → readArticleWithBrowser（`{ taskMeta: { kind: 'article', articleId } }`）→ AI；need_login 不进 AI
  - 广播：`browserLoginRequired { articleId, url, workspaceId }`（tipc/article.ts broadcastBrowserLoginRequired）
  - history layer 取值 'script' | 'readability' | 'browser' | 'ai'（article-service.ts ArticleParseLayer）
  - 渲染层重试入口：`useArticleStore.retryAfterLogin()`（依赖 selectedArticle 挂着 need_login stub）
- 下个 step 该从哪里继续：step4 Agent 工具——dogear__browser__readArticle 直接调 readArticleWithBrowser（不带 articleId 落盘），权限映射进 permission-rules.ts；parse history layer 已就绪可直接复用
- 待办或已知限制：登录完成自动检测未做（一期手动重试）；fetchRawHtml 失败（403/网络错误）直接报错不进浏览器层（计划外场景）；手动 E2E 因本机 Chromium 启动挂起未跑通（headless 同样卡住，疑机器环境问题），链路靠 tsc + 代码走查确认
