---
step: 3
title: 自定义任务类型 CUSTOM_AGENT
status: done
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
  - 工具包开关实际在 workspace config（`enabledToolPacks`），AppSettings 无此字段：可选包（article/stock-*）改读 `.dogear/workspaces/<id>/config.json`（safeJsonRead 直读，不 import 带 electron 的 workspace-config-service）
  - 记忆 + 报告工具恒装（tool-packs.ts 将其归为常驻、设计决策 4 点名为产物通道；收紧只需删 custom-agent-tools.ts 两行）
  - 不装 Bash；basicToolPermissions 是交互式确认语义，headless 不用
  - `buildCustomToolSet(workspaceId, workspacePath, configDir)`（签名按真实开关来源调整）
  - runOnce 成功返回扩展 `lastText?/usage?`（向后兼容，供 summary/tokens）
  - 股票链 worker-safe 修复（计划外必要前置）：5 个 stock 服务 getConfigDir 前置 DOGEAR_CONFIG_DIR；python-bridge constructor `app?.on` 等四处守卫 + getPythonDir 走 DOGEAR_PYTHON_DIR；agent-manager 注入 DOGEAR_PYTHON_DIR
  - workspacePath 不存在 error 文案中文 `工作区路径不存在: <path>`
- 改动文件清单：
  - 新增 `electron/main/agents/tools/workspace-file-tools.ts`（Read/Write/Edit，workspace 边界）
  - 新增 `electron/main/services/scheduler/custom-agent-prompt.ts`
  - 新增 `electron/main/services/scheduler/custom-agent-tools.ts`
  - 修改 `electron/main/agents/task-types.ts`（TaskType.CUSTOM_AGENT + CustomAgentTaskPayload）
  - 修改 `electron/main/agents/pi/run-once.ts`（lastText/usage 提取）
  - 修改 `electron/main/agents/agent-worker.ts`（handleCustomAgentTask + 分发）
  - 修改 `electron/main/services/scheduler/runtime/task-executor.ts`（删本地占位，改正式类型）
  - 修改 `electron/main/agents/agent-manager.ts`（worker env 注 DOGEAR_PYTHON_DIR）
  - 修改 `electron/main/services/stock/{stock-data,stock-watchlist,announcement,financials-cache,formula}-service.ts` + `python-bridge.ts`（worker-safe）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 结果结构：成功 `{ ok:true, summary?(≤500字), tokens?{inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens}, tier, profileName }`；失败 `{ ok:false, error }`；取消 `{ ok:false, error:'已取消', cancelled:true }`（worker 任务状态 COMPLETED+ok:false，task-executor 映射 failed，已实测）
  - `buildCustomToolSet(workspaceId, workspacePath, configDir): Promise<ToolDef[]>`；`buildCustomAgentPrompt(payload): { systemPrompt, prompt }`
  - `runOnce` 成功分支新增 `lastText?: string` / `usage?: RunOnceUsage`（口径同 accumulatePiUsage）
  - worker env 新增 `DOGEAR_PYTHON_DIR`（主进程预计算打包态 python 目录）
- 下个 step 该从哪里继续：
  - step4：scheduler-service tick/条件事件 → `getPlanRunner().runPlan`；missed 用 appendHistoryEntry(kind:'missed')；自定义链路已全通无需再动
- 待办或已知限制：
  - maxTurns=30；summary 依赖模型遵守末尾自述提示词（缺省留空不算失败）
  - Electron 打包态 DOGEAR_PYTHON_DIR 注入路径未实测（开发态逻辑已验）；真模型 API 未跑（mock 到模型 API 层，工具/映射全真实验证）
  - worker 内 python-bridge 无 will-quit 钩子，靠 idleTimer 收尾
  - agent-worker.ts 1416 行，后续加任务类型建议拆 handler 文件
