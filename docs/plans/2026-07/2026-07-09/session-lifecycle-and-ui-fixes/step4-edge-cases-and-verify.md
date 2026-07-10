---
step: 4
title: 边界收尾与手测验收
status: done
---

## 目标

收尾边界情况（app 退出清理、agent-monitor 展示、SubAgentPanel 图标一致性），走一遍完整验收清单，把设计文档里 3 个未决问题处理掉或明确留待未来。

## 依赖上下文（接力棒输入）

**必读 Step 3 的接力棒**（不要全读 Step 3 文档，只看回填的"接力棒"节）：
- 手测中发现的 edge case 问题
- app 退出清理是否已就绪
- SubAgentPanel / agent-monitor 页要不要展示保活会话

**设计文档留的 3 个未决问题**：
1. `hasActiveSession` IPC 是否必需（Step 2 已应该决定，本 step 复核）
2. 保活会话在 `app/agent-monitor/page.tsx` 的可见性
3. `SubAgentPanel.tsx` 头部的 Bot 图标是否一起改（Step 1 已应该处理，本 step 复核）

## 计划改动

### 4.1 app 退出时清理保活 session

- [ ] 检查 `electron/main/main.ts` 或 app 生命周期入口，`before-quit` / `will-quit` 事件里有没有清理逻辑
- [ ] 加：遍历所有活着的 `QueryBasedSession` 调 close()，确保子进程不泄漏
- [ ] 工作区切换也是一个隐性 quit：当前 workspace 关闭 → 该 workspace 下所有 session 都应 close
  - 定位 workspace 切换入口（`stores/workspace-store.ts` 或类似）
  - 加对应清理调用

### 4.2 agent-monitor 页面

- [ ] 打开 `app/agent-monitor/page.tsx` 看现状展示的是什么
- [ ] 决定：保活但无 tab 的 session 要不要显示？
  - 是 → 保持现状（agent-monitor 本来展示全部 worker/session，天然包含）
  - 否 → 过滤只显示有 UI 引用的
- **推荐**：保持现状全部显示 —— agent-monitor 本来就是"看后端在跑什么"的，隐藏保活 session 反而藏了信息

### 4.3 SubAgentPanel 图标复核

- [ ] 打开 `components/agent-chat/SubAgentPanel.tsx` 头部图标是否已在 Step 1 一起改成 `Workflow`
- [ ] 如未改，判断：这个面板是否只在 agent 派出的会话里出现？是 → 改 `Workflow`；否 → 保留 `Bot`
- [ ] 保持 LineageBar 里的 `CornerDownRight` 不动

### 4.4 完整验收清单

按顺序过一遍，任何一项失败回上一 step 修：

**问题 1 验收（列表刷新）**：
- [ ] 让主 agent 调 CreateSession 派子会话 → 左侧列表当场出现子会话行
- [ ] CreateSessionBatch 场景同样验证

**问题 2 验收（图标）**：
- [ ] agent 派出的会话在列表行显示 `Workflow` 图标（流程图样式）
- [ ] 微信 bot 绑定的会话仍显示 `Bot`（绿色），两者视觉可区分
- [ ] 分叉的会话仍是 `GitBranch`（紫色）

**问题 3 验收（生命周期 + 状态）**：
- [ ] 会话运行中关 tab → session 保活，列表行圆点仍亮
- [ ] 会话运行中关 tab → 重开 tab → 消息流续订，看到 agent 继续输出
- [ ] 会话 idle 时关 tab → session 被 GC，列表行圆点灭
- [ ] 关掉后重开 idle 会话 → 走 resume，看到完整历史
- [ ] 点 ChatInputArea 停止按钮 → 立即停止，圆点灭
- [ ] 关工作区 → 所有该工作区的 session 都被 close
- [ ] 退出 app → 无子进程泄漏（可以通过任务管理器或日志检查）
- [ ] 三处状态显示（tab 栏 / 列表行 / 聊天顶部）任何时刻都一致，不再有滞后

**问题 4 验收（AskUser 停止按钮）**：
- [ ] AskUserQuestion 卡片弹出时点"停止" → 卡片消失、pendingState → idle
- [ ] 停止后重新输入消息可以正常发出，agent 开新一轮

### 4.5 项目文档同步

- [ ] 修改了 store 结构（SessionTab 去掉 isStreaming）→ 可能需要更新 `.claude/rules/codebase-map.md` 里 `stores/session-store.ts` 的描述
- [ ] 修改了 QueryBasedSession 生命周期 → 更新 `.claude/rules/codebase-map.md` 里 Agent 框架章节的描述
- [ ] 若有新增 IPC 事件 → 更新 `renderer-handlers.ts` 描述
- [ ] 判断是否触发 doc-sync skill

### 4.6 `bun run lint` + `bun run build` 全通过

- [ ] lint
- [ ] build（含前端 Vite + 主进程 tsc）

## 实施回填

### 实际改动

**4.1 app 退出清理**
- 复核 `electron/main/index.ts:532-554` `before-quit` 已调 `shutdownQueryBasedSessionManager()` → `closeAll()` 遍历所有 session close 并清 refCount/cleanupCallbacks/conversationSessionMap。已就绪，未改代码。

**4.1 workspace 切换清理（用户拍板：跳过）**
- 与 plan 原文差异：plan 4.1 提到「workspace 切换 → 所有 session 都应 close」，与里程碑 1.5「Tab 跨工作区保留」设计冲突。用户选择「跑步机自然处理」——app 退出统一清理够用，日常 workspace 切换保留跑步机语义（idle GC / running 保活）。未改 workspace-store.ts。

**4.2 agent-monitor**
- 复核该页只监控 Worker 线程池状态（SUMMARIZE/DIGEST/REVIEW/CATEGORIZE 一次性任务），不涉及 QueryBasedSession。与本次改动无关，未改。

**4.3 SubAgentPanel 头部图标**
- `components/agent-chat/SubAgentPanel.tsx:1,220` `Bot` → `Workflow`，与列表行 agent 派出会话图标统一（LineageBar 里的 `CornerDownRight` 未动，符合原计划）。

**4.5 codebase-map.md 文档同步**
- `session-store.ts` 描述补「SessionTab 无 isStreaming 字段」
- `conversation-store.ts` 描述补两个 Set 唯一订阅源换到 sessionStateChanged/sessionClosed + 删乐观直写避免 race
- `query-based-session.ts` 描述补跑步机生命周期（retain/release 引用计数 + sessionClosed 原子事件 + sessionStateChanged 状态广播）
- `agent.ts` IPC 描述补 forceCloseQueryBasedSession（/clear 强杀路径）
- `renderer-handlers.ts` 描述补 sessionStateChanged / sessionClosed

**4.6 lint + build**
- `bun run lint`：0 errors，83 既存 warnings（同 Step 3 基线）
- `bun run build`：Vite + tsc(electron) 全过

### 与计划差异
- 4.1 workspace 切换清理：用户决策跳过（见上）。
- 4.2 agent-monitor：性质澄清后确认不涉及，无需改动。
- 4.4 完整验收清单：属于人工手测，交给用户走 golden path。

### 改动文件清单
- `components/agent-chat/SubAgentPanel.tsx`（icon 替换）
- `.claude/rules/codebase-map.md`（5 处描述更新）
- `docs/plans/2026-07/2026-07-09/session-lifecycle-and-ui-fixes/step4-edge-cases-and-verify.md`（本文件）
- `docs/plans/2026-07/2026-07-09/session-lifecycle-and-ui-fixes/plan.md`（打勾 + 完成总结）
