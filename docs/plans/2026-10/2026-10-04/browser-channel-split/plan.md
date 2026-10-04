# 浏览器双通道能力拆分与扩展通道完善 实施计划

**目标**：能力体系内把内嵌浏览器 / 扩展通道拆成独立能力包（+方法论 skill 独立包），补齐 tab 生命周期闭环（自动入组 / 上限 16 / 收尾清理），站点档案在数据中心可见。

**架构思路**：ABILITY_PACKS 拆三包（browser 收窄单通道 / browser-extension 新增 / browser-methodology 纯 skill 包），extension 注册闸从 `browser` 换 `browser-extension`，存量迁移三包默认全开；tab 闭环走「入组全收编 → 组内可管理 → 收尾自动清」；站点档案只在数据中心浏览器面板加展示，不动 site-knowledge 存储结构。排除项（设置页大聚合 / 独立浏览器中心页 / 策略配置化）见 design.md。

**涉及模块**：`electron/main/agents/ability-registry.ts`、`agents/pi-session/tool-assembly.ts`、`services/settings-service.ts`、`services/tool-packs.ts`、`services/browser/site-policy.ts`、扩展 `extension/src/{background,tab-commands}.js`、场景页 / 派遣页 / 能力页组件、`tipc/browser-data.ts` + `app/data-center/browser-data-panel.tsx`、browser-exploration SKILL.md。设计全文见 [design.md](./design.md)。

## 步骤索引

- [ ] [Step 1: 后端能力包拆分与迁移](./step1-pack-split.md) — ABILITY_PACKS 拆三包 + 注册闸切换 + 存量迁移 + 测试同步
- [ ] [Step 2: 前端开关与展示跟进](./step2-frontend-toggles.md) — 场景页三行 / 派遣页双开关 / 能力页三卡
- [ ] [Step 3: browser-exploration 重写为双通道方法论](./step3-skill-rewrite.md) — SKILL.md 通道并列化，通道细节下沉工具 description
- [ ] [Step 4: 被动 tab 自动入组与上限放宽](./step4-tab-adoption.md) — 扩展侧 tabs.onCreated 收编 + MAX_TABS_PER_SESSION 8→16
- [ ] [Step 5: 会话收尾自动清理](./step5-session-cleanup.md) — 会话结束关闭组内未移交 tab（豁免移交页）
- [ ] [Step 6: 站点档案展示](./step6-site-knowledge-panel.md) — 数据中心浏览器数据面板加站点档案区块

Step 4/5/6 与 Step 1-3 相互独立，可穿插执行；Step 2/3 依赖 Step 1。

## 全局决策

- **包 key**：`browser`（保留，收窄为内嵌单通道）/ `browser-extension` / `browser-methodology`；展示名内嵌浏览器 / 浏览器扩展 / 浏览器方法论。
- **迁移**：存量 browser 包开启 → 三包默认全开；normalize 只在缺键时写入（幂等），参照 browser-parse Profile 缺键迁移先例。
- **enabledToolPacks 残留 `'extension'`**：维持静默忽略（扩展只走包总闸 + Profile extension 细闸，不进工作区子开关层——场景页已覆盖 per-scene 控制）。
- **Profile 字段语义不变**：`enabledAbilities.browser` / `.extension` 继续双字段，映射到新包闸。
- **上限常量**：`MAX_TABS_PER_SESSION = 16`，不做配置。
- **策略三层分工不动**：site-policy 代码层硬护栏维持，不新增配置 UI；本次只动常量与归属，不动门控链语义。
- **双侧同步纪律不动**：nm-protocol / page-state 双副本、内嵌扩展共用门控链，均不改语义。
- **每步一个 commit**（message 写清做了什么，排除 package.json 版本 bump 与 tmp/）；既有测试断言同步更新，不新增单测。
