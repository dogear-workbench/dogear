---
step: 2
title: browser-search-service + SERP 测试基建
status: done
---

## 目标

新建 browser-search-service：引擎编排（auto/降级链/代理健康探测）+ Google/DDG/Bing 三个 SERP 解析器 + 验证页与故障检测，配本地 mock SERP 测试页与管线断言。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-patchright-pac.md] patchright 已接管 launch，PAC 已注入（生效方式见其回填）
- 当前关键文件状态：`services/browser/browser-article-service.ts` 是声明式服务的参照实现（acquire/release 用法、`new Function('return ...')()` 的 evaluate 写法、错误结构）；browser-manager `acquire(meta: BrowserTaskMeta)` 单 page 租约
- 关键决策回顾：降级链 Google → DDG → Bing；每级降级记录原因；三级全失败才失败；解析空给 `parse_empty` 不 AI 兜底；SERP 解析器宽松多候选选择器

## 计划改动

- [ ] 新建 `electron/main/services/browser/browser-search-service.ts`：
  - `searchWeb(query, opts): Promise<SearchOutcome>`，`SearchOutcome = { engine, query, results: Array<{rank,title,url,snippet}>, degradations: Array<{from,to,reason}> }`
  - 引擎编排：读引擎配置（本 step 用参数传入，step3 接设置项）；`auto` 先代理健康探测（通过 PAC 代理发轻量请求，2s 超时）→ google 或直接 bing
  - 三个引擎函数：goto SERP URL（Google `google.com/search?q=`、DDG `html.duckduckgo.com/html/?q=`、Bing `cn.bing.com/search?q=`）→ 验证页检测（Google URL 含 `/sorry/`；DDG 代理连接失败；Bing 空结果）→ 解析
  - 解析器：evaluate 内 DOM 查询走 `new Function('return ...')()` 写法（主进程无 DOM lib，见 article-service 现成样例）；Google 多候选选择器；结果默认 top 8、上限 15、夹紧
  - 动作事件转发给 browser-action-stream（对齐 readArticle 的 forward 模式，伴随面板可见搜索动作）
- [ ] `resources/browser-eval/` 加 `serp-bing.html` / `serp-google.html` / `serp-ddg.html` mock 页（**必须 `<meta charset="utf-8">`**，中文 Windows GBK 坑；结构按各引擎真实 SERP 的容器/类名简化构造）
- [ ] `resources/browser-eval/run-pipeline.mjs` 加 search 管线断言：三个引擎的解析正确性（条目数/字段/去广告位）+ 降级链编排（mock 验证页触发降级）+ parse_empty 路径
- [ ] 回归：全管线 PASS（11 + 新增）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. SERP 解析器拆到独立文件 `serp-parsers.ts`（三个 new Function 解析器纯函数，主 service 专注编排，单文件行数控制）
  2. `SearchOutcome` 加了 ok union 失败分支（errorClass：empty_query/parse_empty/timeout/browser_crash），三级全失败结构化返回不 throw，对齐 article-service 错误风格
  3. 引擎链补充：显式指定引擎也有降级（google→[g,d,b]、ddg→[d,b]、bing→[b]）；auto 未配置代理直接 [b] 不探测
  4. 代理健康探测实现为 TCP 连通探测（net.connect 2s 超时），语义对齐设计「只要求 Clash 进程活着」
  5. 管线降级/parse_empty 断言用本地 http server（/sorry/ 路径触发验证页检测），file:// 无法构造 /sorry/ URL；三个 mock html 文件本身用 file:// 加载
- 改动文件清单：
  - `electron/main/services/browser/browser-search-service.ts`（新建，编排/探测/降级链）
  - `electron/main/services/browser/serp-parsers.ts`（新建，三引擎解析器）
  - `resources/browser-eval/serp-google.html` / `serp-ddg.html` / `serp-bing.html`（新建，含广告干扰样本）
  - `resources/browser-eval/run-pipeline.mjs`（加 9 个 search 断言 + serp mock server）
- 回归：管线 20/20 PASS（11 旧 + 9 新）；build:electron 通过；lint 无新增问题

### 给下一步的接力棒
- 关键签名：`searchWeb(query, options): Promise<SearchOutcome>`，options = { engine?: 'auto'|'google'|'ddg'|'bing', maxResults?, proxyServer?, taskMeta?, onAction?, serpUrls? }；`clampMaxResults(n?)` 导出可测；`probeProxyServer(addr, timeoutMs=2000)` 导出可测
- 工具注册：照 readArticle 模式接 onAction 回调（SearchActionEvent.action ∈ navigate/wait/observe/parse）forward 到动作流；不进 BROWSER_INTERACTIVE_TOOLS；错误 outcome 转 isError 文本，成功 outcome 文本化（含 engine + degradations 提示）
- 设置项接线：`browserSearchEngine` → options.engine；`browserProxyServer` → options.proxyServer（空 = auto 直接 Bing）；serpUrls 是测试注入专用，工具层不要传
- 待办/限制：serpUrls 覆盖可绕过真实引擎 URL（仅测试用，注意不要暴露给工具参数）；Google 真实 DOM 选择器基于公开结构多候选宽松匹配，真机一次冒烟验证未做（无代理环境下不可靠），上线后失败走 parse_empty 降级路径
