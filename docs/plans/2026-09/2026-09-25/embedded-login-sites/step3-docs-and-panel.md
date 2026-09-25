---
step: 3
title: 外围文案收尾（skill + 数据中心面板）
status: pending
---

## 目标

文档与 UI 文案跟上新现实：browser-exploration skill 双通道分流重写（内嵌为主/扩展 Plan B），数据中心「已登录站点」文案诚实化。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-site-policy-tool.md](./step2-site-policy-tool.md) 已新增 `site_policy` 双前缀工具与 `sitePolicyPointer`；site-policy.ts 已有 `instructions` 字段
- 当前关键文件状态：
  - `resources/skill-templates/browser-exploration/SKILL.md` — frontmatter description 与「双通道分流」段仍写「登录态站点（如小红书）禁止内嵌通道…改走扩展通道」；「站点档案」段只提 site_knowledge/site_finding
  - `app/data-center/browser-data-panel.tsx:153` 「已登录站点」分组标题、`:155` 「暂无登录态站点」空态、`:150` 「暂无站点数据，登录任意网站后出现在这里」空态
  - `hasLoginHint` 判定源：`electron/main/services/browser/browser-data-service.ts` `looksLikeLoginCookie`（cookie 名含 session/token/auth/login/signin 即标记）
- 关键决策回顾：扩展残留价值 = 风控 Plan B + 用户实时协作（手动关联在该场景是特性）；文案不再说「禁止内嵌」。面板文案按「有会话 Cookie（疑似登录）」语义表达，不夸大为已登录。

## 计划改动

- [ ] `resources/skill-templates/browser-exploration/SKILL.md`：
  - frontmatter description 更新：登录态站点以内嵌为主，扩展为风控后备与用户实时协作
  - 「双通道分流」段重写：公开网页与登录态站点均以内嵌为主（登录墙自动等待人工、登录态持久化）；内嵌触发风控熔断后可换扩展通道（若已挂载）；扩展通道定位=用户真实浏览器协作 + Plan B，仍独占、不排队
  - 「站点档案」段补策略读取：navigate 提示有访问策略时先调本通道 site_policy（节奏约束已自动生效，读指引是为了步骤与危险信号认知）
- [ ] `app/data-center/browser-data-panel.tsx`：「已登录站点」→「有会话 Cookie」+ 副标题或 tooltip 说明「按 Cookie 名启发式判定，含未登录的匿名会话，按域名可登出/清除」；空态与「暂无登录态站点」同步改写；`DomainRow` 中 hasLoginHint 徽标文案（`:222` 附近「登录态」）同步
- [ ] 全局 Grep「禁止本通道」「改走扩展通道」「已登录站点」确认无误导残留（docs/codebase-map/browser.md 的描述段落一并更新——browser.md 有「受控浏览器通道封禁扩展绑定站点」与 readArticle need_login 描述）
- [ ] `bun run lint`；渲染层改动走 Vite 热更验证明文案显示

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：

## 验证口径

- skill 加载后全文无「小红书禁内嵌」表述；策略读取指引出现。
- 数据中心浏览器数据面板：分组标题/空态/徽标文案为「有会话 Cookie」语义，确认框 AGENT_RISK_HINT（agent 登录态连带清除风险提示）保留。
