---
step: 2
title: browser-search-service + SERP 测试基建
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
