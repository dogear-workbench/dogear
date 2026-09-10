# 浏览器基础巩固（提示词 · 工具 · 能力页）设计

**日期**：2026-09-10
**范围**：B = 文案修正 + 结构小调（主会话 extension 死胡同 + Profile 方法论注入子会话）
**前置调研**：共享区 `browser-embedded-review.md`（内嵌 13 条问题）+ `browser-extension-review.md`（扩展 11 条问题），本设计引用其结论与行号。

## 背景

浏览器双通道（内嵌 dogear__browser__* 15 工具 / 扩展 dogear__extension__* 8 工具）经 2026-09-08 统一能力改造后链路与运行时文案健康，但静态提示词与实现/受众脱节，共 24 条问题（4 条 P1）。用户在能力页看不到浏览器（藏在「文章解析」skill 关联工具包里），主会话 extension 无入口但文案硬引导（死胡同），「浏览器解析」Profile 的方法论只进主会话派遣索引、执行探索的子会话看不到（不生效）。

**定位决策（已拍板）**：
- 浏览器独立成能力域，主会话可选开 browser 包（15 工具约 7-8.5K token 常驻，开不开由用户按 token 取舍）
- extension 保持子会话 Profile 专属（会话独占语义 + 登录态调研场景天然适合子会话）
- 小红书内嵌禁令**维持**（账号安全 > 通道灵活性；风控策略按真实浏览器环境设计）
- 不做 token 大瘦身（现 3.5-4% 占比不痛，等本轮口径稳定后再看）

## 目标

1. 能力页出现独立「浏览器」域：skill（提示词）+ 工具包配套展示，开 skill 自动开工具包
2. 浏览器探索方法论 skill 化：主会话（开域后）与浏览器解析子会话（browser 能力启用时）都能看到
3. 消灭全部 P1：主会话 extension 死胡同、find 假 ref 承诺、click/fill 假确认承诺、双通道人工介入模型混淆
4. 修 P2 全部 + 低成本 P3（文案失真、ref 示例过时、busy 语义、冷启动引导等）

## 架构

### B1 方法论 skill 化 + 能力域独立（4 文件）

**新增 builtin skill 模板** `resources/skill-templates/browser-exploration/SKILL.md`：

- frontmatter description（进 `<available_skills>` 索引，一两句）：双通道浏览器调研方法论——使用 dogear__browser__* / dogear__extension__* 工具前先加载本 skill
- 正文 = 完整方法论，**从 createBrowserParseSubAgentProfile 的 description 迁移**（settings-types.ts:264，约 1500 字符单段），迁移时**重写并修正**：
  1. **区分双通道人工介入模型**（修 P1-3）：内嵌通道 = 登录墙/验证/guard 拦截时 raise 等待人工卡片，页面呈现在浏览器面板，用户点「完成后继续」唤醒；扩展通道 = **没有卡片机制**，用户在自己的浏览器直接动手，agent 应提示用户需要人工操作，然后重新 observe_page 感知变化，**不要等「完成后继续」**
  2. 「3 次失败即停」「行动前确认世界状态」「navigate 恢复而非重导航」「站点档案先读后沉淀」等纪律保留，术语与实现对齐（awaiting_human 是内嵌 pageState 之一，intervention reason 实为 login_required/verification_required/guard_password/guard_submit）
  3. 结构化：分节（双通道分流 / 探索循环 / 人工介入 / 站点档案 / 交付与停止），替换 Profile 里的单段长文

**能力域展示**（`app/settings/ability-types.ts`）：

- `ABILITY_DOMAINS` 新增：`{ id: 'browser', label: '浏览器', description: '内嵌浏览器网页读取、搜索与原子探索（双通道调研方法论 + 工具包配套）', skills: ['browser-exploration'] }`（label/description 实施时可微调）
- `SKILL_PACK_MAP['browser-exploration'] = ['browser']`；`article-parser` 关联从 `['article', 'browser']` 改为 `['article']`
- 「文章解析」域 description 去掉「（含内嵌浏览器工具包）」字样

**子会话注入特判**（`electron/main/agents/pi-session/pi-session.ts:137-156` filterSkillsForSubAgent）：

- 照 article-parser 先例：`if (entry.name === 'browser-exploration') return ab.browser === true;`——Profile 勾 browser 能力即见方法论 skill，杜绝「有工具没提示词」错配
- 前提链保持：工作区 enabledSkills 需含 browser-exploration（能力页开关写入）∩ Profile browser===true

**Profile description 缩减**（`electron/main/services/settings-types.ts:259-276`）：

- 缩为约两句选型摘要：双通道分流（公开网页内嵌 / 登录态扩展）+ 会话独占 + 「方法论见 browser-exploration skill，子会话启用 browser 能力自动挂载」
- 新摘要加入 `LEGACY_BROWSER_PARSE_DESCRIPTIONS` 迁移集合（现有四旧值机制），用户未自定义的自动迁移
- `enabledAbilities: { browser: true, extension: true }` 不变（skill 靠特判，无需显式 skills 条目）

### B2 主会话 extension 死胡同（3 文件）

工具 description 静态、无法按会话角色变化 → 禁站点文案改**双出路**让 agent 自判。统一文案基调：

> 该站点需登录态走扩展通道。(1) 本会话已挂载 dogear__extension__* 工具则改用之；(2) 未挂载（主会话默认无）则告知用户改派「浏览器解析」子会话调研，不要重试本通道。

- `electron/main/services/browser/site-policy.ts:127-140` controlledBrowserBlock 文案：改双出路；工具列举补全（现漏 find/scroll/site_knowledge/site_finding，改为不逐一列举或列全）
- `electron/main/agents/tools/browser-tools.ts:62,107` readArticle 描述中的扩展通道引导：改双出路
- `electron/main/agents/tools/browser-atom-tools.ts:70` navigate 描述同上

### B3 文案修正包（约 8 文件，15 条）

| # | 位置 | 改法 |
|---|------|------|
| P1-2 | browser-atom-tools.ts:228（find 返回）+ browser-tool-shared.ts:220（observe_page 尾注） | 删「ref 可直接用于 …find」，find 不收 ref |
| P1-4 | browser-action-tools.ts:113,146（click/fill 描述） | 「需要用户确认后执行」→「受权限模式管控：默认模式逐次确认，自动执行模式直接执行」 |
| P2 | browser-tools.ts:62 | readArticle 错误码枚举改对：need_login/timeout/parse_empty/browser_crash（nav_failed 是 search 的） |
| P2 | browser-tools.ts:238-251 | close 描述删「清空元素引用」，如实写「仅标记任务结束、动作流留痕」 |
| P2 | browser-atom-tools.ts:146 | 「全列不硬截断」→「超 250 可交互元素安全上限时截断并附 region 计数与分块建议」 |
| P2 | browser-atom-tools.ts:70 | 删「仅用于 readArticle 失败后」，改「手动探索、页面恢复与直达 URL；读文章优先 readArticle」 |
| P2 | extension-tools.ts:406,449 | ref 示例 "e3"/"e2" → "e3@2"/"e2@3" 带代际（对齐 :663 scroll 示例） |
| P2 | extension-tools.ts:152-155 | busy 文案 →「对方最近活动于 N 分钟前，通道空闲 10 分钟后自动释放」（修 idleMs 语义失真 + 补自动释放信息） |
| P2 | extension-site-tools.ts:46-51 | siteKnowledgePointer 无档案域不再返回 null：navigate 到无档案站点尾部加「本站尚无站点档案，探索后可用 site_finding 沉淀」 |
| P3 | browser-present-tool.ts:32-55 | present tabId/url 加互斥校验（zod refine 或 handler 显式报错），两传不再静默优先 tabId |
| P3 | browser-action-tools.ts:226 | read_state 描述「小红书类 SPA」→「知乎类 SPA」（内嵌禁小红书，例子自相矛盾） |
| P3 | browser-tools.ts:259-283 | screenshot 文案「Read 工具」→「read 工具」 |
| P3 | browser-tools.ts:139 | search 描述删「引擎与代理在设置页配置」（agent 不可行动） |
| P3 | browser-atom-tools.ts:73 / browser-tool-shared.ts:165 / browser-present-tool.ts:42 | 无工作区/通道不可用错误文案统一模板 |
| P3 | extension-site-tools.ts:67,93 | site_knowledge/site_finding 描述不再注入 SHARED_SCOPE_NOTE 误导首行（不碰页面/不校验授权域），改注「扩展通道会话独占，读写本地站点档案」 |

## 模块边界（完整文件清单）

- `resources/skill-templates/browser-exploration/SKILL.md` — 新增
- `app/settings/ability-types.ts` — 域/包映射调整
- `electron/main/agents/pi-session/pi-session.ts` — filterSkillsForSubAgent 特判一行
- `electron/main/services/settings-types.ts` — Profile description + LEGACY 集合
- `electron/main/agents/tools/browser-tools.ts` — B2 + B3 五条
- `electron/main/agents/tools/browser-atom-tools.ts` — B2 + B3 四条
- `electron/main/agents/tools/browser-action-tools.ts` — B3 三条
- `electron/main/agents/tools/browser-tool-shared.ts` — B3 两条
- `electron/main/agents/tools/browser-present-tool.ts` — B3 两条
- `electron/main/agents/tools/extension-tools.ts` — B3 三条
- `electron/main/agents/tools/extension-site-tools.ts` — B3 两条
- `electron/main/services/browser/site-policy.ts` — B2 一条

## 数据流

- 主会话：能力页开浏览器域 → workspace config `enabledSkills += browser-exploration`、`enabledToolPacks += browser` → pi-session 组装：15 工具挂载 + `<available_skills>` 索引含方法论（懒加载）
- 子会话：Profile enabledAbilities.browser=true → browser 工具包挂载 + 特判放行 browser-exploration skill → 索引可见，agent 调 Skill 工具加载全文
- Profile 索引表（主会话派遣选型）：description 缩为摘要，方法论不再依赖此通道

## 错误处理 / 边界情况

- 用户自定义过 Profile description：LEGACY 集合只含已知四旧值 + 本次替换出去的全文值，自定义值不动（现状机制）
- 工作区未开浏览器域但 Profile 开了 browser 能力：skill 不可见（两层过滤交集），工具照挂——行为与 article-parser 现状一致，可接受
- selftest（DOGEAR_EMBEDDED_BROWSER_SELFTEST）可能断言部分文案：改后跑一遍，同步修正断言
- `docs/codebase-map.md` 相关段落滞后（extension-tools 715 行实为 727）：实施时顺带 doc-sync 更新浏览器段落

## 明确不做（已拍板）

- extension 不进 OPTIONAL_TOOL_PACKS（子会话专属）
- 小红书内嵌禁令维持；内嵌 policyGate 防御性冗余代码保留
- extension-tools.ts 拆分（评估非必须）
- 工具 description token 大瘦身（后续轮次）

## 未决问题

无——双通道人工介入模型、禁令、定位均已拍板。

## 验证

1. `bun run build:electron` + `bun run lint` 通过
2. 能力页：浏览器域出现（skill + browser 包配套）；文章解析域不再含浏览器包；开关联动正确（开 skill 自动开包）
3. 派「浏览器解析」子会话：`<available_skills>` 索引含 browser-exploration；Skill 工具加载全文成功
4. grep 确认旧文案清零（「清空元素引用」「仅用于 readArticle」「已空闲」「如 "e3"」等）
5. selftest 自测通过（文案断言同步修正）
6. 主会话开 browser 包后问小红书类站点：回复应走「告知用户派子会话」而非幻觉调用 extension 工具

## 分步骤判断

不分步骤：除 B1 四文件外全是独立文案小改，无跨步骤状态依赖，单次实施会话可完成验收；本文档即 plan。
