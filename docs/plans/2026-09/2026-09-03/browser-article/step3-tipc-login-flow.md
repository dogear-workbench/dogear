---
step: 3
title: tipc 编排接入 + 登录墙前端流程
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：登录完成自动检测未做（一期手动重试）
