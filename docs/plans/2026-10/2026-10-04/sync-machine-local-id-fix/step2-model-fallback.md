---
step: 2
title: 恢复会话的模型解析回退
status: done
---

## 目标

恢复（restore）已有会话时 `modelSelection` 引用本机不存在的 profile/tier 不再导致 attach 失败，并顺带消灭「模型缺失被包装成会话历史文件缺失」的误导性报错。

## 依赖上下文（接力棒输入）

- 现状：`PiSession.start()`（`electron/main/agents/pi-session/pi-session.ts:328`）在 `repository.open` 成功后调 `resolvePiModel(appSettings, this.config.modelSelection, null, appSettings.ai.defaultModelSelection)`（:344-348）；`resolvePiModel` 对未知 profileId/tier 直接 throw（`electron/main/agents/pi/provider.ts:75/82`）。
- `conversation-runtime-service.ts:126-132` 把 `session.start()` 的一切异常包装成「会话历史文件缺失或损坏，无法恢复会话」（`isRestore=true` 分支）——模型错误也会被误标。
- 数据事实：当前工作区 151 条会话的 `modelSelection` 引用本机不存在配置（GLM-5.2×121、gpt-5.6-terra×13、profileId 缺失×17），Step 1 完成后它们会在 `resolvePiModel` 处失败。

## 计划改动

- [ ] `electron/main/agents/pi-session/pi-session.ts` start() 的模型解析段：包 try/catch——仅当 `this.config.harnessSessionId` 存在（恢复场景）且首次解析用的是 `this.config.modelSelection` 时，回退 `resolvePiModel(appSettings, null, …)`（即 defaultModelSelection）并 `this.logger.warn` 记录原选择与回退原因；新建会话（无 harnessSessionId）维持抛错（新会话模型缺失应显式报错）。
- [ ] 回退后 `this.currentModelSelection` 应置为实际生效的默认选择（后续 UI 展示一致）。
- [ ] （可选，顺手）`conversation-runtime-service.ts:130` 的包装文案仅在 error 为 SessionError（not_found/invalid_session）时使用，其余原样抛出——避免其他异常再被误标为文件损坏。

## 验证

- `bun run build:electron` 后重启 app：点开一条 `modelSelection` 失效的会话（可先 `grep GLM-5.2` conversations.json 找 id）→ 不报错、历史正常载入、输入框模型显示默认模型。
- 新建会话不受影响：把默认模型配置临时清空的场景不在本步范围。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。isRestore 在 start() 入口（repository 调用前）记录，因 create 分支会同步回填 harnessSessionId，事后无法区分；回退条件同时要求 this.config.modelSelection 非空（首次解析即用 defaultModelSelection 时失败说明默认也坏，回退无意义，维持抛错）。可选项（包装文案收窄）一并做了。
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session.ts`（start() 模型解析包 try/catch，恢复场景回退 defaultModelSelection + logger.warn；currentModelSelection 跟随实际生效选择）
  - `electron/main/services/conversation-runtime-service.ts`（「会话历史文件缺失或损坏」文案仅在 SessionError not_found/invalid_session 时使用，其余原样抛出）

### 给下一步的接力棒
- 关键签名 / 数据结构：resolvePiModel(appSettings, selection, subAgentFallback, fallback) 对未知 profileId/tier 直接 throw 不变；回退仅发生在 pi-session.ts start() 层。
- 下个 step 该从哪里继续：Step 3 同步层，merge-records.ts mergeWorkspacesFile + apply.ts 落地重写。
- 待办或已知限制：数据事实复核（2026-10-04 实测）：conversations.json 1167 条中 GLM-5.2×121、gpt-5.6-terra×13、profileId 缺失×186、tier 失效×13，回退生效面与计划一致；重启 app 点开失效会话验证（人工）。
