# 登录态站点内嵌化与站点策略按需读取 实施计划

**目标**：解禁小红书等策略站点的内嵌通道（门控全链路生效），站点策略内容 agent 可按需读取（site_policy 工具 + navigate 指针），扩展定位与文案调整为「内嵌为主 / 扩展 Plan B」。

**架构思路**：纪律硬、指引软——延迟/预算/熔断保持代码强制（内嵌工具链 policyGate 已接好，解禁即生效）；操作指引走 `SitePolicy.instructions` + `site_policy` 工具 + navigate 尾部指针，与 site-knowledge 的按需读取同模式。排除策略文件化（YAGNI）与并入站点档案（职责混淆），详见 [设计文档](../embedded-login-sites-design.md)。

**涉及模块**：`electron/main/services/browser/site-policy.ts`、`electron/main/agents/tools/{browser-tools,browser-atom-tools,extension-site-tools,extension-tools}.ts`、`resources/skill-templates/browser-exploration/SKILL.md`、`app/data-center/browser-data-panel.tsx`、`electron/main/agents/tools/browser-site-tools.test.ts`

## 步骤索引

- [x] [Step 1: 解禁内嵌策略站点](./step1-unblock-embedded.md) — 删 controlledBrowserBlock 与两处调用，工具 description 更新，内嵌门控全链路生效
- [ ] [Step 2: 策略可读化](./step2-site-policy-tool.md) — SitePolicy.instructions + site_policy 双前缀工具 + navigate 策略指针
- [ ] [Step 3: 外围文案收尾](./step3-docs-and-panel.md) — browser-exploration skill 双通道分流重写 + 数据中心登录态文案诚实化

## 全局决策

- `instructions` 为 `SitePolicy` 必填字段（string），所有注册策略必须带操作指引，避免 null 分支。
- `site_policy` 工具沿用 site_knowledge 双前缀模式：`dogear__browser__site_policy` / `dogear__extension__site_policy`，定义放 `extension-site-tools.ts` 的 `createSiteToolDefs` 同文件（或并列工厂），无策略域名返回正常结果（非错误）。
- 策略指针 helper 命名 `sitePolicyPointer`，与 `siteKnowledgePointer` 并列追加在 navigate 返回尾部，各占一行；命中判定用 `getSitePolicy(url)`。
- navigate/readArticle 的 description 中「小红书等登录态站点禁止本通道」统一改为「受节奏保护的站点自动生效随机延迟与会话预算」语义；不再点名小红书封禁。
- 主进程改动需 `bun run build:electron` 重新编译后才能在 Electron 里生效。
- 不写新单测以外的测试基建；`browser-site-tools.test.ts` 既有指针测试需同步。
