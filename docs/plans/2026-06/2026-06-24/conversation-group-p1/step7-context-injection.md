---
step: 7
title: 组概况注入 system prompt
status: pending
---

## 目标

新会话启动时（或 resume 时）自动把"组概况 + 共享区文件清单 + 组级 digest 摘要（如果有）"追加到 system prompt。**目标控制在 500 token 以内，详情靠 Step 6 的工具按需读**。完成后用户能感受到"上下文延续"——新建会话天然知道组里有什么。

## 依赖上下文（执行时填）

- 前置 step 产出：[step1] group-service.getGroup；[step4] group-shared-service.listNativeFiles + listReferences；[step6] 工具已注入，agent 能按需读
- 当前关键文件状态：执行前读 `electron/main/agents/query-based-session.ts`（构造 systemPrompt 的位置，preset + append 模式）/ `electron/main/agents/agent-query-config.ts`（query 配置构建器）
- 关键决策回顾：
  - "轻注入 + 工具深挖" —— 概况内容 + 文件清单（带 1 行描述）+ digest 摘要（如果存在），不放全文
  - P1 阶段**没有组级 digest**（设计文档 Phase 3 才做），所以摘要部分缺省即可
  - systemPrompt 走 preset+append 模式（query-based-session 已有约定）

## 计划改动

### 新工具函数
- 新增 `electron/main/agents/group-context-builder.ts`：
  - `buildGroupContextPrompt(workspaceId: string, groupId: string): Promise<string>`
  - 内部组装：
    ```
    ## 当前会话组上下文

    **组**：<title 或 "未命名组（创建于 <时间>）">
    （未来如有 group.description / digest summary 在这里放，P1 阶段缺省）

    **共享区原生文件**：（前 20 个，按 mtime 倒序）
    - `notes.md` (2.3KB, updated 5min ago)
    - `subtask-analysis.md` (1.1KB, ...)

    **共享区引用文件**：（前 20 个）
    - `<workspace相对路径>` <label?>

    需要查看这些文件的详情请使用 ListGroupFiles / ReadGroupFile 工具。
    ```
  - 文件超过 20 个时只列 20 个 + "... 还有 N 个"
  - 文件名/路径过长截断
  - 估算 token 数（粗估 chars/4），超过 500 时进一步压缩列表
  - 返回拼好的字符串（如果 group 不存在或获取失败，返回空字符串而不是抛错）

### 接入 query-based-session
- 修改 `electron/main/agents/query-based-session.ts`：
  - session 创建/resume 时调 `buildGroupContextPrompt(workspaceId, groupId)`
  - 拼接到 systemPrompt 的 append 部分（在用户自定义 system prompt / persona prompt 之**后**——确保 agent 看到组上下文优先级最高）
  - 如果 conversation 没有 groupId（理论上 Step 1 后不该出现，做兜底）则跳过注入

### 文件变化追踪（可选轻量）
- P1 不做"实时刷新组上下文"——session 一旦启动 systemPrompt 固定，后续共享区文件变化不会自动反映
- 后续优化方向：会话存活期间共享区文件变化通过工具调用让 agent 现读，或下次发消息时重建 systemPrompt
- 当前接受"启动时快照"语义即可

## 验证

- `bun run build:electron` / `bun run lint` 通过
- `bun run dev` 启动后：
  - 在某组里新建会话，发一条消息"我们这个组有什么文件"
  - agent 直接根据 systemPrompt 里的清单回答出来（无需调工具就能列出）
  - 让 agent 读某个文件，agent 调 `ReadGroupFile` 拿到内容
  - 删掉某个共享区文件，开**新会话**——新会话的 systemPrompt 反映最新状态
  - 共享区一个文件都没有时，注入部分有合理的"暂无共享内容"文案
  - 估算 token 数符合预期（手动看一下 prompt 长度，控制在 500 以内）

## 实施回填（做完后填）

### 实际改动

### 给下一步的接力棒（也是 P1 完成的总结）
- buildGroupContextPrompt API：
- systemPrompt 拼接位置：
- 已知边界（如启动后不刷新）：
- P2 / P3 前需要注意的事：
