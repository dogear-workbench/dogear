---
step: 2
title: site-knowledge-service 新建
status: done
---

## 目标

站点档案服务层：读档案（两区）、追加发现区、指针判断，纯代码独立可验证。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无（本步是地基，与 Step 1 并行无依赖）
- 当前关键文件状态：`.dogear/` 是用户数据目录（getConfigDir()）；browser-gateway 维护 tab snapshot（含当前 url）；服务层零 electron 依赖惯例（initBrowserGateway(appVersion) 先例）
- 关键决策回顾：档案是 `.dogear/site-knowledge/{domain}.md`；两区结构（## 正式地图（已验证） / ## 探索发现（未验证，由会话追加））；域名规范化小写去 `www.`；读取截断 8KB；发现区单条 ≤500 字

## 计划改动

- [ ] 新建 `electron/main/services/browser/site-knowledge-service.ts`：
  - `readSiteKnowledge(domain: string): { exists: boolean; content: string }` — 域名规范化后读档案，超 8KB 截断加标记；不存在返回 exists:false（调用方拼正常态文案）
  - `appendSiteFinding(domain: string, finding: string, conversationId: string): { ok: boolean; error?: string }` — 校验长度（≤500 字）与域名合法性；无档案时自动创建含两区标题的骨架文件；追加格式 `- [YYYY-MM-DD · {conversationId 前 8 位}] {finding}`；同会话短时间去重（相同 finding 60s 内不重复追加）
  - `hasSiteKnowledge(domain: string): boolean` — navigate 指针用
- [ ] 单元冒烟 `resources/browser-eval/site-knowledge-smoke.mjs`（node 执行）：读不存在域 / 建骨架追加 / 超长拒绝 / 去重 / 截断

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 追加返回值增加 `deduplicated?: true` 字段（60s 内重复提交返回 ok:true + deduplicated，工具层可输出「已记录过」而非失败）
  - 新增导出 `normalizeDomain(input: string): string | null`（小写、去 www.、宽容 URL/路径输入、字符白名单 + 段校验防 `..` 穿越），Step 3 从 tab snapshot 取域名时可直接复用
  - 追加时若存量档案无「探索发现」标题（如人工只建了正式区），自动补标题再追加
  - 骨架正式区含占位行「（暂无，由人工或主会话审核「探索发现」后合并至此）」
- 改动文件清单：
  - 新建 `electron/main/services/browser/site-knowledge-service.ts`（约 130 行）
  - 新建 `resources/browser-eval/site-knowledge-smoke.mjs`（node 冒烟，26 断言全 PASS）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `readSiteKnowledge(domain): { exists: boolean; content: string }`（超 8KB 截断加标记；非法域/不存在 → exists:false）
  - `appendSiteFinding(domain, finding, conversationId): { ok: boolean; error?: string; deduplicated?: boolean }`（finding ≤500 字、追加行 `- [YYYY-MM-DD · {id前8位}] {finding}`、60s 去重、无档案自动建骨架）
  - `hasSiteKnowledge(domain): boolean`（navigate 指针用）
  - `normalizeDomain(input): string | null`（传入完整 URL 也能取 hostname）
- 下个 step 该从哪里继续：extension-tools.ts 加 site_knowledge / site_finding 两工具 + navigate 返回尾部指针；域名从 browser-gateway tab snapshot 的 url 经 normalizeDomain 取；无档案返回正常态文案非 isError
- 待办或已知限制：60s 去重 Map 仅进程内（重启丢失，可接受）；冒烟跑前需 bun run build:electron（从 dist 导入）
