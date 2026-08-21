# 工作区切换与会话解耦 实施计划

**目标**：切换工作区对已挂载会话零事件（agent 不被打断、不误报删除）；tab 跨工作区并存；焦点会话决定左右面板；支持跨工作区会话引用。

**架构思路**：AgentChat 三个 hooks 的 workspaceId 来源从全局 store 改为 tab 携带（props 传入，缺省回落全局）；焦点联动并入 conversation-store 底部 activeTabId 订阅（先切工作区后高亮）；右栏零改动靠联动天然同步；引用链路补 workspaceId 透传。详见设计文档：`../workspace-session-decouple-design.md`。

**涉及模块**：`components/agent-chat/`（AgentChat + 3 hooks）、`app/page.tsx`、`app/session-window/page.tsx`、`components/WorkspaceTabBar.tsx`、`stores/conversation-store.ts`、`stores/reference-store.ts`、`components/conversation-list/ConversationRow.tsx`、`components/agent-chat/hooks/useSendMessage.ts`、`components/WorkspaceExplorer.tsx`、`components/AdditionalFilesPanel.tsx`、`electron/main/agents/tools/reference-tools.ts`

## 步骤索引

- [x] [Step 1: AgentChat workspaceId 解耦](./step1-chat-workspace-decouple.md) — 三个 hooks 改用 tab 携带的 workspaceId，消除切换误判与 detach
- [x] [Step 2: 焦点联动与切换器降级](./step2-focus-linkage.md) — 点 tab 直接 switchTab，联动由订阅接管（先切工作区后高亮）
- [x] [Step 3: 跨工作区会话引用](./step3-cross-ws-reference.md) — 引用标签带 workspaceId，ReadReferenceSession 支持指定工作区
- [x] [Step 4: 临时态文件引用校验](./step4-ref-guard.md) — 浏览工作区 ≠ 焦点工作区时拦截右栏文件引用

## 全局决策

1. **workspaceId 缺省回落**：三个 hooks 统一 `workspaceId ?? 全局 store` 写法，debug 页等不传 props 的调用点零破坏；tab 场景 effective 值恒为 tab.workspaceId，全局变化不触发 effect 重跑
2. **tab.workspaceId 是唯一权威来源**（openTab 时写入，运行期不变）
3. **联动时序铁律**：`activeTabId` 变化 → 先 `await setWorkspace(目标)` → 后 `focusConversationById`，不得颠倒（否则高亮用旧工作区查会话丢失）
4. **后端改动后必须 `bun run build:electron`**（Vite 热重载只对前端生效）
5. 不写单测，按各 step 的验收清单手动验收
6. 引用校验提示文案统一：`该文件属于其他工作区，无法引用到当前会话`（附当前焦点会话所属工作区名）
7. 遇到设计未覆盖的边界：记入 step 文档「实施回填」，不擅自扩大改动面

## 完成总结（2026-08-21）

四个 step 全部实施完成，提交链：Step 1 `3a7d085` → Step 2 `a1b165f` → Step 3 `c1c7884` → Step 4（见 git log）。

- **达成效果**：切换工作区对已挂载会话零事件（不误报「此话题已删除」、不 detach 杀 agent）；tab 跨工作区并存；焦点会话驱动左右面板同步（先切工作区后高亮）；跨工作区会话引用全链路透传 workspaceId；临时态文件引用 toast 拒绝
- **代码级验收**：每 step diff 与计划比对吻合、无越界改动、lint 0 errors（74 warnings 全存量）、涉及后端的 Step 3 已 build:electron
- **待人工终验**（需重启应用）：设计文档「验收路径」四条全链路 + 各 step 验收清单（关键场景：A 跑长任务切 B 再回、临时态跨工作区引用会话可读原文、临时态右栏文件引用被拒、同工作区引用回归）
- **遗留决策点**：文章引用（WorkspaceExplorer toggleReferenceArticle）临时态未拦——step4 计划列表未含，补拦只需一行 guard 前置，待拍板
- **已知限制**（设计标注未来扩展，均未做）：引用芯片 UI 无工作区徽标；话题面板 currentGroupId 跨工作区 tab 时为 null；sessionRestartTrigger 全局广播保持现状
