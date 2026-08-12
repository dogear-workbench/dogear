---
step: 2
title: Surface 核心协调器 + phase 边沿检测
status: pending
---

## 目标
新增 `WindowsAgentIslandSurface`，接收状态机产出的 snapshot，维护 prevSnapshot 做 phase 转移边沿检测，为后续 Step 3/4/5 提供统一的 onSnapshot 入口。这一步是纯逻辑层，可完全单元测试。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-gate-split.md] pushState() 已调用 `publishWindowsAgentIslandSnapshot(snapshot)`，snapshot 类型是 `NativeAgentIslandSnapshot`
- snapshot 结构：`packages/shared/src/types/agent-island.ts` 定义。关键字段：
  - `state.sessions[]` — 每个含 `sessionId` / `phase` / `detail` / `title` / `interactionKind` / `attention` / `unread`
  - `state.pill` — 含 `priorityStatus` / `sessionCount` / `activeSessionCount` / `pendingInteractionCount` / `unreadCompletedCount`
- phase 枚举：`'idle' | 'running' | 'needs-interaction' | 'completed' | 'error'`
- 优先级：`getAgentIslandPhasePriority()` 在 `agent-island-priority.ts:8-13`

## 计划改动

### 1. `apps/electron/src/main/lib/windows-agent-island-surface.ts`（新增）

核心结构：
```typescript
interface PhaseTransition {
  sessionId: string
  from: AgentIslandPhase
  to: AgentIslandPhase
  title: string
  detail: string
  interactionKind?: AgentIslandInteractionKind
}

// 纯函数：对比 prev 和 curr snapshot，返回需要通知的 phase 转移
export function detectPhaseTransitions(
  prevSessions: Map<string, AgentIslandPhase>,
  curr: NativeAgentIslandSnapshot
): PhaseTransition[]

// 协调器类
class WindowsAgentIslandSurface {
  private prevSnapshot: NativeAgentIslandSnapshot | null = null
  private prevPhases: Map<string, AgentIslandPhase> = new Map()

  onSnapshot(snapshot: NativeAgentIslandSnapshot): void {
    // 1. 检测 phase 转移边沿
    // 2. 更新托盘图标（Step 3 接入）
    // 3. 触发通知（Step 4 接入）
    // 4. 推送悬停窗（Step 5 接入）
    // V1: console.log 打印 transitions，验证逻辑正确
  }

  // Step 3/4/5 注入的回调（V1 都是 no-op）
  onTrayUpdate?(pill: PillSnapshot): void
  onNotification?(transition: PhaseTransition): void
  onHoverWindowUpdate?(snapshot: NativeAgentIslandSnapshot): void
}
```

边沿检测规则（只通知有意义的转移）：
- `running → needs-interaction` — 通知
- `running → completed` — 通知
- `* → error`（attention=true）— 通知
- `needs-interaction → running` — 不通知（用户已响应）
- 新会话直接出现在 `needs-interaction`/`completed`/`error` — 通知
- `running → running`（detail 变了）— 不通知（节流已处理）
- 会话从 snapshot 消失 — 不通知

### 2. `apps/electron/src/main/lib/agent-island-service.ts`
- [ ] `publishWindowsAgentIslandSnapshot` 占位函数改为调用真正的 surface 实例

### 3. 测试：`apps/electron/src/main/lib/windows-agent-island-surface.test.ts`（新增）
- [ ] running→completed 产生 1 个 transition
- [ ] running→needs-interaction 产生 1 个 transition
- [ ] running→error 产生 1 个 transition
- [ ] running→running（detail 变化）不产生 transition
- [ ] needs-interaction→running 不产生 transition
- [ ] 新会话直接 completed 产生 transition
- [ ] 多会话各自独立检测（A 完成 + B 报错 → 2 个 transition）
- [ ] 会话从 snapshot 消失不产生 transition
- [ ] 空 snapshot → 有会话的 snapshot：只 running 不通知，needs-interaction/completed/error 通知
- [ ] 相同 snapshot 重复传入不产生 transition

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- `WindowsAgentIslandSurface` 的实例化位置和回调注入方式：
- `PhaseTransition` 类型的最终定义：
- `detectPhaseTransitions` 的签名：
- 下个 step 该从哪里继续：
