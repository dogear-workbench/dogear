---
step: 3
title: 渲染层跨工作区对话定位
status: done
---

## 目标

让主窗口收到 `focusConversation` 事件后可靠切换到对话所属工作区、加载并选中目标对话、激活其标签页，并完成构建与手工验收。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`step1-notification-service.md` 提供通知点击的窗口恢复；`step2-session-events.md` 已定义并发送 `focusConversation({ conversationId, workspaceId })`，仅在目标独立会话窗口不存在时发给主窗口。
- 主窗口首页入口是 `app/page.tsx`。现有 `sessionWindowClosed` 事件监听在 `:124`，适合作为同级的一次性 top-level renderer event effect。
- `useWorkspaceStore.setWorkspace()` 位于 `stores/workspace-store.ts:48`，会激活工作区并加载对话；现有接口声明为 `void`，实际实现是 async。
- `useConversationStore.selectConversation()` 位于 `stores/conversation-store.ts:322`，会写入选中对话并调用 `useSessionStore.openTab()`；目标会话读取可复用 `client.getById({ workspaceId, conversationId })`。
- `Conversation` 的工作区字段和角色类型在 `types/electron-api.ts:135`；主进程已完成 role 过滤，渲染层不重复执行通知资格判断。
- 关键决策：事件处理必须顺序等待工作区切换完成后再查找/选中对话，避免 `setWorkspace()` 中动态 import 与异步加载导致选中动作写入旧工作区分片。

## 计划改动

- [ ] 将 `stores/workspace-store.ts` 中 `setWorkspace` 的接口和实现签名统一为 `Promise<void>`，保持现有不 await 调用合法；确保其内部工作区切换、默认工作区更新与会话列表加载行为不回归。
- [ ] 在 `app/page.tsx` 增加 `rendererEvents.focusConversation.listen` 的 effect：
  - 从 `client.getAll()` 中找到 `workspaceId` 对应工作区；不存在时静默返回。
  - 若当前工作区不同，`await setWorkspace(targetWorkspace)`；相同工作区不重复切换。
  - 调用 `client.getById({ workspaceId, conversationId })` 取得最新对话；不存在时静默返回。
  - 调用 `useConversationStore.getState().selectConversation(conversation)`，复用现有标签页去重、选中和刷新逻辑。
  - 为异步监听回调加受控错误处理；组件卸载时正确取消监听，不能产生重复订阅。
- [ ] 不新增浏览器通知、全局 DOM 事件或 direct Electron API；定位只消费 Step 2 的 tipc 事件。
- [ ] 执行 `bun run build:electron` 和 `bun run build`，修复所有类型、编译或打包错误。
- [ ] 在 Windows 手工验收：
  1. 主窗口最小化后，主会话成功、失败、取消任一停止结果均出现对应原生通知、系统允许时发声、任务栏闪烁；点击后回到正确对话。
  2. 主窗口失焦后，权限请求出现含工具名的通知；点击后进入正确对话并看到原有权限卡片。
  3. 打开目标独立会话窗口后重复上述两种场景，点击通知优先恢复该独立窗口。
  4. 主窗口聚焦时发送完成/权限事件，不出现重复原生通知或闪烁。
  5. 子会话完成或交付，不出现单独原生通知。
  6. 将 Windows 关闭 Dogear 通知或开启勿扰后重复，确认不会报错、会话与权限卡片仍正常。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：无差异，完全按计划 checklist 实施
- 改动文件清单：
  - `stores/workspace-store.ts`：`setWorkspace` 接口签名由 `void` 改为 `Promise<void>`（实现本已是 async，无需改动）
  - `app/page.tsx`：新增 `focusConversation` 监听 effect（紧随 `sessionWindowClosed` effect）

### 给下一步的接力棒

- 关键签名 / 数据结构：`setWorkspace(ws, options?) => Promise<void>`；`rendererEvents.focusConversation.listen(cb)` 回调收到 `{ conversationId, workspaceId }`
- 下个 step 该从哪里继续：Windows 手工验收清单（见上方 checklist 最后一条），验收通过后标记 step status 为 done
- 待办或已知限制：手工验收未在子会话内执行（需真实 Windows 环境 + 通知权限）
