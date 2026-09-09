---
step: 4
title: 抓取迁移
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
