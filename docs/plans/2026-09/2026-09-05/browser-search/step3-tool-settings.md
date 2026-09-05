---
step: 3
title: 工具注册 + 设置项 + 设置 UI
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
