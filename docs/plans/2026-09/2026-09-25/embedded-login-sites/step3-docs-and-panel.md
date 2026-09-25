---
step: 3
title: 外围文案收尾（skill + 数据中心面板）
status: done
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

- [x] `resources/skill-templates/browser-exploration/SKILL.md`：
  - frontmatter description 更新：登录态站点以内嵌为主，扩展为风控后备与用户实时协作
  - 「双通道分流」段重写：公开网页与登录态站点均以内嵌为主（登录墙自动等待人工、登录态持久化）；内嵌触发风控熔断后可换扩展通道（若已挂载）；扩展通道定位=用户真实浏览器协作 + Plan B，仍独占、不排队
  - 「站点档案」段补策略读取：navigate 提示有访问策略时先调本通道 site_policy（节奏约束已自动生效，读指引是为了步骤与危险信号认知）
- [x] `app/data-center/browser-data-panel.tsx`：「已登录站点」→「有会话 Cookie」+ 副标题或 tooltip 说明「按 Cookie 名启发式判定，含未登录的匿名会话，按域名可登出/清除」；空态与「暂无登录态站点」同步改写；`DomainRow` 中 hasLoginHint 徽标文案（`:222` 附近「登录态」）同步
- [x] 全局 Grep「禁止本通道」「改走扩展通道」「已登录站点」确认无误导残留（docs/codebase-map/browser.md 的描述段落一并更新——browser.md 有「受控浏览器通道封禁扩展绑定站点」与 readArticle need_login 描述）
- [x] `bun run lint`；渲染层改动走 Vite 热更验证明文案显示

## 实施回填（做完后填）

### 实际改动
- 与计划差异：①副标题取「按 Cookie 名启发式判定，含未登录的匿名会话」前半句，「按域名可登出/清除」由行内按钮自明未写入；②「双通道分流」第 1 条保留原快档信息（readArticle/search 首选、失败附页面位置、转原子工具）合并而非删除；③验收返工补齐：SKILL.md 第 2 条与小红书 instructions 口径调和——风控熔断时停止并告知用户、用户同意后可换扩展；预算耗尽不是换通道理由（预算按会话计、双通道共用同一 gate，换通道同样被拒，原计划措辞属事实性错误）；④验收返工补齐：Profile 描述模板同步——settings-types.ts:306 新语义、ability-registry.ts:155「登录态站点优先」→「风控后备」、settings-service.ts LEGACY_BROWSER_PARSE_DESCRIPTIONS 追加现行旧值为第 8 条迁移输入（该集合是 normalize 迁移匹配表而非运行时模板，直接改写会破坏存量迁移；且修掉真缺口：现行旧值原本不在集合里，模板更新后持有它的存量用户不会被刷写）、settings-normalize.test.ts 新增旧值迁移测试。
- 改动文件清单：
  - `resources/skill-templates/browser-exploration/SKILL.md` — description + 双通道分流重写 + 站点档案段补策略读取 + 熔断/预算口径调和
  - `app/data-center/browser-data-panel.tsx` — 「已登录站点」→「有会话 Cookie」+ 副标题；两处空态；hasLoginHint 徽标；AGENT_RISK_HINT 保留
  - `electron/main/services/settings-types.ts` — 浏览器解析 Profile 现行描述模板改新语义（迁移刷写目标值）
  - `electron/main/agents/ability-registry.ts` — browser 包 description「登录态站点优先」→「风控后备」
  - `electron/main/services/settings-service.ts` — LEGACY_BROWSER_PARSE_DESCRIPTIONS 追加现行旧值（迁移输入）
  - `electron/main/services/settings-normalize.test.ts` — 新增旧值迁移→新模板 + 幂等测试
- 模板派生核查：builtin skill 由 pi-session 直接扫描 resources/skill-templates/ 只读模板源，无复制同步机制；用户 .dogear 下无订阅副本；release/win-unpacked 打包副本按先例不改，随下次 dist 自然更新
- 验证：lint 0 errors；`bun test settings-normalize.test.ts + browser-site-tools.test.ts` 65 pass / 0 fail；Grep 源码+dist 三关键词零残留（LEGACY 集合与测试迁移输入值属合法保留，不注入运行时）

### 给下一步的接力棒
- 关键签名 / 数据结构：无新增；Profile 描述模板值在 settings-types.ts `createBrowserParseSubAgentProfile()`，存量迁移入口 settings-service.ts:331（LEGACY set 命中即刷写）
- 下个 step 该从哪里继续：本 step 为末步，计划全部完成
- 待办或已知限制：①运行时验证（面板文案显示、重启后存量 Profile 描述自动刷写、skill 新语义挂载、navigate 小红书尾部指针/site_policy 返回）留待集成验证，需 Electron dev 环境；②主进程改动（settings/ability-registry/site-policy/工具链）重启 Electron 后生效

## 验证口径

- skill 加载后全文无「小红书禁内嵌」表述；策略读取指引出现。
- 数据中心浏览器数据面板：分组标题/空态/徽标文案为「有会话 Cookie」语义，确认框 AGENT_RISK_HINT（agent 登录态连带清除风险提示）保留。
