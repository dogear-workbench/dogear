# 登录态站点内嵌化与站点策略按需读取 设计

**日期**：2026-09-25
**状态**：方案已与用户对齐，待实施

## 背景

- 小红书等登录态站点目前被 `controlledBrowserBlock` 硬封禁在内嵌通道外（site-policy.ts:133），只能走扩展通道；扩展需用户在外部浏览器手动连接标签页，体验割裂，且 agent 无法自主运作。
- 站点策略（随机延迟、会话预算、风控熔断）对 agent 是黑盒：延迟静默执行、拒绝只有一句文案，agent 读不到策略内容（操作步骤、节奏要求、危险信号含义）。
- 站点档案（site-knowledge）已有「navigate 指针提示 + 按需读取」模式（`siteKnowledgePointer`），策略缺同样的机制。
- 扩展通道定位需随内嵌放开而调整。

## 目标

1. 小红书可在内嵌通道使用：解禁 `controlledBrowserBlock`，内嵌工具链的策略门控（`navigateGate`/`policyGate` 已接好，browser-atom-tools.ts:87/162/204/252）全链路生效；登录走已有 need_login → 等待人工 → 登录态持久化路径。
2. 站点策略内容 agent 可读：`SitePolicy` 增加中文操作指引字段；新增 `site_policy` 工具按域名读取；navigate 命中策略站点时返回尾部策略指针。
3. 硬约束不动：延迟 sleep、预算计数、风控熔断保持代码层强制，不依赖 agent 自觉。
4. 扩展定位调整（文案层）：内嵌为主（含登录态站点），扩展降为「风控 Plan B + 用户实时协作」。
5. 顺带：数据中心「已登录站点」文案诚实化——`hasLoginHint` 是 cookie 名启发式（session/token/auth/login 关键词），大量匿名会话 cookie 被误标为「已登录」。

## 架构

**分层原则：纪律硬、指引软。**

- 硬约束（代码强制，不可绕过）：延迟、预算、风控熔断，照旧在工具链执行。
- 软指引（文档化，agent 按需读）：策略操作指引（步骤、节奏说明、危险信号、被拒后怎么办）、站点档案（页面地图+探索发现）。

**改动一：解禁内嵌策略站点**

- 删除 `controlledBrowserBlock` 及其两处调用（browser-tools.ts readArticle、browser-atom-tools.ts navigate），同步更新两个工具 description 中的「小红书禁止本通道」文案为「受节奏保护站点自动生效延迟与预算」。
- `browser-exploration` skill 双通道分流段重写：登录态站点以内嵌为主（登录墙自动等待人工、登录态持久化），扩展通道保留为风控 Plan B 与用户实时协作场景。

**改动二：策略可读**

- `SitePolicy` 增加 `instructions: string`（中文操作指引：推荐步骤、节奏与预算数字、危险信号列表及命中后果、预算耗尽/风控熔断时该怎么做）。
- 新增 `site_policy` 工具（双前缀 `dogear__browser__site_policy` / `dogear__extension__site_policy`，与 site_knowledge 同模式）：读当前域名策略全文（instructions + 数字约束摘要）；无策略站点正常返回「本站无特殊访问策略」。
- navigate 返回尾部追加策略指针（内嵌与扩展两处 navigate）：命中 `getSitePolicy(url)` 时提示「本站有访问策略（节奏约束已自动生效），建议先调 site_policy 了解操作步骤」。与 `siteKnowledgePointer` 并列追加，各占一行。

**改动三：数据中心文案诚实化**

- browser-data-panel.tsx「已登录站点」分组改为「有会话 Cookie（疑似登录）」语义文案；「暂无登录态站点」等空态文案同步。

**排除的选项及原因**：

- 策略文件化（`.dogear/site-policies/` 启动扫描）：当前仅小红书一个策略站点，运行时增删是假设需求，YAGNI；加新站点 = 代码注册表加一条，agent 侧零改动。
- 策略并入站点档案第三区：纪律（人工维护、代码执行）与知识（agent 可沉淀）职责不同，混在一份文件两处维护。
- 策略摘要直接塞进 navigate 返回：每次导航都占返回长度，且 agent 无需每次重读；指针 + 按需读更省。
- 本期做扩展自主化（onStartup 自动连 + NM 保活 + 多 tab 命令）：等内嵌实测风控结果再定，见未决问题。

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/services/browser/site-policy.ts` | SitePolicy 加 `instructions`；小红书策略补指引文案；删 `controlledBrowserBlock` |
| `electron/main/agents/tools/browser-tools.ts` | readArticle 删封禁检查；description 更新 |
| `electron/main/agents/tools/browser-atom-tools.ts` | navigate 删封禁检查；description 更新；navigate 返回加策略指针 |
| `electron/main/agents/tools/extension-site-tools.ts` | 新增 `site_policy` 工具定义（双前缀）；新增 `sitePolicyPointer` helper |
| `electron/main/agents/tools/extension-tools.ts` | navigate 返回加策略指针 |
| `resources/skill-templates/browser-exploration/SKILL.md` | 双通道分流段重写（内嵌为主/扩展 Plan B）+ 策略读取段 |
| `app/data-center/browser-data-panel.tsx` | 「已登录站点」文案诚实化 |
| `electron/main/agents/tools/browser-site-tools.test.ts` | 指针/工具测试同步 |

## 数据流

- 内嵌 navigate：navigateGate（熔断→预算→随机延迟）→ 导航 → 风控关键词扫描（命中即熔断该域）→ pageState 判定（登录墙/验证 → 等待人工卡片）→ 返回快照 + 档案指针 + 策略指针。
- `site_policy`：acquireGate → 域名解析 → `getSitePolicy` → 有则返回 instructions + 数字约束摘要，无则正常返回。
- 登录态：内嵌全局分区（`persist:dogear-browser`）持久化，与网页 AI 共用；数据中心按域登出/清数据对两者同时生效。

## 错误处理 / 边界情况

- 内嵌登录墙：沿用 pageState `login_required` → 等待人工 → 用户登录后 agent 继续（已有机制，无需新增）。
- 预算耗尽 / 风控熔断：拒绝文案不变；策略指引里明确告知 agent 此时停止并告知用户，不换通道规避。
- 扩展通道 stale_tab / 未授权域 permission_denied 行为不变。
- `site_policy` 无策略域名返回正常结果（非错误），与 site_knowledge 一致。

## 未决问题

1. **诚实 UA vs 标准 Chrome UA**：内嵌 UA 带 `Dogear/x.x.x` 尾巴（ua.ts 诚实策略），小红书强风控下是否针对非常规 UA 需实测；若内嵌实测风控不佳，再议是否对策略站点用标准 UA（原则性取舍，需用户拍板）。
2. **扩展自主化**（onStartup 自动重连 + NM port 保活 + open_tab/switch_tab/list_tabs 多 tab 模型）：触发条件——内嵌实测风控不行时升为必做项；内嵌良好则扩展退为低频协作场景，可不做。
3. **策略文件化**：策略站点 >1 且需运行时增删时再议。

## 验收口径

- agent 内嵌 navigate 小红书不再被拒，命中延迟与预算；登录墙产生等待人工卡片，登录后可继续。
- navigate 到策略站点返回含策略指针；`site_policy` 返回小红书操作指引全文。
- skill 与工具描述中无「小红书禁内嵌」残留。
- 数据中心面板不再把匿名会话 cookie 域名标为「已登录」。
