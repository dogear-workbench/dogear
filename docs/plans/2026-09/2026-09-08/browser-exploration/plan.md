# 浏览器探索能力（站点档案 + 探索方法论）实施计划

**目标**：落地三层能力模型的欠账——站点档案机制（读/写/指针）、浏览器解析 Profile 方法论重构，并收口 P3 验收遗留（zhihu parser 修复、reddit/降级链验收、step5 文档）。设计全文见 [../browser-exploration-design.md](../browser-exploration-design.md)。

**架构思路**：约束层不动（site-policy/policyGate 已代码强制）；知识层新建 site-knowledge-service + `.dogear/site-knowledge/{domain}.md` 两区档案；探索层重写 Profile 描述为方法论。排除项（塞 Profile 描述 / 自动注入 / agent 直写正式地图）见设计文档拍板记录。

**涉及模块**：`electron/main/services/browser/site-knowledge-service.ts`（新建）、`serp-parsers`（zhihu 修复）、`electron/main/agents/tools/extension-tools.ts`、`electron/main/services/{settings-types.ts, settings-service.ts}`、`.dogear/site-knowledge/xiaohongshu.com.md`（新建）、`resources/browser-eval/`

## 步骤索引

- [x] [Step 1: B 段收口——zhihu 复测诊断修复 + reddit/降级链验收](./step1-b-segment-close.md) — 真机复测定根因（验证墙 vs 选择器），修 parser，跑完 reddit 与关 Clash 降级链（代码侧完成；登录后复测与关 Clash 验收待用户配合，见回填段）
- [x] [Step 2: site-knowledge-service 新建](./step2-site-knowledge-service.md) — 档案读/追加发现区/指针判断，纯代码 + node 冒烟
- [x] [Step 3: extension-tools +2 工具 + navigate 指针](./step3-tools-pointer.md) — site_knowledge / site_finding 工具与 navigate 返回指针
- [x] [Step 4: Profile 方法论重构 + 迁移 + 首批档案](./step4-profile-archive.md) — 描述重写 + 旧值迁移 + xiaohongshu.com.md 首批档案
- [ ] [Step 5: 收口——全量回归 + 方法论真机实测 + P3 step5 勾选 + doc-sync](./step5-acceptance.md) — 回归全绿 + 小红书一轮方法论实测（用户在场）+ 文档收口

## 全局决策

- **验证脚本一律 `node` 执行**（bun 跑 playwright 永久挂起，记忆 playwright-bun-incompatibility）
- **Profile description 变更必须迁移**：settings 存的是内置定义副本，deepMerge 保留旧值——「已知旧值 → 新值」迁移，先例 settings-service.ts:294（enabledAbilities 缺失键补全）
- **站点档案域名规范化**：小写、去 `www.` 前缀；读取截断 8KB；发现区单条 ≤500 字
- **read_state 工具描述不回填具体路径**（P3 原计划作废）：站点知识进档案，工具描述只写通用引导
- **错误处理**：一律 isError 中文文案不抛异常；无档案域名是正常态非错误
- 项目规范：不写注释（WHY 例外）；单文件 >300 行考虑拆分（extension-tools.ts 已 ~660 行，本计划 Step 3 顺手评估拆分）
