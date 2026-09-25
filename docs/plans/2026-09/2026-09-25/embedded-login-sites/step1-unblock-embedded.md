---
step: 1
title: 解禁内嵌策略站点
status: pending
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

- [ ] `electron/main/services/browser/site-policy.ts` 删除 `controlledBrowserBlock` 函数
- [ ] `electron/main/agents/tools/browser-tools.ts` 删 import、删 readArticle 内封禁检查块（含 `site_forbidden` 动作流分支）；description 删「小红书等登录态站点禁止本通道…」段，改为受节奏保护站点自动生效延迟与预算的说明
- [ ] `electron/main/agents/tools/browser-atom-tools.ts` 删 import、删 navigate 内封禁检查块；description 同步更新（保留「受节奏保护的站点导航前会自动等待随机时长」句）
- [ ] 全局 Grep `controlledBrowserBlock` / `site_forbidden` / `禁止本通道` 确认无残留（文档 docs/ 与代码注释中的引用一并清理）
- [ ] `bun run build:electron` 编译通过 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：

## 验证口径

- dev 模式下主会话/子会话调 `dogear__browser__navigate` 到 `https://www.xiaohongshu.com`：不再被拒，命中随机延迟（动作流可见 navigate 事件），返回 pageState；未登录时应为 login_required 或正常首页 + 等待人工卡片（视页面实际形态）。
- `dogear__browser__readArticle` 小红书笔记 URL 不再返回封禁文案。
- 预算耗尽（同会话 5 次搜索/20 次笔记）后 navigate/readArticle 返回预算拒绝文案（既有逻辑，不改动）。
