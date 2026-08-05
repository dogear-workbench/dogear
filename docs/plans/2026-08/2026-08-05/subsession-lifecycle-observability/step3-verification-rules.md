---
step: 3
title: 回放回归、验收与协作规则
status: pending
---

## 目标

用真实派遣场景验证生命周期完整性，并把子会话派遣的状态检查和跨层变更检查固化为规则。

## 依赖上下文（接力棒输入）

- 前置 step 产出：PiSession 有结构化终态；bridge 与 UI 可消费运行和终态快照。
- 当前工作区已有未提交的 `historyLoaded` 修正：`components/agent-chat/AgentChat.tsx:87` 取得历史加载状态，`:96` 传给 `useAgentSession`；`useMessageHistory.ts:88` 按 conversationId 防止旧历史串入。
- 用户已在当前运行版本验证新建普通会话并发送消息正常，无 `historyLoaded` 白屏。

## 计划改动

- [ ] 覆盖手动验收场景：子会话创建后不打开、执行中打开、执行完再打开、正式交付、未交付、模型错误、权限等待、用户停止、超时、父会话停止等待、快速切换会话和重启后冷加载。
- [ ] 对每个场景记录左侧行状态、父会话统计、子会话消息/错误、attachment 回收和 `listAllChildren` 快照是否一致。
- [ ] 对纯终态分类逻辑补充小范围自动化验证；不为 UI 流式细节引入与项目风格不符的大型测试框架。
- [ ] 运行 `bun run lint`、`bun run build:electron`、`bun run build`，区分既有 warning 和本次新增错误。
- [ ] 更新 `.claude/rules/session-runtime.md`：派遣后必须验证创建、首帧运行、消息回放、终态分类和资源释放；禁止把模型错误折叠为 no_delivery。
- [ ] 新建或扩展 `.claude/rules/data-lifecycle.md` 的跨层检查模板：状态变化需覆盖主进程、tipc、store、UI、冷启动和错误路径。
- [ ] 更新 `.claude/rules/codebase-map.md`，同步 PiSession、delegation bridge 与前端状态链路的实际入口。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
