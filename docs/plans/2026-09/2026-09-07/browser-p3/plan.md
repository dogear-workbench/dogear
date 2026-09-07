# 浏览器 P3：扩展通道修复 + 站内搜索工具化 实施计划

**目标**：修复扩展通道三个实战硬伤（互踩/无 href/详情不可达），并给 search 加 reddit/zhihu 站内引擎（互动量排序 + 降级链）。

**架构思路**：A 段全部落在扩展通道现有管线上（工具层 gate + 协议双端加字段/kind + 通用 read_state 命令），不新增架构层；B 段在 browser-search-service 内加「站内引擎」与现有降级链并列。设计全文见 [../browser-p3-design.md](../browser-p3-design.md)。

**涉及模块**：`extension/src/{dom-actions.js, background.js, nm-protocol.js}`、`electron/main/services/browser/{nm-protocol.ts, browser-gateway.ts, browser-search-service.ts, browser-manager.ts}`、`electron/main/agents/tools/{extension-tools.ts, browser-tools.ts}`、`electron/main/services/{settings-types.ts, settings-service.ts}`、`resources/browser-eval/`

## 步骤索引

- [x] [Step 1: A1 扩展通道会话独占](./step1-channel-ownership.md) — 工具层 ownership gate 根治并行子会话互踩
- [ ] [Step 2: A2 observe 透出 href](./step2-observe-href.md) — 链接元素序列化加绝对 URL，agent 可直链导航
- [ ] [Step 3: A3 read_state 通用命令](./step3-read-state.md) — 读 SPA `__INITIAL_STATE__`，双模式 + 风控同待遇
- [ ] [Step 4: B reddit/zhihu 站内搜索引擎](./step4-site-search.md) — search 加 site 参数 + PAC + `site:` 降级
- [ ] [Step 5: 验收收口](./step5-acceptance.md) — 全量冒烟 + 真机验收清单 + doc-sync

## 全局决策

- **风控红线**：任何新工具过 policyGate（随机延迟）+ 风控关键词扫描 + 预算计数；不扩展现有预算语义（read_state 按页面 URL 计 1 次笔记）
- **协议双端同步**：`extension/src/nm-protocol.js` 与 `electron/main/services/browser/nm-protocol.ts` 语义一致；加 kind 必递增版本号（旧扩展收到 stale_protocol 引导重载）
- **错误处理**：一律 isError 中文文案，不抛异常（13+ errorCode 映射模式沿用）
- **内置 Profile 变更迁移**：settings 里存的是内置定义副本，deepMerge 保留旧值——description 变更必须做「已知旧值 → 新值」迁移（对齐 enabledAbilities 缺失键补全的先例，见 settings-service.ts:294）
- **验证脚本一律 `node` 执行**（bun 跑 playwright 永久挂起，见记忆 playwright-bun-incompatibility）；mock 页面必须带 `<meta charset="utf-8">`
- 项目规范：不写注释（WHY 例外）；单文件 >300 行考虑拆分
