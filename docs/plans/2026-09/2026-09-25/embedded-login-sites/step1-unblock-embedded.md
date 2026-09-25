---
step: 1
title: 解禁内嵌策略站点
status: done
---

## 目标

删除内嵌通道对策略站点（小红书）的封禁，使 navigateGate/policyGate 门控在内嵌工具链真正生效；agent 可在内嵌访问小红书（登录墙走既有等待人工机制）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无（首步）。设计文档：[../embedded-login-sites-design.md](../embedded-login-sites-design.md)
- 当前关键文件状态：
  - `electron/main/services/browser/site-policy.ts:133` `controlledBrowserBlock(url): string | null` — 封禁文案硬编码「该站点需登录态，应走扩展通道」
  - `electron/main/agents/tools/browser-tools.ts:71` readArticle 调 `controlledBrowserBlock(args.url)`，命中即 `isErrorResult` + 动作流 `result: 'site_forbidden'`
  - `electron/main/agents/tools/browser-atom-tools.ts:74` navigate 同上；`browser-atom-tools.ts:87` 起已有 `navigateGate`（熔断→预算→随机延迟）→ 导航 → `scanAndMarkRisk` → `resolvePageState`（login_required/verification_required → `raiseHumanIntervention`）
  - 两工具 description 里各有一段「小红书等登录态站点禁止本通道…改用扩展通道/改派浏览器解析子会话」文案
- 关键决策回顾：内嵌工具链门控早已接好（P2 时为纵深防御预埋），删除封禁即全链路生效，无需新增门控代码。

## 计划改动

- [x] `electron/main/services/browser/site-policy.ts` 删除 `controlledBrowserBlock` 函数
- [x] `electron/main/agents/tools/browser-tools.ts` 删 import、删 readArticle 内封禁检查块（含 `site_forbidden` 动作流分支）；description 删「小红书等登录态站点禁止本通道…」段，改为受节奏保护站点自动生效延迟与预算的说明
- [x] `electron/main/agents/tools/browser-atom-tools.ts` 删 import、删 navigate 内封禁检查块；description 同步更新（保留「受节奏保护的站点导航前会自动等待随机时长」句）
- [x] 全局 Grep `controlledBrowserBlock` / `site_forbidden` / `禁止本通道` 确认无残留（文档 docs/ 与代码注释中的引用一并清理）
- [x] `bun run build:electron` 编译通过 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无差异，按计划逐项完成。额外按边界澄清同步修正了 docs/codebase-map/browser.md:31（site-policy.ts 行）与 :76（注意事项行）的 controlledBrowserBlock 受控封禁描述，改为统一门控生效语义。
- 改动文件清单：
  - `electron/main/services/browser/site-policy.ts` — 删 `controlledBrowserBlock` 函数
  - `electron/main/agents/tools/browser-tools.ts` — 删 import + readArticle 封禁检查块（含 `site_forbidden` 分支）；description 封禁段改为「受节奏保护的站点自动生效随机延迟与会话预算」
  - `electron/main/agents/tools/browser-atom-tools.ts` — 删 import + navigate 封禁检查块；description 改为节奏控制说明（保留随机时长语义，补充搜索类导航的单会话搜索预算）
  - `docs/codebase-map/browser.md` — :31 与 :76 两处改为门控生效语义
- 验证：Grep `electron/` 与 `docs/codebase-map/` 无 `controlledBrowserBlock`/`site_forbidden`/`禁止本通道` 残留（`docs/plans/` 历史文档按约定保留，`dist/` 已随编译更新）；`bun run build:electron` 通过；`bun run lint` 0 errors（95 warnings 均既有 no-explicit-any）

### 给下一步的接力棒
- 关键签名 / 数据结构：site-policy.ts 现存导出——`getSitePolicy(url): SitePolicy | null`、`navigateGate(conversationId, targetUrl)`（风控前置→搜索预算→随机延迟，返回 `{ctx, isSearch} | {blocked, reason}`）、`policyGate(conversationId, pageUrl)`（风控前置→延迟，返回 `GateResult`）、`scanAndMarkRisk` / `checkSearchBudget` / `checkNoteBudget` / `consumeSearch` / `consumeNote`；`SitePolicy` 接口未动（step2 才加 instructions）。
- 下个 step 该从哪里继续：step2-site-policy-tool.md——SitePolicy 加 instructions 必填字段、小红书策略补指引、extension-site-tools.ts 新增 site_policy 双前缀工具、`sitePolicyPointer` 追加 navigate 返回尾部、browser-site-tools.test.ts 指针测试同步。
- 待办或已知限制：①验证口径中的 dev 实测（小红书导航不再被拒、预算耗尽拒绝文案）需运行 Electron 实测，本 step 未执行，留待集成验证；②readArticleWithBrowser 服务内部未挂 navigateGate（快档直读路径），策略站点经 readArticle 的预算/延迟行为由服务内部决定，step2 site_policy 工具文案如涉及 readArticle 需留意。

## 验证口径

- dev 模式下主会话/子会话调 `dogear__browser__navigate` 到 `https://www.xiaohongshu.com`：不再被拒，命中随机延迟（动作流可见 navigate 事件），返回 pageState；未登录时应为 login_required 或正常首页 + 等待人工卡片（视页面实际形态）。
- `dogear__browser__readArticle` 小红书笔记 URL 不再返回封禁文案。
- 预算耗尽（同会话 5 次搜索/20 次笔记）后 navigate/readArticle 返回预算拒绝文案（既有逻辑，不改动）。
