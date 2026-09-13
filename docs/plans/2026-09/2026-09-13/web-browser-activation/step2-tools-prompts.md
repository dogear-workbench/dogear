---
step: 2
title: 工具与提示词层
status: pending
---

## 目标
web-mcp 工具描述按会话实际能力三态化；新增联网调研分工引导段（主/子两版）；pi-session 完成子会话 web-mcp 挂载、描述传参、段拼装。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-types-registry.md] `enabledAbilities.web` 类型已落地，resolveAbilities 已按 Profile 细闸过滤 web-mcp 包（sub 侧 `activeAbilities.has('web-mcp')` 即代表 profile.web===true 且包总闸开）
- 当前关键文件状态：
  - `electron/main/agents/tools/web-mcp-tools.ts` `createWebMcpToolDefs()` 现无参，两个工具描述末尾硬编码「改用 dogear__browser__*」
  - `electron/main/agents/session-append-templates.ts:11` `SystemPromptSegmentKey` 联合类型；`:106` `getSystemPromptSegments()` 登记表
  - `electron/main/agents/pi-session/pi-session.ts:561-568` 段拼装区（`activeAbilities.has('memory')` 等 push 模式）；buildMainAgentToolDefs 的 OPTIONAL_TOOL_PACKS 循环（web-mcp case 在 :680）；buildSubAgentToolDefs 的 browser/extension 挂载区（:780-788）
- 关键决策回顾：主会话 hasBrowser = `activeAbilities.has('browser') && this.config.enabledToolPacks.includes('browser')`（与挂载一致防死链）；子会话 = `activeAbilities.has('browser')`；子会话描述禁提「派子会话」

## 计划改动
- [ ] `electron/main/agents/tools/web-mcp-tools.ts` — `createWebMcpToolDefs(opts: { fallbackHint: 'browser-tools' | 'browser-subagent' | 'none' })`；webSearch/webReader 描述尾段按三态生成：browser-tools 保留现有文案；browser-subagent 改「深度阅读/翻页/登录墙场景建议派『浏览器解析』子会话（profile: browser-parse）」；none 删去浏览器指引只留快档定位
- [ ] `electron/main/agents/session-append-templates.ts` — SystemPromptSegmentKey 加 `'web-research-guidance'`；新增 `WEB_RESEARCH_GUIDANCE_MAIN_APPEND`（快档直查 bigmodel__webSearch/webReader 不派会话 → 深度浏览/翻页拼接/登录态派浏览器解析子会话 → 纯本地代码调研派普通子会话、不占浏览器独占通道）与 `WEB_RESEARCH_GUIDANCE_SUB_APPEND`（两行：快档优先 webSearch/webReader，需渲染/交互/登录态用 dogear__browser__*）；getSystemPromptSegments 登记主版（触发条件：web-mcp 或 browser 包任一生效，仅主会话）
- [ ] `electron/main/agents/pi-session/pi-session.ts` — 三处：① buildMainAgentToolDefs 的 web-mcp case 传 fallbackHint（browser-subagent / browser-tools）；② buildSubAgentToolDefs 加 `if (activeAbilities.has('web-mcp')) registerPack('web-mcp', createWebMcpToolDefs({ fallbackHint: hasBrowser ? 'browser-tools' : 'none' }))`；③ 段拼装区按 role 分别 push 主版/子版（条件：web-mcp 或 browser 任一生效）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
