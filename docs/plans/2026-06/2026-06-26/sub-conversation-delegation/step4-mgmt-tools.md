---
step: 4
title: 主会话管理工具（StopChild + ListChildren + SendMessageToChild + DelegateBatch）
status: done
---

## 目标

把闭环周边的 4 个管理工具补上，让主会话能批量派发、列状态、停子会话、追加消息。bridge 主要方法 Step 2 已经有了，本步只是写工具壳子。

## 依赖上下文（接力棒输入）

- Step 3 完成：核心闭环跑通；`dogear-delegation` MCP server 内已有 DelegateTo + WaitForDeliveries；按 role 注入机制就绪
- bridge 已有：`stopChild(childId)` / `getChildrenByParent(parentConversationId)` / `getChildSnapshot(childId)`
- 给 sub conversation 追加消息走现有 pendingMessages 机制（QueryBasedSession 已支持，参考 useSendMessage 怎么 push）；bridge 需要新加一个 `sendMessageToChild(childId, message)` helper 桥到那个机制

## 计划改动

### 1. `electron/main/agents/delegation-bridge.ts`
- 新加方法：
  - `sendMessageToChild(childId, message): Promise<void>`
    - 校验 childStates 有该 child 且 status='running'
    - 通过 QueryBasedSession（或 agent-manager）的"插话/追加消息"接口把 message push 到该 child 的 pendingMessages
    - 具体接入点：找 `query-based-session.ts` 哪里 expose 了 push 方法，bridge 调它
    - 找不到现成方法的话——bridge 维护 `childId → QueryBasedSession 引用` 的 map（startChild 时拿到 session 引用存进来）

### 2. `electron/main/agents/tools/delegation-tools.ts`
- 在同一个 MCP server 内追加 4 个工具：
  - `StopChild` — schema `{ childId: string }`
    - 校验 child 属于当前 parentConversationId（防止跨主会话 stop 别人的）
    - 调 `bridge.stopChild(childId)`
    - 返回 `✅ 已停止 {childId}（{title}）` 或 `⚠ 子会话已是 {status} 状态，无需停止`
  - `ListChildren` — schema `{}`
    - 调 `bridge.getChildrenByParent(parentConversationId)`
    - 格式化成易读 text：每行 `{status emoji} {childId} {title} — {outputPath} ({startedAt 相对时间})`
    - 末尾 footer：`共 N 个，{running 数} running / {done 数} done / ...`
  - `SendMessageToChild` — schema `{ childId: string, message: string }`
    - 校验同上
    - 调 `bridge.sendMessageToChild`
    - 返回 `✅ 已追加消息到 {childId}（子会话将在下一轮回应中处理）`
  - `DelegateBatch` — schema `{ items: Array<{ task, outputPath, title? }> }`
    - **原子校验**：先把所有 items 的 outputPath 用 dry-run 检查（增加 bridge 一个 `previewClaim(workspaceId, groupId, relPaths): { ok: true } | { ok: false; conflicts: string[] }` 纯函数，不真的占用）
    - 任何一个冲突 → 全部 reject，工具返回 isError + 冲突列表
    - 全部 ok → 顺序调 bridge.startChild N 次（每次都重新 claim，理论上不会冲突；如果中途任意一次失败——回滚已 start 的，stopChild + release）
    - 返回 `✅ 已批量派出 N 个子会话\n- {childId1} → {outputPath1}\n- ...`

### 3. `electron/main/agents/delegation-bridge.ts` 补充
- 加 `previewClaim(workspaceId, groupId, relPaths: string[]): { ok: true } | { ok: false; conflicts: string[] }`
  - 纯检查不修改 pathClaims map
  - 返回所有冲突路径（不是遇到第一个就 return，方便 agent 一次性知道）

### 4. 清理 Step 2 留的临时调试 IPC
- 此时整个核心 + 管理工具栈都能通过真实 agent 调用了，可以删除 `__debug` 系列 IPC

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测：
  1. 主会话："派 3 个子会话给我分别写 a.md / b.md / c.md 的内容大纲" → 应调 DelegateBatch 一次性派出
  2. 主会话："列出你派的所有子会话" → ListChildren 返回 3 个 running
  3. 主会话："给 child_xxx 追加一条消息：请只写 100 字" → SendMessageToChild
  4. 主会话："停掉 child_yyy" → StopChild，再 ListChildren 应看到 cancelled
  5. DelegateBatch 冲突：让 agent 派两个相同 outputPath 的 → 应整个失败
- 关闭主会话 tab 不应影响子会话继续跑（子会话独立 conversation）

## 实施回填

### 实际改动

**与计划差异**：
- `previewClaim` 的"纯函数"语义最终放到 `group-shared-service.ts`（它持有 `pathClaims` map + 知道 `sharedDir`），`bridge.previewClaim` 是个纤瘦的转发壳。理由：避免 bridge 反向访问 service 私有状态、保持 pathClaims map 单一所有者。
- `previewClaim` 额外做了"批内重复"检查（同一批 items 写同一 outputPath 也算冲突），错误信息里把"占用方"标成 `batch[N]`，方便 agent 区分"真冲突"vs"自己重复写"。
- 没有实现「`childId → QueryBasedSession 引用` map」——`sessionId` 已经存在 `ChildStateInternal` 里，`sendMessageToChild` 直接走 `getQueryBasedSessionManager().getSession(c.sessionId)` 查一次即可。
- Step 3 的回填已声明 `__debug` IPC 已删，本步无须再清理。

**改动文件清单**：
- `electron/main/services/group-shared-service.ts` L131-187：新增 `PreviewClaimConflict` 类型 + `previewClaim(workspaceId, groupId, relPaths)` 异步纯检查（文件存在 + 已被 claim + 批内重复 三类）
- `electron/main/agents/delegation-bridge.ts` L386-405：新增 `sendMessageToChild(childId, message)` + `previewClaim(workspaceId, groupId, relPaths)` 两个对外方法
- `electron/main/agents/tools/delegation-tools.ts`：
  - L7-12：registerTools 追加 4 项元数据
  - L14-32：新增 `statusEmoji` + `formatRelative` 两个工具内 helper
  - L135-280：在原 server 内追加 4 个 tool 定义（DelegateBatch / ListChildren / StopChild / SendMessageToChild）

### 给下一步的接力棒

- **`bridge.sendMessageToChild` 接入方式**：通过现有 `getQueryBasedSessionManager().getSession(c.sessionId)`，无额外 map；调 `session.sendMessage(message)`，走原生 pendingMessages 队列
- **DelegateBatch 中途失败回滚**：顺序 `startChild`，记录 `started[]`；任一失败 → `Promise.all(started.map(stopChild(_, 'cancelled')))`（每个 catch 吞掉避免级联），返回 isError + 失败 item 索引 + 已回滚数量
- **StopChild 与 cancelled 状态时 waitState 处理**：`bridge.stopChild` 已会调 `resolveWaitsIfReady()`，把 cancelled 当 terminal 状态处理；调用方 WaitForDeliveries 会立刻 resolve 该 child 为 cancelled 结果（不会等到 timeout）
- **`previewClaim` 校验粒度**：返回所有冲突项（不短路），方便 agent 一次性看清；批内重复 holder 标成 `batch[N]`
- **ListChildren 输出格式**：emoji + childId + title + outputPath + 相对时间，末尾 `小计：N status / ...`，对纯文本流友好
- **已知坑 / 待办**：
  - DelegateBatch 中"任一拉起失败"回滚时，已 `wireSession` 但未发任务的子会话会被 stopChild 标 cancelled —— 这是预期的；但若失败发生在 `sendMessage` 之后（极少见，sendMessage 是 fire-and-forget），stopChild 会 interrupt 那个已开跑的 session，也属预期
  - SendMessageToChild 拿不到子会话的"队列长度"反馈（追加后不知道前面还有几条没消化）——Step 6 列表 UI 可以做角标暴露
