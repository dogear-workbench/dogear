# 浏览器双通道能力拆分与扩展通道完善 设计

**日期**：2026-10-04
**性质**：功能设计文档（实施前需出分步实施计划）
**前置讨论**：本轮会话全程；扩展通道升级背景见 `docs/plans/2026-10/2026-10-02/browser-roadmap-design.md` 与 10-03 能力补齐批次（14dcbfff）

---

## 背景

- 双通道现状：内嵌（WebContentsView）与扩展（NM + tab group）的**工具命名空间已分离**（`dogear__browser__*` 15 个 / `dogear__extension__*` 15 个，实现文件、权限免确认 pack 标识均独立），但**开关绑定**：extension 组绑死 browser 能力包总闸（`5ec080eb`，2026-09-12，当时理由是扩展功能弱、无独立入口，借 browser 包安家）。
- 10 月批次后前提已变：扩展通道工具对齐内嵌（readArticle / screenshot / find / scroll / wait_for）、tab 管理三件套（open/close/list）、一键移交、图片上传、小红书策略模板。两组体量对等、定位明确分家（内嵌 = 无人值守 + 隔离环境；扩展 = 登录态 + 在场协作）。
- 用户战略意图：**拆开做 A/B 实验**，让实际使用说话。用户偏向扩展（内嵌体验不如用户自己的浏览器舒适）；若扩展体验全面胜出，**未来可能下掉内嵌通道**，届时内部不再管理浏览器事宜，网页 AI 哨兵可退为联网搜索/小问题的备用方案。
- 站点档案（site-knowledge）只有 agent 读写，用户完全不可见，缺展示入口。

## 目标

1. 能力体系内拆双包：内嵌浏览器 / 扩展通道各自独立开关、独立详情卡（不做设置页大聚合、不做独立浏览器中心页——已拍板排除）。
2. browser-exploration skill 独立成纯方法论包，SKILL.md 重写为双通道并列。
3. 站点档案展示进数据中心「浏览器数据」面板。
4. tab 生命周期闭环：被动 tab 自动入组 + 上限 8→16 + 会话收尾自动清理。
5. 策略维持三层分工（见下），不新增配置面。

## 架构（核心决策）

### 1. 能力包拆分

| 包 key | 内容 | 说明 |
|---|---|---|
| `browser`（保留） | toolGroups: `['browser']` | 内嵌浏览器，描述改为单通道（无人值守、隔离环境） |
| `browser-extension`（新增） | toolGroups: `['dogear-extension']` | 扩展通道（登录态、在场协作、tab group） |
| `browser-methodology`（新增，纯 skill 包） | skills: `['browser-exploration']`，无 toolGroups | 双通道通用方法论，与通道解耦——测试期中性，未来无论哪条通道胜出（含下掉内嵌）方法论原地不动只改内容 |

- 主会话 extension 注册条件：`activeAbilities.has('browser')` → `activeAbilities.has('browser-extension')`（tool-assembly.ts 独立分支）。
- 子会话：`activeAbilities.has('browser-extension') && profile.extension === true` 双闸（现有 Profile 字段语义不变）。
- skill 加载联动：browser-exploration 的启用走方法论包（enabledSkills 细闸不变）；通道包不再挂 skill。
- **迁移**：存量 browser 包开启 → 三个包默认全开（不打断现有使用）；normalize 幂等写入。
- `enabledToolPacks` 残留 `'extension'` 键：本次正式赋予语义（见未决问题 3）或继续静默忽略，实施时定。

### 2. 排除的选项（及原因）

- 设置页「浏览器」独立 tab 大聚合 / 独立浏览器中心页：用户拍板不聚合，能力页内拆包即可，保持轻。
- 策略全面配置化（per-site 策略编辑 UI）：仅一个策略站点（小红书），成本大于收益；支付黑名单的双层结构（内置 + `settings.paymentBlockedHosts`）已是未来开放的现成先例。
- 押注式 skill 归属（挂扩展包）：污染测试变量，内嵌-only 会话将失去方法论指引。

### 3. 策略三层分工（维持现状，明确边界）

- **硬护栏 → 代码层**（site-policy.ts）：tab 上限、操作节奏（MIN_ACTION_INTERVAL_MS）、单会话预算、风控熔断、提交确认分级、支付网银黑名单。确定性执行，绝不挪进 skill。
- **站点策略 → 代码内置**：SitePolicy 数组追加即生效；agent 经 `site_policy` 工具运行时读取（含 instructions 操作指引）。暂不做用户编辑 UI。
- **skill → 纯方法论**：探索循环、何时停、ref 失效重查、新站先查 site_policy 与站点档案。不写具体数值（数值在策略层，skill 说了也不算数）。通道差异（tab 生命周期、独占模型）写在各自工具 description。

### 4. tab 生命周期闭环

现状缺口：被动开的 tab（target=_blank / window.open）不入组、不占额度、也不受管（close_tab 拒绝组外 tab），游离在用户浏览器里。

- **被动 tab 自动入组**：扩展侧 `tabs.onCreated` 监听，新 tab 的 `openerTabId` ∈ Dogear 组内 → 自动收编入组。「做一件事」的全部 tab 归组可见可管可清。
- **上限 8 → 16**：自动入组后组内 tab 增多，放宽一档；护栏意义仍在（防 agent 失控开页）。
- **会话收尾自动清理**：agent 会话收尾时自动关闭组内「agent 持有且未移交」的 tab；移交用户的页面不动。「未移交」判定见未决问题 1。
- 用户侧体验闭环：agent 干活时 Dogear 分组自己长 → 干完活整组消失，只留移交页面。

### 5. 能力对等性记录（为未来下掉内嵌留结构）

- 探索/阅读/交互完全对等（九件套 + readArticle + screenshot + site 三件套双侧同构）。
- 内嵌独有的三个「非通道能力」：`search`（SERP 抓取降级链，独立服务不依赖通道）、`save_article`（产物入库，属 article 域）、`present`（companion 页面呈现，扩展在场协作天然替代）。
- **决策**：本次不搬家（YAGNI），但记录在案——若下掉内嵌，search / save_article 搬家（search 可独立或并入 web-mcp，save_article 并入 article 包）而非陪葬。

## 模块边界

| 文件 / 区域 | 改动 |
|---|---|
| `electron/main/agents/ability-registry.ts` | 拆三包（browser 收窄 / browser-extension / browser-methodology）；TOOL_PACK_TO_ABILITY 映射更新；描述文案 |
| `electron/main/agents/pi-session/tool-assembly.ts` | extension 注册改 `browser-extension` 包闸；skill 过滤与方法论包联动 |
| `electron/main/services/tool-packs.ts` | browser 包描述改单通道；extension 相关注释更新 |
| `electron/main/services/settings-service.ts` | 迁移：存量 browser 开 → 三包默认开；能力键补齐（参照 browser-parse Profile 缺键迁移先例） |
| `electron/main/agents/pi-session/permission-rules.test.ts` 等测试 | 包归属断言同步 |
| 场景页（`app/settings/scene/*`） | browser 一行 → 内嵌 / 扩展 / 方法论三行（matrix 行扩展） |
| 子会话派遣页（`app/settings/SubAgentTab.tsx`） | browser 单开关（齐开齐关双字段）→ 内嵌 / 扩展两个独立开关 + 方法论 skill 开关 |
| 能力页（`app/settings/ability/*`） | 三卡展示；纯 skill 包（无工具组）详情形态验证 |
| `extension/src/background.js` + `tab-commands.js` | `tabs.onCreated` 自动入组（opener 判断）；上限常量同步 |
| `electron/main/services/browser/site-policy.ts` | MAX_TABS_PER_SESSION 8 → 16 |
| 会话收尾清理（挂载点实施时定位：extension-ownership / PiSession close / gateway） | 关闭组内未移交 tab |
| `electron/main/tipc/browser-data.ts` + `browser-data-service.ts` | 站点档案列表 / 读取 / 删除接口（site-knowledge-service 消费） |
| `app/data-center/browser-data-panel.tsx` | 新增「站点档案」区块：域名列表 + 档案全文查看 + 删除 |
| `resources/skills/browser-exploration/SKILL.md` | 重写为双通道并列方法论（通道选择原则 + 通道无关探索方法） |

## 数据流

- **开关**：场景页 / 能力包开关 → abilityOverrides → resolveAbilities → tool-assembly 按包挂载工具组；skill 启用走方法论包 enabledSkills。
- **自动入组**：网页触发新 tab → `tabs.onCreated`（扩展 SW）→ `openerTabId` 查组归属 → `chrome.tabs.group` 收编 → pushSnapshot 驱动面板刷新。
- **收尾清理**：会话结束 → 遍历 Dogear 组内 tab → 豁免移交标记 → `chrome.tabs.remove` 未移交 tab。
- **站点档案**：数据中心面板 → tipc → site-knowledge-service 读 `.dogear/site-knowledge/{domain}.md`。

## 错误处理 / 边界情况

- **恶意弹窗 / 弹窗轰炸**：四层防线——Chrome 自带弹窗拦截（第一道）→ opener 判断过滤（用户手动浏览页面弹的广告不入组）→ 16 上限兜底（组内轰炸最多 16 个即拒）→ 收尾清理整组收割。油猴类拦截插件是用户侧补充，不在工程范围。
- **被动入组 tab 抢焦点**：Chrome 开新 tab 默认激活，焦点状态机接管策略实施时验证（避免 agent 对旧 tab ref 操作错位）。
- **纯 skill 包 UI**：能力页 / 场景页对无 toolGroups 包的展示（无工具组区），需验证现有组件假设。
- **迁移幂等**：normalize 只在缺键时写入；旧 `enabledToolPacks` 残留 `'extension'` 的处理与最终语义一致。
- **收尾清理误伤**：移交中 / 一键移交草稿引用中的 tab 必须豁免——判定机制是实施关键（未决问题 1）。
- **双侧同步纪律**：nm-protocol / page-state 双副本、site-policy 门控链共用——本次不改语义，只调常量与注册归属。

## 未决问题（实施时补）

1. 「未移交 tab」判定机制：handoff 消息标记？tab 归属表？简单版（组内全关 + 显式豁免清单）vs 精确版（每 tab 移交标记）。倾向简单版起步。
2. 收尾清理挂载点：PiSession close / extension-ownership 释放链 / gateway 断连，哪个时机最稳（多会话并发时只清自己的）。
3. `enabledToolPacks` 的 `'extension'` 键：正式启用（对称内嵌的工作区级子开关）vs 维持忽略（扩展只走包总闸 + Profile 细闸）。倾向后者（少一个开关层，场景页已覆盖 per-scene 控制）。
4. SKILL.md 重写的具体分工边界：哪些通道细节下沉到工具 description，避免 skill 与工具描述重复。
5. 方法论包命名与场景页展示名（browser-methodology / 「浏览器方法论」是否顺口）。

## 与既有工作的关系

- `5ec080eb`（extension 并入 browser 包）：本次拆分是其前提变化后的再修正，不推翻「能力页为归属入口」的原则。
- `de00d082` 扩展通道升级 P0：tab group 模型、一键移交是本次 tab 闭环的依托。
- 10-03 能力补齐批次（14dcbfff / 1a334dff）：工具对等性结论基于该批次产出。
- `agent-web-toolchain-and-search-pref` 记忆中「能力协议是本体，宿主是皮」的形态决策：本次拆包是开关层落地，工具语义层不动，方向一致。
