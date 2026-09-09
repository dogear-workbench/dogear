---
step: 4
title: 抓取迁移
status: done
---

## 目标

searchWeb 与 readArticle 底层从 Patchright 切到内嵌宿主；SERP parser 降为快档，`parse_empty`/验证页返回 `pageAvailable + 恢复建议`，页面保留给 agent 用通用能力探索。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3] 内嵌宿主具备 navigate/等待/状态机/policyGate，签名从 step3 回填
- 现状代码：`browser-search-service.ts` 的 `searchWeb`（引擎降级链 Google→DDG→Bing、PAC 代理探测、`/sorry/` 验证页检测）、`serp-parsers.ts`、`browser-article-service.ts`（readArticle 声明式读文章）
- 关键决策回顾：降级语义是「页面还在，agent 请自己看」而非重试同一管线；`browser-tools.ts:400,430` 已有的降级提示文案在本步升级为结构化返回

## 计划改动

- [ ] `searchWeb` 内核改写：内嵌后台 tab 加载搜索 URL（复用持久 partition，Cookie 信誉积累）→ 加载就绪后取 HTML → SERP parser 快档解析
- [ ] 失败语义结构化：`parse_empty` / 验证页 / nav_failed 时返回 `{ ok: false, reason, pageAvailable: true, tabId, url, pageState, suggestedNextTools: ['dogear__browser__observe_page', 'dogear__browser__read_text'] }`，tab 不关闭
- [ ] 验证页处理平移：Google `/sorry/` → pageState=verification_required，等待用户在内嵌窗口人工过验证（窗口呈现能力本步可先依赖 Step 1 的 attach 接口临时挂主窗口，完整交互 Step 6）
- [ ] 引擎降级链保留（Google→DDG→Bing），降级判定沿用现有超时/解析空规则
- [ ] 代理支持：Patchright 的 PAC 代理配置迁移到内嵌 session（`session.setProxy`），probeProxyServer 保留
- [ ] `readArticle` 迁移：内嵌加载 + executeJavaScript 取 HTML + 现有 readability/turndown 链路不变；SPA 等待策略用 wait_for 文本出现
- [ ] 工具描述更新：search/readArticle 的 agent 描述改为「快档优先、失败自动告诉你页面在哪、用原子工具继续探索」
- [ ] Patchright 依赖本步起不再被 search/article 调用（browser-manager 仍存在，Step 6 删）

## 实施回填（做完后填）

### 实际改动

**新增**
- `embedded/fetch-page.ts`：内嵌抓取原语层——`evalInTab`（executeJavaScript 序列化 `(fn)(args)` 调用）、`loadFetchTab`（loadURL+超时竞速+waitTabReady，失败抛 `FetchNavError{url}`）、`getTabHtml`/`clickBySelector`（合成点击）/`closeFetchTab`/`promoteFetchTab`/`presentTabWindow`（挂主窗口）、`buildFetchFailure`、`FetchPageOps`+`createFetchPageOps`、`FetchFailureContext`
- `embedded/proxy.ts`：PAC_PROXY_DOMAINS + buildProxyPacUrl + applySessionProxy（session.setProxy pac_script，从 browser-manager 抽出共享）
- `browser-search-types.ts` / `browser-article-types.ts`：两服务类型拆分（SearchOutcome/ReadArticleResult 的 ok:false 分支新增 `failure?: FetchFailureContext`，Options 新增 `workspaceId`）
- `article-text.ts`（文本测量）/`article-expand-pager.ts`（展开/翻页启发式，逻辑平移 Page→FetchPageOps）

**重写**
- `browser-search-service.ts`：searchWeb 内嵌化——ensureWorkspaceProxy → site attempt → 引擎链循环（navigateGate → openTab/loadFetchTab → resolvePageState → evalInTab 就地跑 SERP parser → site: 域过滤）；成功 close 自己开的 tab，全链失败 promote+结构化 failure；验证页立即挂主窗口；probeProxyServer/buildEngineChain 保留
- `site-search.ts`：runSiteAttempt 内嵌化（ensureTab 注入、知乎 __INITIAL_STATE__ 主世界直读+渲染轮询、FetchNavError.url 判定 Reddit 登录跳转）
- `browser-article-service.ts`：readArticleWithBrowser 内嵌化（openTab+loadFetchTab → FetchPageOps → 渲染等待/登录墙含 DOM 密码框检测/pager/expand → Readability 管线不变；need_login 挂窗口，失败结构化 failure）
- `dev-selftest.ts`：+fetchSmoke（search 成功 cn.bing / parse_empty 结构化返回 / readArticle 冒烟 iana.org）

**修改**
- `embedded-browser-manager.ts`：+promoteToAgentTab、+ensureWorkspaceProxy、openTab+skipInitialLoad
- `embedded/types.ts`：OpenEmbeddedTabInput+skipInitialLoad；`embedded/navigate.ts`：waitReady 导出为 waitTabReady(+timeoutMs)
- `browser-manager.ts`：PAC 逻辑改 import embedded/proxy
- `browser-tool-shared.ts`：+formatFetchFailure（统一失败文案：页面保留位置+pageStateHint+下一步工具引导）
- `browser-tools.ts`：readArticle/search 消费 failure、传 workspaceId、描述改「快档优先、失败附页面位置、原子工具继续探索」
- `tipc/article.ts`：readArticleWithBrowser 传 workspaceId

### 关键坑（evalInTab 调用括号）

初版 evalInTab 无参时拼出 `(() => {...})`（缺调用括号），executeJavaScript 求值结果是**函数对象本身**→ 结构化克隆失败「An object could not be cloned」。有 arg 的调用形态 `(fn)({...})` 能跑通，无参的 SERP parser 全踩。修复：code 恒为 `(fn)(args)` 形态。定位过程：探针二分（同一 parser 对象直调成功/evalInTab 失败）锁定调用路径差异。

### 自测结果

DOGEAR_EMBEDDED_BROWSER_SELFTEST=1：Step 3 操作链路 12 项 ✓ + search 成功链路（cn.bing 3 条）✓ + parse_empty 结构化返回（ddg→bing 降级、failure 完整、tab 保留+promote 断言）✓ + readArticle 冒烟（iana.org 763 字）✓。lint 0 errors / build:electron ✓。

### 与计划的差异

1. 「取 HTML → SERP parser 快档」落地为「就地 evalInTab 跑 parser」（主世界 executeJavaScript，等效且零 DOM 兼容层），serp-parsers.ts 零改动
2. 失败结构以 `failure?: FetchFailureContext` 附在既有 ok:false 分支（errorClass/message 保持向后兼容），而非替换字段
3. expand/pager 点击由 Patchright 真实点击降级为页内合成 click()（Step 3 已知限制）
4. 新增 skipInitialLoad：openTab 原 void loadURL 吞错误，fetch 层需感知导航失败并返回 tabId

### 给下一步的接力棒

- 关键签名/数据结构：
  - `evalInTab<R>(tab, fn, arg?)`（主世界 `(fn)(JSON arg)`，返回值须 plain data）；`loadFetchTab(tab, url, timeoutMs=20s)` 失败抛 `FetchNavError{url}`；`FetchFailureContext = {pageAvailable, tabId, url, pageState, suggestedNextTools}`
  - `closeFetchTab/promoteFetchTab(manager, tabId, holderId)`（成功自关/失败 promote 为 agentTabId）；`presentTabWindow(manager, tab)`（挂主窗口呈现验证页）；`createFetchPageOps(manager, tab): FetchPageOps`（承接原 Page 使用面）；`DEFAULT_FETCH_WORKSPACE_ID='embedded-fetch'` 兜底 partition
  - manager 新增：`promoteToAgentTab(tabId)`、`ensureWorkspaceProxy(workspaceId, proxyServer)`（PAC 幂等）、openTab 支持 `skipInitialLoad`
  - 服务：`searchWeb(query, {engine, site, maxResults, proxyServer, taskMeta, onAction, serpUrls, workspaceId})`、`readArticleWithBrowser(url, {taskMeta, onAction, workspaceId})`；ok:false 分支带 `failure?`，errorClass 保留
  - 工具层：`formatFetchFailure(label, errorClass, message, failure?)` 统一失败文案
- 下个 step 从 Step 5（动作流）继续：formatFetchFailure 可作为失败类动作事件的文案入口；openTab(skipInitialLoad)+loadFetchTab 是「自管导航服务」模式，原子工具仍走 navigateTab
- 待办：页面环境污染（hook 原型）理论上仍可致 clone 失败（可改页面内 JSON.stringify 纯化）；google/ddg 引擎需代理环境实测；guard_submit 未覆盖服务内部合成点击
