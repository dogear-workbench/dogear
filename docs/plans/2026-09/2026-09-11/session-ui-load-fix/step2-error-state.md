---
step: 2
title: error 状态化 + 错误卡片
status: done
---

## 目标
历史读取失败不再静默清空成假空会话：状态区分 empty/error，error 渲染错误卡片 + 重试按钮。

## 依赖上下文（接力棒输入）
- 设计：`../session-ui-load-fix-design.md` 架构第 2 条
- 现状机制：hooks/useMessageHistory.ts:46-49 error 分支仅 console.error + loadHistory([])；AgentChat.tsx:407-409 空态文案只挡 loading 不挡 error
- 关键决策回顾：empty / error / loading 三态独立；error 卡片带重试（重新发起 getConversationHistory）；空态文案仅 empty 显示

## 计划改动
- [x] hooks/useMessageHistory.ts：history 状态机加 error 态（保留已有数据不清空）；暴露 retry
- [x] components/agent-chat/AgentChat.tsx：error 态渲染错误卡片（含原因摘要 + 重试按钮）；空态条件收紧为 empty
- [x] 验证路径：人为让 getConversationHistory 失败（如断点/坏文件）→ 消息区显示错误卡片而非「开始与 Agent 对话...」；点重试恢复

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。竞态机制用 loadIdRef 自增 id（retry 在 effect 外发起，需跨作用域失效）替代原 effect 内 cancelled 局部变量；实际路径在 components/agent-chat/hooks/ 下。错误卡片放提示区末尾、StableHistory 之前：error 时若已有旧数据，历史照常渲染 + 顶部错误卡片
- 改动文件清单：components/agent-chat/hooks/useMessageHistory.ts（加载逻辑抽为 loadHistoryFromDisk 供 effect/retry 共用；error 两分支不再 loadHistory([])；新增 historyError / retryHistory）、components/agent-chat/AgentChat.tsx（错误卡片 + 空态条件收紧为 ==='empty'）
- 验证：bun run lint 0 error；bunx tsc --noEmit 0 错误；逻辑走查（error 不清空/retry 竞态/切会话复位）通过；UI 人工验证（坏文件触发 error→卡片→重试）未实跑，step3 联调时一并确认

### 给下一步的接力棒
- 关键签名 / 数据结构：useMessageHistory 返回值新增 historyError: string | null、retryHistory: () => void；HistoryStatus 类型未变；loadHistory 引用稳定（useCallback 链），与屏障降级无耦合
- 下个 step 该从哪里继续：step3 骨架屏挂载点在 AgentChat.tsx 提示区（错误卡片同位置，historyStatus==='loading' 时渲染）；error→retry 回到 loading，skeleton 替代错误卡片属预期；屏障降级改 useTranscriptState.ts:562-583 附近
- 待办或已知限制：ok+空 messages 极端场景无空态文案（按「空态仅在 empty」决策未特殊处理）；UI 人工验证留给 step3 联调
