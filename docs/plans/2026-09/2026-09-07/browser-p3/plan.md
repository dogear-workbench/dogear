# 浏览器 P3：扩展通道修复 + 站内搜索工具化 实施计划

**目标**：修复扩展通道三个实战硬伤（互踩/无 href/详情不可达），并给 search 加 reddit/zhihu 站内引擎（互动量排序 + 降级链）。

**架构思路**：A 段全部落在扩展通道现有管线上（工具层 gate + 协议双端加字段/kind + 通用 read_state 命令），不新增架构层；B 段在 browser-search-service 内加「站内引擎」与现有降级链并列。设计全文见 [../browser-p3-design.md](../browser-p3-design.md)。

**涉及模块**：`extension/src/{dom-actions.js, background.js, nm-protocol.js}`、`electron/main/services/browser/{nm-protocol.ts, browser-gateway.ts, browser-search-service.ts, browser-manager.ts}`、`electron/main/agents/tools/{extension-tools.ts, browser-tools.ts}`、`electron/main/services/{settings-types.ts, settings-service.ts}`、`resources/browser-eval/`

## 步骤索引

- [x] [Step 1: A1 扩展通道会话独占](./step1-channel-ownership.md) — 工具层 ownership gate 根治并行子会话互踩
- [x] [Step 2: A2 observe 透出 href](./step2-observe-href.md) — 链接元素序列化加绝对 URL，agent 可直链导航
- [x] [Step 3: A3 read_state 通用命令](./step3-read-state.md) — 读 SPA `__INITIAL_STATE__`，双模式 + 风控同待遇
- [x] [Step 4: B reddit/zhihu 站内搜索引擎](./step4-site-search.md) — search 加 site 参数 + PAC + `site:` 降级
- [x] [Step 5: 验收收口](./step5-acceptance.md) — 全量冒烟 + 真机验收清单 + doc-sync（真机清单已按 2026-09-08 验收收口：A 段全过，B 段登录墙环境因素遗留用户项，见文档）

## 完成总结

P3 五步全部完成并逐 step commit（e08bf33 / 7a95b82 / 263704a / f9f4b57 + 前置 f1c6cec）。A 段扩展通道三硬伤修复：独占 gate（不排队、断连清零、空闲 10min 释放）、observe 透 href（绝对 URL 直链导航）、read_state 通用命令（协议 v3、world:MAIN 注入、预算按 URL 去重）；B 段 search 加 site 参数（reddit/zhihu 站内引擎 + site: 降级链 + PAC reddit 系分流）。自动化验证全绿（9 冒烟 + pipeline 25/25 + bun test 286 + lint）。

**实施中的两个计划外生产级发现**：① __INITIAL_STATE__ 在页面主世界，扩展侧需 world:'MAIN' 注入（step3）；② patchright 的 page.evaluate 落隔离世界读不到页面脚本写入的 window 全局，知乎 state 读取改 CDP Runtime.evaluate 直连（step4，已沉淀记忆）。

**待用户执行**（2026-09-08 真机验收后收敛）：A 段已全过（扩展重载/独占 busy+空闲释放/observe href/详情可达，小红书字段路径已探明并进站点档案），遗留三项：①受控浏览器窗口人工登录知乎/Reddit 后复测站内搜索（登录墙环境因素，parser 无 bug）②关 Clash 降级链验收 ③重启 dogear app 生效新主进程代码。原「字段路径回填工具描述」按 2026-09-08 browser-exploration 计划设计变更调整为进站点档案（`.dogear/site-knowledge/xiaohongshu.com.md`）。

**已知限制**：releaseChannel 生产路径无调用方（释放靠空闲超时/断连）；知乎 state walk 通用启发式（真机验证逻辑正确，空结果系登录墙所致）；extension-tools.ts 已拆出 extension-site-tools.ts（site_knowledge/site_finding），主文件 715 行仍偏长可继续观察；patchright 升级需复测 CDP 路径；Google 引擎 parse_empty——`div.g` 容器失效（结果迁至 `#rso > div.MjjYud`）+ 标题链接改为 `/goto?url=<加密串>`（旧版 `/url?q=` 明文消失，ping 属性同样加密），勘察数据见 browser-exploration 计划共享区 step1-delivery.md，修复需 URL 方案决策。

## 全局决策

- **风控红线**：任何新工具过 policyGate（随机延迟）+ 风控关键词扫描 + 预算计数；不扩展现有预算语义（read_state 按页面 URL 计 1 次笔记）
- **协议双端同步**：`extension/src/nm-protocol.js` 与 `electron/main/services/browser/nm-protocol.ts` 语义一致；加 kind 必递增版本号（旧扩展收到 stale_protocol 引导重载）
- **错误处理**：一律 isError 中文文案，不抛异常（13+ errorCode 映射模式沿用）
- **内置 Profile 变更迁移**：settings 里存的是内置定义副本，deepMerge 保留旧值——description 变更必须做「已知旧值 → 新值」迁移（对齐 enabledAbilities 缺失键补全的先例，见 settings-service.ts:294）
- **验证脚本一律 `node` 执行**（bun 跑 playwright 永久挂起，见记忆 playwright-bun-incompatibility）；mock 页面必须带 `<meta charset="utf-8">`
- 项目规范：不写注释（WHY 例外）；单文件 >300 行考虑拆分
