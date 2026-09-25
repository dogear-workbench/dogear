---
step: 2
title: 策略可读化（instructions + site_policy + 指针）
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：

## 验证口径

- 内嵌 navigate 到小红书：返回尾部出现策略指针一行（含工具名）与档案指针（若有档案）。
- `dogear__browser__site_policy` 在小红书 tab 返回指引全文 + 摘要；在无策略域名（如 github.com）返回「无特殊访问策略」正常结果。
- 扩展通道同模式可用（若扩展连接）。
