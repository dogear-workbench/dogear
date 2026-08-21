---
step: 2
title: 焦点联动与切换器降级
status: done
---

## 目标

点 tab 不再「先切整个工作区」（删除 handleTabClick 的跨工作区分支），改为纯 `switchTab`；焦点联动（activeTabId 变化 → 左右面板同步到焦点会话工作区）并入 conversation-store 底部现有订阅，保证「先切工作区、后高亮」时序。顶部切换器由此降级为「临时浏览」（只换左侧列表，不动焦点会话）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-chat-workspace-decouple.md] AgentChat 三 hooks 已用 tab.workspaceId——联动触发的 `setWorkspace` 不会再打断已挂载会话（这是先做 Step 1 的原因）
- 关键现状签名：
  - `components/WorkspaceTabBar.tsx` `handleTabClick`：`tab.workspaceId !== currentWorkspaceId` 时 `client.getAll()` 找目标 → `setWorkspace(targetWs)` → `switchTab`；找不到则 toast「目标工作区不存在」并 return（本步整体删除该分支）
  - `stores/conversation-store.ts` 底部（`if (typeof window !== 'undefined')` 块内）现有订阅：
    ```ts
    useSessionStore.subscribe((state, prev) => {
      if (state.activeTabId !== prev.activeTabId) {
        useConversationStore.getState().focusConversationById(state.activeTabId);
      }
    });
    ```
  - `useWorkspaceStore.setWorkspace(workspace, { skipSetDefault? })`：内部 activateWorkspace（同步切分片镜像）+ setDefault + loadWorkspaceFiles + loadConversations（后两者 fire-and-forget）
  - `focusConversationById(conversationId)`：分片找不到时 `client.getById` 兜底（需浏览工作区已同步）
  - `useSessionStore.getTab(conversationId)` / `HOME_TAB_ID = '__home__'`（哨兵，getTab 返回 undefined）
- 关键决策回顾：联动放 conversation-store 订阅而非 page.tsx effect，与高亮联动同处单点维护时序；`setWorkspace` 保持 setDefault（「最后活跃工作区 = 下次启动默认」）

## 计划改动

- [ ] `components/WorkspaceTabBar.tsx`：`handleTabClick` 删成一行 `switchTab(tab.conversationId)`；删掉 `client` / `toast` 相关 import（若无他用）与 `currentWorkspaceId`（若无他用）
- [ ] `stores/conversation-store.ts` 底部订阅改造：
  ```ts
  useSessionStore.subscribe((state, prev) => {
    if (state.activeTabId === prev.activeTabId) return;
    const tabId = state.activeTabId;
    void (async () => {
      const { useWorkspaceStore } = await import('./workspace-store');
      const { client } = await import('@/lib/client');
      const tab = useSessionStore.getState().getTab(tabId);
      const currentWsId = useWorkspaceStore.getState().workspace?.id;
      if (tab?.workspaceId && tab.workspaceId !== currentWsId) {
        try {
          const { workspaces } = await client.getAll();
          const target = workspaces?.find(w => w.id === tab.workspaceId);
          if (target) await useWorkspaceStore.getState().setWorkspace(target);
        } catch (err) { console.error('[焦点联动] 切换工作区失败:', err); }
      }
      useConversationStore.getState().focusConversationById(tabId);
    })();
  });
  ```
  注意：`HOME_TAB_ID` 时 getTab 为 undefined → 跳过联动直接 focus（与现状一致）；`@/lib/client` 若文件顶部已 import 则直接用
- [ ] 快速连点竞态自查：两次订阅触发各自 async，后者用 getState 读最新值判断；`setWorkspace` 内 activateWorkspace 同步切镜像，最终一致。确认 focusConversationById 在 loadConversations 未完成时走 getById 兜底（`stores/conversation-store.ts` 的 focusConversationById 实现已有）
- [ ] `bun run lint` + 手动验证

## 验收清单

- [ ] 顶部切到 B：左侧列表变 B、右侧焦点会话（A 的 tab）不动、右栏文件树变 B（浏览语义）
- [ ] 点 B 列表会话：焦点 tab 切到它，左右已是 B（联动无操作，路径相等）
- [ ] 点回 A 的 tab：左侧列表+右栏文件树自动同步回 A，左侧高亮落在该会话所在话题（先切后高亮时序正确）
- [ ] 点首页 tab：行为与现状一致（无联动、列表不变）
- [ ] 同工作区点 tab：高亮联动正常（回归）
- [ ] 连续快速点两个不同工作区的 tab：最终左右与最后一个 tab 一致，无报错
- [ ] Step 1 的验收项复测一遍（联动频繁触发 setWorkspace 的场景）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：三点写法说明（零实质偏离）
  1. `client` 直接用顶部已有 import，未动态 import（step 文档已预告此写法）
  2. `await client.getAll()` 后加一行复查 `useSessionStore.getState().activeTabId !== tabId` 则 return——快速连点两个跨工作区 tab 时旧订阅的 getAll 晚返回会覆盖新焦点的工作区，此复查是验收项「最终左右与最后一个 tab 一致」的直接保障（step「竞态自查」条目的落地，非扩大改动面）
  3. `getTab(tabId)` 前置 `tabId ?` 判空：`activeTabId: string | null` 直传 `getTab(conversationId: string)` 会类型报错
- 改动文件清单：`components/WorkspaceTabBar.tsx`（handleTabClick 删成同步一行 + 删 `useWorkspaceStore` import 与 `currentWorkspaceId`；`client`/`toast` 因关闭/弹出功能保留）、`stores/conversation-store.ts`（底部订阅 async 化，+21/-28）
- 竞态自查结论（step 要求项）：
  - **时序铁律成立**：`setWorkspace` 内 `activateWorkspace`（同步切分片镜像）+ `set({workspace})` 均在首个 `await client.setDefault` 之前同步完成，故 `await setWorkspace` 返回时 focusConversationById 的 getWorkspace 必读到新工作区；loadConversations fire-and-forget 未完成时分片为空 → focusConversationById 走既有 getById 兜底
  - **快速连点**：两次订阅各自 async；getAll 后的 activeTabId 复查让旧订阅在焦点已变时放弃 setWorkspace+focus；若两次复查都通过（真并发 setWorkspace），`await import` 微任务 FIFO 保证后发起的 activateWorkspace 后执行覆盖 → 最终全局 = 最后点击的工作区
  - **残余已知限制**：并发窗口内两个 setDefault IPC 完成顺序不定 → 极端情况下「下次启动默认工作区」可能记为先点的（仅影响启动默认，不影响 UI 一致性）；旧订阅晚到的 focusById 在新工作区查旧 tab → getById 失败 → 静默保持原选中，无副作用
  - **首页 tab**：getTab(HOME_TAB_ID)=undefined → 跳过工作区联动直接 focus('__home__') → getById 失败保持原选中，与现状一致
  - **真删工作区**：getAll 找不到 target → 静默不切不 toast → 高亮保持，符合设计「错误处理 3」
- lint：0 errors / 74 warnings（全存量 no-explicit-any，与 Step 1 基线一致）；tsc 13 处存量错误均不在本次两文件（git diff 确认相关文件无未提交改动）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `WorkspaceTabBar.handleTabClick` 现为同步 `(tab: SessionTab) => { switchTab(tab.conversationId); }`
  - conversation-store 底部订阅（stores/conversation-store.ts:878 起）：`activeTabId` 变化 → async：`getTab(tabId)` → 需要时 `getAll` + 复查 activeTabId + `await setWorkspace(target)` → `focusConversationById(tabId)`——先切后高亮唯一入口，点 tab/关 tab 自动切/独立窗口收回全走这里
  - `setWorkspace(workspace, { skipSetDefault? })`：activateWorkspace+set 同步在前、setDefault await 在中、loadWorkspaceFiles/loadConversations fire-and-forget 在后
- 下个 step 该从哪里继续（按设计模块边界推断为跨工作区引用链路）：`stores/reference-store.ts` 补 `workspaceId` 字段 → `ConversationRow` 引用按钮存入 → `WorkspaceExplorer`/`AdditionalFilesPanel` 引用校验（≠焦点 tab.workspaceId → toast 拒绝）→ `useSendMessage.ts:368` 标签带 `workspaceId` 属性 → 后端 `reference-tools.ts`/`session-append-templates.ts`（后端改完记得 `bun run build:electron`）
- 待办或已知限制：手动验收 7 项（含 Step 1 复测）需主会话跑 dev 人工验证；并发 setDefault 顺序小概率残留（见上）；「话题面板跟随焦点会话 groupId 精确定位」设计标注为未来扩展未做
