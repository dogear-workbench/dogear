# 浏览器探索能力（站点档案 + 探索方法论）实施计划

**目标**：落地三层能力模型的欠账——站点档案机制（读/写/指针）、浏览器解析 Profile 方法论重构，并收口 P3 验收遗留（zhihu parser 修复、reddit/降级链验收、step5 文档）。设计全文见 [../browser-exploration-design.md](../browser-exploration-design.md)。

**架构思路**：约束层不动（site-policy/policyGate 已代码强制）；知识层新建 site-knowledge-service + `.dogear/site-knowledge/{domain}.md` 两区档案；探索层重写 Profile 描述为方法论。排除项（塞 Profile 描述 / 自动注入 / agent 直写正式地图）见设计文档拍板记录。

**涉及模块**：`electron/main/services/browser/site-knowledge-service.ts`（新建）、`serp-parsers`（zhihu 修复）、`electron/main/agents/tools/extension-tools.ts`、`electron/main/services/{settings-types.ts, settings-service.ts}`、`.dogear/site-knowledge/xiaohongshu.com.md`（新建）、`resources/browser-eval/`

## 步骤索引

- [x] [Step 1: B 段收口——zhihu 复测诊断修复 + reddit/降级链验收](./step1-b-segment-close.md) — 真机复测定根因（验证墙 vs 选择器），修 parser，跑完 reddit 与关 Clash 降级链（代码侧完成；登录后复测与关 Clash 验收待用户配合，见回填段）
- [x] [Step 2: site-knowledge-service 新建](./step2-site-knowledge-service.md) — 档案读/追加发现区/指针判断，纯代码 + node 冒烟
- [x] [Step 3: extension-tools +2 工具 + navigate 指针](./step3-tools-pointer.md) — site_knowledge / site_finding 工具与 navigate 返回指针
- [x] [Step 4: Profile 方法论重构 + 迁移 + 首批档案](./step4-profile-archive.md) — 描述重写 + 旧值迁移 + xiaohongshu.com.md 首批档案
- [x] [Step 5: 收口——全量回归 + 方法论真机实测 + P3 step5 勾选 + doc-sync](./step5-acceptance.md) — 回归全绿；方法论真机实测需用户在场，本次无人值守跳过（遗留待办）；P3 真机清单按 2026-09-08 验收事实收口 + doc-sync

## 全局决策

- **验证脚本一律 `node` 执行**（bun 跑 playwright 永久挂起，记忆 playwright-bun-incompatibility）
- **Profile description 变更必须迁移**：settings 存的是内置定义副本，deepMerge 保留旧值——「已知旧值 → 新值」迁移，先例 settings-service.ts:294（enabledAbilities 缺失键补全）
- **站点档案域名规范化**：小写、去 `www.` 前缀；读取截断 8KB；发现区单条 ≤500 字
- **read_state 工具描述不回填具体路径**（P3 原计划作废）：站点知识进档案，工具描述只写通用引导
- **错误处理**：一律 isError 中文文案不抛异常；无档案域名是正常态非错误
- 项目规范：不写注释（WHY 例外）；单文件 >300 行考虑拆分（extension-tools.ts 已 ~660 行，本计划 Step 3 顺手评估拆分）

## 完成总结

五步全部完成，逐 step commit：step1 `6e78f22` / step2 `93c933d` / step3 `086a050` / step4 `6a4757f` / step5 本次由主会话 commit。三层架构落地一句话：约束层不动（site-policy/policyGate 维持代码强制）；知识层新建 site-knowledge-service（`.dogear/site-knowledge/{domain}.md` 正式地图 + 探索发现两区档案，读截断 8KB / 单条发现 ≤500 字 / 60s 去重）+ extension-site-tools.ts 两工具（site_knowledge/site_finding，deps 注入）+ navigate 返回站点档案指针；探索层 Profile description 重构为探索方法论（先取档案 → 观察 → 下钻 → 沉淀）+ LEGACY_BROWSER_PARSE_DESCRIPTIONS 三旧值迁移 + xiaohongshu.com.md 首批档案。

**关键发现（真机）**：zhihu/reddit 站内搜索均为未登录登录墙（zhihu 软墙服务端置空结果 / reddit 硬墙 302 → /login/），parser 无 bug，修复方向为降级文案 + 人工登录指引；Google 引擎 parser 失效（div.g 容器消失 + /goto URL 加密，勘察数据见共享区 step1-delivery.md）；Bing 无视 site: 语法，站内降级态加 urlMatchesDomain 域名过滤兜底。小红书 __INITIAL_STATE__ 字段路径真机探明（搜索卡片 search.feeds._value.{index} / 详情 note.noteDetailMap.{noteId}.note）进首批站点档案。

**自动化回归（step5 重跑全绿）**：lint 0 errors（99 warnings 存量）；tsc 0 错误；build:electron 通过；bun test 285 pass + 1 skip / 0 fail；node 冒烟 11 个全 PASS（site-policy 45 / extension-ownership 18 / observe-href 9 / nm-protocol 6 / nm-navigate 15 / nm-read-state 14 / nav-tracker 15 / stale-protocol 5 / profile-migration 11 / site-knowledge 26 / extension-site-tools 16）+ run-pipeline 27/27。

**遗留待用户**：重启 dogear app 生效新主进程代码；受控浏览器窗口人工登录知乎/Reddit 后复测站内搜索；关 Clash 降级链验收；方法论真机实测（本计划 step5 原定项，需用户在场）；DDG bot 挑战页人工过一次（选鸭子）。

**未决问题**：失败收敛 N=3 参数纯理论设定，待实战观察调整；Google 引擎修复需 URL 方案决策（挖 JS 内部状态不稳 vs 接受自动化环境不可用调整引擎链优先级）。
