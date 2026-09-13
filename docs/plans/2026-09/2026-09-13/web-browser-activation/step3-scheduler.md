---
step: 3
title: 定时任务补齐
status: pending
---

## 目标
定时任务（CUSTOM_AGENT）可选 browser / web-mcp 工具包，web-mcp 分支接入三态描述。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-tools-prompts.md] `createWebMcpToolDefs` 签名已变为 `(opts: { fallbackHint })`
- 当前关键文件状态：
  - `electron/main/services/scheduler/plan-validate.ts:5` `KNOWN_TOOL_PACKS` 现仅 article + stock 四项（sanitizeToolPacksOverride 按白名单滤，browser/web-mcp 均被滤掉）
  - `electron/main/services/scheduler/custom-agent-tools.ts:48` buildCustomToolSet 已有 browser 分支（`enabledPacks.has('browser')`）；无 web-mcp 分支
  - UI 零改动依据：`listToolPacks`（tipc/agent.ts:476）走 `OPTIONAL_TOOL_PACKS`（services/tool-packs.ts:42，browser/web-mcp 均已登记），CustomToolPacksSection 自动列出
- 关键决策回顾：定时任务无派遣能力，fallbackHint 只有 browser-tools / none 两态可用

## 计划改动
- [ ] `electron/main/services/scheduler/plan-validate.ts` — KNOWN_TOOL_PACKS 加 `'browser'`、`'web-mcp'`
- [ ] `electron/main/services/scheduler/custom-agent-tools.ts` — 加 `if (enabledPacks.has('web-mcp')) { toolDefs.push(...createWebMcpToolDefs({ fallbackHint: enabledPacks.has('browser') ? 'browser-tools' : 'none' })); }`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
