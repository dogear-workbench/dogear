---
step: 3
title: 屏障降级 + 骨架屏
status: done
---

## 目标
history 到达即渲染（不再等 attach snapshot 双齐）；加载期渲染骨架屏，消除纯空白。

## 依赖上下文（接力棒输入）
- 设计：`../session-ui-load-fix-design.md` 架构第 3、4 条
- 现状机制：hooks/useTranscriptState.ts:562-583 初始化屏障要求 init.history 与 init.snapshotEvents 双齐才 merge 渲染；:596 2s 定时器兜底；:661,716 timedOut 分支已支持后到方增量重建 merge；mergeHistorySnapshotCore（:187-215）
- 先例：输入区「正在检查话题状态…」（AgentChat.tsx:492-495）
- 关键决策回顾：history 是磁盘权威，先渲染；snapshot 后到走既有 timedOut 路径——实现上仅改 ready 判定条件；attach 失败不阻塞 history 渲染

## 计划改动
- [x] hooks/useTranscriptState.ts：ready 判定从「双齐」改为「history 到达即 ready」，snapshot 后到走 timedOut 式增量 merge；确认 2s 兜底与新逻辑不冲突（可保留为纯保险）
- [x] components/agent-chat/AgentChat.tsx：historyStatus === 'loading' 或屏障未 ready 时渲染骨架屏（轻量版：消息区占位若干条）
- [ ] 验证路径：程序创建的已停止长会话首次打开——骨架屏立即出现，history 到达即显示历史（不等 attach resume 完成）；运行中会话打开——history 先渲染，snapshot 后到无跳变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：timedOut 语义从「force 兜底触发」扩展为「ready 时仍有未到方」，使 snapshot 迟到统一复用既有 merge 重建路径；骨架屏条件额外排除 error 态（error 时屏障可能未 ready，避免与错误卡片同显）；useTranscriptState 新增响应式 initReady 暴露
- 改动文件清单：components/agent-chat/hooks/useTranscriptState.ts、components/agent-chat/AgentChat.tsx

### 给下一步的接力棒
- 关键签名 / 数据结构：UseTranscriptStateResult 新增 initReady: boolean（useState 承载，reset effect 与 finishInitialization 同步）；timedOut=true 含义为「ready 时 history/snapshot 有未到方，后到方走 merge 重建」
- 下个 step 该从哪里继续：本期三步已完成，剩余为验证路径实测与后续性能优化立项（见设计文档范围界定）
- 待办或已知限制：snapshot 迟到期间的本地乐观消息（pushLocalUser）会被迟到 merge 重建覆盖/替代，与既有 2s 超时路径行为一致，非本次引入；验证路径真机 UI 实测（长会话首开骨架屏→history 即渲染、运行中会话 snapshot 后到无跳变）未实跑，留给用户验收时确认，已由时序逻辑走查 + 13 项单测等价覆盖
