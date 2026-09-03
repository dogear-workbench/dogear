---
step: 2
title: readArticle 核心服务
status: done
---

## 目标

`browser-article-service.ts`：浏览器渲染 + 展开启发式 + 登录墙检测 + 渲染后 DOM 走 Readability 出 markdown 落盘。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] BrowserManager 就绪，`acquire(taskMeta)` 签名与队列语义
- 当前关键文件状态：`article-service.ts` 的 `fetchAndParseArticle`（约 320 行起）后半段是「linkedom DOM → Readability → Turndown → meta 组装」管线，其中含 hidden 样式清理、懒加载图片 src 修复、相对路径图片转绝对
- 关键决策：渲染后 HTML 拿回 Node 侧跑 Readability（复用现有管线，不向页面注入 readability 脚本）；微信短内容正则 hack 在浏览器渲染后大概率不再需要，但保留管线兼容

## 计划改动

- [ ] `article-service.ts` 小重构：把 `fetchAndParseArticle` 的「DOM 预处理 + Readability + Turndown + 结果组装」抽成可导出纯函数（输入 document 或 html + url，输出解析结果或抛错），原函数行为不变仍走 linkedom
- [ ] 新建 `electron/main/services/browser/browser-article-service.ts`：
  - `readArticleWithBrowser(url): Promise<{ ok: true, meta } | { ok: false, errorClass, message }>`，errorClass ∈ `need_login | timeout | parse_empty | browser_crash`
  - 流程：acquire → `goto(url, waitUntil: 'domcontentloaded')` → 网络空闲/正文出现等待策略（轮询正文容器字数，上限 15s）→ 登录墙检测 → 展开启发式 → `page.content()` → 喂重构后的解析纯函数 → `saveArticle`（parseStatus `fixed`）
  - 登录墙检测：URL 跳转到已知登录 pattern（如 `passport.*`、`/login`、`accounts.*`）或 DOM 出现密码输入框 + 正文容器缺失；命中时调 `BrowserManager.bringToFront()` 并返回 `need_login`（前端流程在 step3 接）
  - 展开启发式：白名单文本匹配（展开/全文/更多/阅读全文/继续阅读/下一页），候选按钮点击后比较正文容器字数，变长才保留、最多点 3 个候选；结果不变长则放弃并在 meta excerpt 附 quality 提示
  - 每个动作点（navigate/click/wait/parse）发轻量事件回调 `onAction`（step5 的动作流数据源，本步先接 console/debug）
- [ ] 解析后空结果：沿用 `trimmedTextLength > 100` 阈值逻辑，低于阈值返回 `parse_empty`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. evaluate 脚本用 `new Function` 构造函数对象而非内联箭头函数：主进程 tsconfig 无 DOM lib（内联函数编译报错），且实测此 Playwright 版本字符串形式 evaluate 返回值不回传，`new Function` 是同时满足两者的唯一方式
  2. 正文测量用 `innerText` 而非 `textContent`：textContent 含 display:none 隐藏文本，展开前后不变会导致展开检测永远失效（实测踩坑）
  3. 计划里「喂解析纯函数 → saveArticle 落盘」的落盘部分不在本 step：按主会话拆分，readArticleWithBrowser 只返回 meta+content，落盘由 step3 编排层做
  4. meta 额外增加可选字段 `qualityHint`（计划只要求 excerpt 附提示）：给 step3 一个结构化信号，可映射 parseStatus `quality_warning`
- 改动文件清单：
  - `electron/main/services/article-service.ts`：抽出 `parseArticleDocument` / `parseArticleHtml` 纯函数 + `ParsedArticleData` 接口；`fetchAndParseArticle` 改为调用纯函数，行为不变
  - `electron/main/services/browser/browser-article-service.ts`：新增，readArticleWithBrowser + 渲染等待 + 登录墙检测 + 展开启发式 + onAction 事件
- 验证：build:electron ✅ / lint ✅（改动文件 0 告警）/ 运行验证 7/7 通过（正常解析+真实展开、伪展开→qualityHint、登录墙→need_login、parse_empty，临时脚本已删）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `readArticleWithBrowser(url, options?): Promise<ReadArticleResult>`，options = `{ taskMeta?, onAction? }`；成功返回 `{ ok: true, meta: BrowserArticleMeta }`，meta 含 `url/title/author/siteName/excerpt/wordCount/language/content/qualityHint?`（比 ArticleMeta 少 id/fetchedAt/parseStatus，step3 组装 ArticleMeta 后 saveArticle）
  - 失败返回 `{ ok: false, errorClass: 'need_login'|'timeout'|'parse_empty'|'browser_crash', message }`，不 throw
  - onAction 事件：`{ taskMeta, action: 'navigate'|'wait'|'click'|'observe'|'parse', url?, detail?, result? }`；不传 onAction 时默认 console.debug
  - 解析纯函数：`parseArticleHtml(html, url): ParsedArticleData`（内部 linkedom）/ `parseArticleDocument({ document, rawHtml, url })`，解析失败 throw
  - 超时预算：任务级 60s（含 acquire 排队，从函数入口起算）；goto 25s；渲染等待轮询 15s；展开 15s；展开点击后等 2.5s 采样
- 下个 step 该从哪里继续：`tipc/article.ts` 编排在 Readability 静态失败后插入 readArticleWithBrowser，成功则组装 ArticleMeta（uuid/fetchedAt/parseStatus 'fixed'；有 qualityHint 建议落 quality_warning）+ saveArticle；need_login 走「窗口已置前 + 前端 toast/条目状态」流程
- 待办或已知限制：翻页拼接未做（待 step6 基线决定，展开白名单含「下一页」但点击后是替换非拼接）；「下一页」在部分站点会导航离开原文（长度比较跨页生效，保留最长页）；展开候选上限 5 个/最多点 3 个；URL 登录 pattern 仅覆盖 passport./accounts./login. 前缀与 /login|/signin|/sign-in|/auth 路径，真实站点跳转样本待补
