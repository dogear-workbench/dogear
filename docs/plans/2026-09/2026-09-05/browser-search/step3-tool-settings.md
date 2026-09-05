---
step: 3
title: 工具注册 + 设置项 + 设置 UI
status: done
---

## 目标

`dogear__browser__search` 工具正式注册进 browser 工具组，代理与引擎两个设置项落地（types/service/UI），search 权限确认不进 ask 集合。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-search-service.md] `searchWeb(query, opts)` 已可用，签名见其回填
- 当前关键文件状态：`agents/tools/browser-tools.ts` 用 `registerToolGroup` 注册工具组（readArticle 在 293 行附近是声明式工具参照）；`services/settings-types.ts` / `settings-service.ts` 是设置项落点；`agents/pi-session/permission-rules.ts` 的 BROWSER_INTERACTIVE_TOOLS 是 ask 集合
- 关键决策回顾：search 不进 BROWSER_INTERACTIVE_TOOLS（只读高频）；不新增能力开关，跟随 browser 能力域；step1 若 PAC 用了占位常量，这里换正式设置项

## 计划改动

- [ ] `agents/tools/browser-tools.ts`：注册 `dogear__browser__search`，zod schema（`query: string` 非空、`maxResults` 可选 1-15），成功返回文本化结构（engine/results/degradations），失败 `isError: true` 并提示原子工具降级路径（navigate + observe_page）
- [ ] `services/settings-types.ts` + `settings-service.ts`：`browserProxyServer?: string`（空 = 禁用代理引擎）、`browserSearchEngine: 'auto' | 'google' | 'bing'`（默认 auto），normalize 幂等
- [ ] browser-manager 代理参数从设置项正式读取（替换 step1 占位）；browser-search-service 引擎配置接设置项
- [ ] 设置 UI：浏览器小节——代理地址输入（占位提示 `127.0.0.1:7890`）+ 默认引擎下拉（auto/google/bing，附一句说明「auto = 代理可用时用 Google」）；落点对齐现有设置 tab 结构，实施时挑最贴近的位置
- [ ] 验证：`permission-rules.test.ts` 跑过（search 不在 ask 集合，无需改断言，确认不破坏）；`bun run build:electron` + lint；dev 里手动调一次工具确认设置生效链路

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `browserProxyServer` 非法类型（非 string）normalize 时直接 delete 而非置空串，与「缺省 = 禁用代理」语义统一；空串/含空格的值原样保留（不改用户数据），trim 由消费方（buildProxyPacUrl / buildEngineChain）做。
  2. PAC 地址拼接前 strip `"` 和 `\\`（防设置值破坏 PAC 内嵌 JS）。
  3. 设置 UI 落点选在「基础设置」tab 主题块之后、BasicToolsSection 之前（新「受控浏览器」小节）；渲染层独立类型 `types/settings.ts` 同步加字段（该文件与主进程 settings-types.ts 平行维护）。
  4. 工具失败文本：empty_query/parse_empty 的 message 已含建议文案，不重复追加原子工具降级提示；其余 errorClass 统一追加 navigate + observe_page 降级提示。
  5. permission-rules.test.ts 增补断言：search 加入 browserPackMap 与「只读工具随包放行」用例（确认不在 ask 集合）。
- 改动文件清单：
  - `electron/main/services/settings-types.ts`：BrowserSearchEngine 类型 + AppSettings.browserProxyServer?/browserSearchEngine + DEFAULT_SETTINGS.browserSearchEngine='auto'
  - `electron/main/services/settings-service.ts`：normalizeSettings 校验引擎值域（非法回 auto）+ 非法 proxy 类型删除（幂等）
  - `electron/main/services/browser/browser-manager.ts`：删 BROWSER_PROXY_SERVER 常量；buildProxyPacUrl(proxyServer?) 空值返回 null；launch() 读 loadSettings 传参；buildLaunchOptions 空值跳过 --proxy-pac-url
  - `electron/main/agents/tools/browser-tools.ts`：注册 dogear__browser__search（工具 2，readArticle 之后；后续工具编号顺延）；forwardSearchAction（source='search'）；BrowserToolsAction 并入 SearchAction
  - `types/settings.ts`（渲染层）：同步两字段 + 默认值
  - `app/settings/page.tsx`：基础设置 tab 新增「受控浏览器」小节（代理输入框 placeholder 127.0.0.1:7890 + 引擎下拉 auto/google/bing）
  - `electron/main/agents/pi-session/permission-rules.test.ts`：search 加入工具包放行断言
- 验证：bun run build:electron ✓；bun run lint 0 errors（改动文件无 warning）✓；bun test permission-rules 20/20 ✓；node run-pipeline.mjs 20/20 PASS（空代理设置 = 不注入 PAC 下全过）✓；临时 node 脚本（编译产物）验证设置链路 13/13（默认值/读取/幂等/非法回退/落盘清理）✓；临时 node 脚本端到端：loadSettings → searchWeb 真实起浏览器（无 PAC）→ auto 走「直接 Bing」→ 真实搜索 8 条 ✓；bun run dev 冒烟无 ERROR ✓。验证脚本已清理。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `AppSettings.browserProxyServer?: string`（空/缺省 = 仅 Bing）、`AppSettings.browserSearchEngine: 'auto'|'google'|'bing'`（normalize 幂等，非法回 auto）
  - 工具层：`searchWeb(query, { engine: settings.browserSearchEngine, maxResults, proxyServer: settings.browserProxyServer, taskMeta, onAction: forwardSearchAction })`；serpUrls 未透传
  - browser-manager：launch 时读设置；PAC 仅 google/ddg 六域分流，设置改后下次浏览器实例启动生效（空闲 3min 自动重启窗口期）
- 下个 step 该从哪里继续：step4（动作流/伴随面板接入 setBrowserToolsActionListener 的话，search 事件 source='search'，action 取值 navigate/wait/observe/parse，与 readArticle 同构）
- 待办或已知限制：显式引擎 google/bing 下拉未提供 ddg 单选项（设计拍板，service 支持）；真实 Bing 搜索冷门词偶见返回非精确匹配内容页（搜索引擎自身行为，与解析层无关）
