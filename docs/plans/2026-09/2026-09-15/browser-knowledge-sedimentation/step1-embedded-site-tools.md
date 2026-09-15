---
step: 1
title: 内嵌通道站点档案工具
status: in_progress
---

## 目标

内嵌浏览器通道获得与扩展通道对等的站点档案读写能力：新增 `dogear__browser__site_knowledge` / `dogear__browser__site_finding` 两工具，navigate 到有档案的站点时返回尾部指针引导先读档案。

## 依赖上下文（接力棒输入）

- 存储层现成，`electron/main/services/browser/site-knowledge-service.ts` 全量复用，关键签名：
  - `normalizeDomain(input: string): string | null`
  - `readSiteKnowledge(domain: string): { exists: boolean; content: string }`（8KB 截断）
  - `appendSiteFinding(domain: string, finding: string, conversationId: string): { ok: boolean; error?: string; deduplicated?: boolean }`（500 字上限 / 60s 去重）
  - `hasSiteKnowledge(domain: string): boolean`
- 参照实现：`electron/main/agents/tools/extension-site-tools.ts`——`createSiteToolDefs(deps: SiteToolDeps)` deps 注入模式（conversationId / acquireGate / currentUrl / isErrorResult / textResult / scopeNote），工具描述文案可直接改造复用
- 关键差异（内嵌版不需要的部分）：内嵌通道无扩展独占 gate，`acquireGate` 可省略或传 no-op；`currentUrl` 取自内嵌 agent tab
- 当前 tab URL 获取方式：实施时参照 `browser-atom-tools.ts` 内 navigate/read_state 等工具如何拿当前 tab（`createAgentTabRunner` 或 embedded-browser-manager 的当前 tab），保持同一模式

## 计划改动

- [ ] `electron/main/agents/tools/extension-site-tools.ts`：`siteKnowledgePointer(url)` 参数化通道——签名改为 `siteKnowledgePointer(url: string | undefined, toolPrefix: 'dogear__extension' | 'dogear__browser' = 'dogear__extension')`，内部文案按前缀生成工具名；`readSiteKnowledge` 冷启动引导文案同理参数化（extension-tools.ts 调用点不传第二参保持兼容）
- [ ] 新建 `electron/main/agents/tools/browser-site-tools.ts`：`createBrowserSiteToolDefs(opts)` 导出两个内嵌版工具；currentUrl 从内嵌当前 agent tab 取；无 tab 时报「请先 dogear__browser__navigate 到目标站点」；工具描述文案对照 extension 版改写（去掉扩展独占表述，补「存储与扩展通道共用同一份档案」一句）
- [ ] `electron/main/agents/tools/browser-tools.ts`：`createBrowserToolDefs` 返回数组展开 `...createBrowserSiteToolDefs(...)`（挂在 atom/action 组之间位置合理处）
- [ ] `electron/main/agents/tools/browser-atom-tools.ts:129` 附近：navigate 成功的 `textResult` 尾部接 `siteKnowledgePointer(导航后 URL, 'dogear__browser')`（参照 extension-tools.ts:258 的写法）
- [ ] 测试：参照 settings-normalize.test.ts 风格给 browser-site-tools 补最小单测（有/无档案返回、无 tab 报错、finding 追加），若 extension 版无对应测试则建 `browser-site-tools.test.ts`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
