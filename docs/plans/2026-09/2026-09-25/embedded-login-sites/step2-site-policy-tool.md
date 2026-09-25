---
step: 2
title: 策略可读化（instructions + site_policy + 指针）
status: done
---

## 目标

站点策略内容对 agent 可读：`SitePolicy` 增加操作指引，新增 `site_policy` 双前缀工具，navigate 命中策略站点时返回尾部策略指针——agent 用到小红书时先读策略再操作，新站点注册策略后零改动自动生效。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-unblock-embedded.md](./step1-unblock-embedded.md) 已删除 `controlledBrowserBlock` 与两处调用；内嵌策略站点门控已全链路生效；两工具 description 已更新
- 当前关键文件状态：
  - `electron/main/services/browser/site-policy.ts` — `SitePolicy` 接口（matchOrigins/searchUrlIncludes/delayMs/searchDelayMs/budget/riskKeywords）+ `XIAOHONGSHU_POLICY` 常量 + gate 系列函数
  - `electron/main/agents/tools/extension-site-tools.ts` — `createSiteToolDefs(deps)` 工厂返回 site_knowledge/site_finding 两个 ToolDef；`siteKnowledgePointer(url, toolPrefix)` 返回 `\n\n...` 或 null；`SiteToolPrefix = 'dogear__extension' | 'dogear__browser'`
  - `electron/main/agents/tools/browser-atom-tools.ts:130` 附近 navigate 返回尾部 `siteKnowledgePointer(snapshot.url, 'dogear__browser')`
  - `electron/main/agents/tools/extension-tools.ts:258` 附近扩展 navigate 返回尾部 `siteKnowledgePointer(urlAfter ?? args.url)`
  - `electron/main/agents/tools/browser-site-tools.test.ts:85` 既有 `siteKnowledgePointer` 行为测试
- 关键决策回顾：指引软、纪律硬——instructions 只是指引文本，延迟/预算/熔断仍在代码强制；指针模式复刻 siteKnowledgePointer（事件驱动提示一次，agent 自行决定读不读）。

## 计划改动

- [ ] `electron/main/services/browser/site-policy.ts`：`SitePolicy` 加必填 `instructions: string`；`XIAOHONGSHU_POLICY` 补中文操作指引——内容覆盖：推荐步骤（先 site_knowledge 读档案→搜索→逐笔记阅读）、节奏与预算数字（导航延迟 15-45s/搜索 30-90s、20 笔记/5 搜索每会话）、危险信号列表及命中后果（熔断本会话该域）、预算耗尽/风控熔断时的正确动作（停止并告知用户，不换通道规避、不轮询重试）；新增导出 `formatSitePolicySummary(policy)` 摘要 helper（域名、延迟区间、预算、风控关键词数）
- [ ] `electron/main/agents/tools/extension-site-tools.ts`：`createSiteToolDefs` 增加第三个工具 `{toolPrefix}__site_policy`（读当前域名策略：有则返回 instructions + formatSitePolicySummary，无则正常返回「本站（domain）无特殊访问策略」）；新增导出 `sitePolicyPointer(url, toolPrefix)`——命中 `getSitePolicy` 时返回 `\n\n本站有访问策略（节奏约束已自动生效），建议先调 {toolPrefix}__site_policy 了解操作步骤与危险信号`
- [ ] `electron/main/agents/tools/browser-atom-tools.ts` navigate 返回尾部追加 `sitePolicyPointer`（与档案指针并列，各占一行）
- [ ] `electron/main/agents/tools/extension-tools.ts` 扩展 navigate 返回尾部同上（默认前缀）
- [ ] `electron/main/agents/tools/browser-site-tools.test.ts`：补 `sitePolicyPointer` 行为测试（无策略 null、有策略含工具名、双前缀正确）；site_knowledge 既有测试不回退
- [ ] `bun run build:electron` + `bun run lint` + 跑测试

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 无实质差异。计划外的顺带同步：`docs/codebase-map/browser.md` 三行（site-policy.ts 行补 instructions、extension-site-tools.ts 行补 site_policy/sitePolicyPointer、注意事项行补 site_policy 不过门控）；extension-site-tools.ts 文件头注释同步提到 site_policy。
  - `browser-site-tools.test.ts` 既有首测 `toHaveLength(2)` 同步为 3 并补第三个工具名断言（计划「既有指针测试需同步」范围内的连带断言）。
  - site_policy 工具 description 不复用 scopeNote（其「只读写本地站点档案」表述对策略工具不准确），改用按前缀区分的 policyScopeNote；无 url/域名解析失败沿用 NO_URL_MESSAGES/domainOrError 同款报错路径。
- 改动文件清单：
  - `electron/main/services/browser/site-policy.ts` — SitePolicy 加必填 instructions；XIAOHONGSHU_POLICY 补中文指引（推荐步骤/节奏 15-45s 与搜索 30-90s/预算 20 笔记 5 搜索/危险信号及熔断后果/耗尽与熔断时停止并告知用户）；新增导出 `formatSitePolicySummary(policy)`（站点域名、延迟区间、预算、风控关键词数）
  - `electron/main/agents/tools/extension-site-tools.ts` — createSiteToolDefs 增第三个工具 `{toolPrefix}__site_policy`（有策略返回 instructions+摘要，无策略正常返回「无特殊访问策略」）；新增导出 `sitePolicyPointer(url, toolPrefix)`（命中 getSitePolicy 返 `\n\n本站有访问策略…建议先调 {toolPrefix}__site_policy…`，否则 null）
  - `electron/main/agents/tools/browser-atom-tools.ts` — navigate 返回尾部追加 `sitePolicyPointer(snapshot.url, 'dogear__browser')`
  - `electron/main/agents/tools/extension-tools.ts` — 扩展 navigate 返回尾部追加 `sitePolicyPointer(urlAfter ?? args.url)`（默认前缀）
  - `electron/main/agents/tools/browser-site-tools.test.ts` — 既有断言同步 + 新增 site_policy handler 测试（有策略/无策略）+ sitePolicyPointer 指针测试（null/双前缀/工具名）
  - `docs/codebase-map/browser.md` — 三行描述同步

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SitePolicy.instructions: string`（必填，新站点经 registerSitePolicy 注册时必须带指引）
  - `formatSitePolicySummary(policy): string`（4 行摘要：站点/节奏/预算/风控关键词数）
  - `sitePolicyPointer(url, toolPrefix = 'dogear__extension'): string | null`，返回 `\n\n` 开头单行
  - site_policy 工具 handler：acquireGate(null, 'site_policy', currentUrl()) → currentUrl 空/域名解析失败报错 → 无策略 `本站（domain）无特殊访问策略，按常规方式操作即可` → 有策略 `当前站点 {domain} 的访问策略：\n\n{instructions}\n\n{summary}`
- 下个 step 该从哪里继续：按 plan 后续 step（step3+）走；本 step 运行时验证（navigate 小红书尾部出现策略指针、site_policy 返回指引全文）仍未做，需 Electron dev 实测。
- 待办或已知限制：
  - readArticle 快档直读路径无 navigateGate（step1 已知限制，未变）：指引文案已规避以 readArticle 为主语。
  - instructions 为静态文本，指引中工具名写通用名（site_knowledge）不带通道前缀，双通道可读。

## 验证口径

- 内嵌 navigate 到小红书：返回尾部出现策略指针一行（含工具名）与档案指针（若有档案）。
- `dogear__browser__site_policy` 在小红书 tab 返回指引全文 + 摘要；在无策略域名（如 github.com）返回「无特殊访问策略」正常结果。
- 扩展通道同模式可用（若扩展连接）。
