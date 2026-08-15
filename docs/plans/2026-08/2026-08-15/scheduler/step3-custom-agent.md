---
step: 3
title: 自定义任务类型 CUSTOM_AGENT
status: pending
---

## 目标

agent-worker 新增 CUSTOM_AGENT handler：按 payload 组装系统提示词与工具集（按设置过滤），走 pi runOnce 执行自定义 prompt，返回结果摘要与 token 用量。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step2 的 `runCustomTask` 调用点与 payload 组装（以其实施回填为准）
- 现有四条 pi 任务的 handler 参考：`electron/main/agents/agent-worker.ts` 的 `handleGroupDigestTask` / `handleReviewSessionTask` / `handleCategorizeSessionTask`——工具组装用 `pi/tool-adapter.ts` 的 `toPiTools`，模型解析用 `pi/provider.ts` 的 `resolvePiModel(appSettings, selection, ...)`，执行用 `pi/run-once.ts` 的 `runOnce({ systemPrompt, prompt, tools, model, profile, signal })`
- 现有权限/工具包配置读取：`agent-query-config.ts` 的 `buildQueryBaseConfig` 读 appSettings；工具包开关与 `basicToolPermissions` 的具体字段执行时查 `types/settings.ts` 与 `electron/main/services/settings-service.ts`
- 工具定义源：文件工具（带 workspace 边界）参考 `pi-session/builtin-tools.ts` + `workspace-boundary.ts` 的做法（Worker 线程内要能独立构造，执行时确认哪些函数可在 Worker 侧 import）；扩展工具（股票/记忆/报告）看 `agents/tools/` 目录各文件的 defineTool 用法
- 关键决策回顾：模型 payload.modelSelection ?? settings.defaultModelSelection，不完整返回明确 error 不抛异常；产物 agent 自己写；工具集按设置过滤，缺省基础文件工具

## 计划改动

- [ ] `electron/main/agents/task-types.ts`：`TaskType.CUSTOM_AGENT = 'custom_agent'` + `CustomAgentTaskPayload { taskName: string; prompt: string; modelSelection?: ModelSelection; workspaceId: string; workspacePath: string }`
- [ ] 新建 `electron/main/services/scheduler/custom-agent-prompt.ts`：`buildCustomAgentPrompt(task, workspacePath)` — 系统提示词模板（角色：定时任务执行 agent；工作区路径与边界说明；产物用工具自己写文件/报告/记忆；一次性任务不问询直接执行；输出末尾附一段 200 字内结果自述作为 summary 来源）
- [ ] 新建 `electron/main/services/scheduler/custom-agent-tools.ts`：`buildCustomToolSet(appSettings, workspacePath)` — 基础文件工具（Read/Write/Edit/Glob/Grep，workspace 边界校验）恒装；扩展工具（股票行情/分析/公告、记忆 Recall/Save、报告 Write/Read）按 appSettings 工具包开关逐个过滤；返回 pi 格式工具数组（ Worker 侧组装，避免依赖渲染层）
- [ ] `agent-worker.ts` 加 `handleCustomAgentTask(task)`：
  - 校验 workspacePath 存在，不存在返回 `{ ok: false, error: 'workspace not found' }`
  - `resolvePiModel(appSettings, payload.modelSelection ?? appSettings.ai.defaultModelSelection)`，解析失败返回明确 error
  - `runOnce` 执行（AbortController 接 cancelTask，对齐现有 handler 的取消模式；maxTurns 参考现有值）
  - 结果：`{ ok, summary（assistant 最后文本截 500 字）, tokens（若 runOnce/usage 事件可提取，提取不到置 undefined）, error? }`
- [ ] step2 的 `runCustomTask` 对齐此结果结构写历史条目（status = ok ? 'completed' : 'failed'，summary/error/tokens 落条目）

## 验证

- `bun run build:electron` 通过
- 临时脚本或开发模式：提交一个自定义任务「在工作区根目录写 scheduler-test.txt，内容 hello」，确认文件产出、result.summary 非空、任务结果状态 completed
- 取消路径：运行中 cancelTask 能中断（对齐现有 cancel 模式即可）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
