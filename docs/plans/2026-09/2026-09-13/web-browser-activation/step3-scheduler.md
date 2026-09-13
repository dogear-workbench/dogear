---
step: 3
title: 定时任务补齐
status: done
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
- [x] `electron/main/services/scheduler/plan-validate.ts` — KNOWN_TOOL_PACKS 加 `'browser'`、`'web-mcp'`
- [x] `electron/main/services/scheduler/custom-agent-tools.ts` — 加 `if (enabledPacks.has('web-mcp')) { toolDefs.push(...createWebMcpToolDefs({ fallbackHint: enabledPacks.has('browser') ? 'browser-tools' : 'none' })); }`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无差异，两处改动与计划完全一致；UI 零改动未动前端；无既有测试需修复（scheduler 目录无测试文件）
- 改动文件清单：
  - `electron/main/services/scheduler/plan-validate.ts:5-14` KNOWN_TOOL_PACKS 插入 `'browser'`、`'web-mcp'`（article 之后）
  - `electron/main/services/scheduler/custom-agent-tools.ts:11` 新增 `createWebMcpToolDefs` import；`:55-57` 新增 web-mcp 分支，fallbackHint 按 browser 包是否启用传 `'browser-tools' | 'none'`
- 验证：`bun run lint` 0 errors（改动文件无告警）；`bun run build:electron` 通过；详见共享区 step3-delivery.md

### 给下一步的接力棒
- 关键签名 / 数据结构：定时任务 override 路径现在接受 browser/web-mcp，白名单滤在 tipc/scheduler.ts:36 sanitizeToolPacksOverride 生效
- 下个 step 该从哪里继续：step4 前端总开关联动（AbilityTab.tsx handleTogglePack）
- 待办或已知限制：定时任务 fallbackHint 无 `'browser-subagent'` 态（定时任务无派遣能力，属预期）
