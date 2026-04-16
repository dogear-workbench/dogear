# UI 改进实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 7 项 UI 改进：运行状态指示器、空状态引导、Ctrl+Enter 快捷键、ScrollArea、设置 Tabs、多会话标签页、标题编辑/排序

**Architecture:** 按优先级从低复杂度到高复杂度分步实施。P0 改动（指示器、快捷键、移除标题、标题编辑）可独立完成。P1 改动（ScrollArea、空状态、设置 Tabs）依赖 shadcn 组件添加。P2（多会话标签页）是最大的架构改动，需新建 session-store。

**Tech Stack:** React 19, Zustand 5, shadcn/ui + Radix UI, lucide-react, @headless-tree/react, Tailwind CSS 4

---

## Task 1: 运行状态指示器（底部）

**Files:**
- Create: `components/agent-chat/StreamingIndicator.tsx`
- Modify: `components/agent-chat/AgentChat.tsx:155-156`

**Step 1: 创建 StreamingIndicator 组件**

创建 `components/agent-chat/StreamingIndicator.tsx`：

```tsx
import { Loader2 } from 'lucide-react';

interface StreamingIndicatorProps {
  isLoading: boolean;
  lastBlockType?: string;
}

export function StreamingIndicator({ isLoading, lastBlockType }: StreamingIndicatorProps) {
  if (!isLoading) return null;

  const label = lastBlockType === 'thinking'
    ? '正在思考...'
    : lastBlockType === 'tool_use'
      ? '正在执行工具...'
      : '正在生成...';

  return (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
```

**Step 2: 在 AgentChat 中集成指示器**

修改 `components/agent-chat/AgentChat.tsx`：

在导入区（第 2 行后）添加：
```tsx
import { StreamingIndicator } from './StreamingIndicator';
```

在第 154-156 行之间（plan 按钮之后、messagesEndRef 之前）插入：
```tsx
        {/* 运行状态指示器 */}
        <StreamingIndicator
          isLoading={isLoading}
          lastBlockType={
            messages[messages.length - 1]?.contentBlocks?.slice(-1)[0]?.type
          }
        />
```

**Step 3: 验证**

Run: `bun run dev:renderer`
预期：发送消息后，消息列表底部出现"正在生成..."旋转指示器，AI 回复完成后消失。

**Step 4: Commit**

```bash
git add components/agent-chat/StreamingIndicator.tsx components/agent-chat/AgentChat.tsx
git commit -m "feat: 添加消息底部运行状态指示器"
```

---

## Task 2: Ctrl+Enter 快捷键

**Files:**
- Modify: `components/agent-chat/hooks/useSendMessage.ts:297-303`
- Modify: `components/agent-chat/ChatInputArea.tsx:295-322`

**Step 1: 修改 handleKeyPress 逻辑**

修改 `components/agent-chat/hooks/useSendMessage.ts` 第 297-303 行：

```tsx
  // 键盘事件处理：Ctrl+Enter 发送，Enter 换行
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };
```

**Step 2: 在发送按钮旁添加快捷键提示**

修改 `components/agent-chat/ChatInputArea.tsx`，在发送按钮区域（约第 311-321 行）的发送按钮后面添加快捷键提示。

将当前发送按钮：
```tsx
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled={(!input.trim() && pendingImages.length === 0) || !isSessionReady}
                    title="发送"
                  >
                    <Send size={14} />
                  </InputGroupButton>
```

改为（添加 title 提示）：
```tsx
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled={(!input.trim() && pendingImages.length === 0) || !isSessionReady}
                    title="发送 (Ctrl+Enter)"
                  >
                    <Send size={14} />
                  </InputGroupButton>
```

**Step 3: 验证**

Run: `bun run dev:renderer`
预期：
- Enter 键在 textarea 中换行
- Ctrl+Enter（Mac 上 Cmd+Enter）发送消息
- 发送按钮 hover 提示 "发送 (Ctrl+Enter)"

**Step 4: Commit**

```bash
git add components/agent-chat/hooks/useSendMessage.ts components/agent-chat/ChatInputArea.tsx
git commit -m "feat: 改为 Ctrl+Enter 发送消息，Enter 换行"
```

---

## Task 3: 移除固定标题

**Files:**
- Modify: `app/page.tsx:141-159`

**Step 1: 移除"对话列表"和"AI 助手"标题**

修改 `app/page.tsx`，删除第 141-144 行（对话列表标题）：
```tsx
          {/* 删除这段 */}
          <div className="p-3 border-b">
            <h2 className="text-sm font-semibold">对话列表</h2>
          </div>
```

删除第 157-159 行（AI 助手标题）：
```tsx
          {/* 删除这段 */}
          <div className="p-3 border-b">
            <h2 className="text-sm font-semibold">AI 助手</h2>
          </div>
```

**Step 2: 验证**

Run: `bun run dev:renderer`
预期：左侧对话列表直接显示内容（已有内部工具栏），中间 AI 助手区域直接显示聊天内容，释放约 80px 垂直空间。

**Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: 移除对话列表和 AI 助手的固定标题栏，释放垂直空间"
```

---

## Task 4: 对话标题可编辑

**Files:**
- Modify: `components/BookConversationList.tsx:241-250`
- Modify: `stores/conversation-store.ts`

**Step 1: 在 ConversationTreeItem 中添加内联编辑**

修改 `components/BookConversationList.tsx`。

首先在导入区添加（约第 3 行）：
```tsx
import { Pencil } from 'lucide-react';
```

在 `ConversationTreeItem` 组件内（约第 140 行），添加编辑状态：
```tsx
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
```

需要在文件顶部导入中确认 `useState` 已导入。

需要从 conversation-store 获取 `updateConversationTitle` action（确认 store 中有此方法，如没有需要添加）。

替换第 241-250 行的标题显示区域为：
```tsx
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                className="text-sm w-full bg-transparent border-b border-primary outline-none px-0 py-0"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const finalTitle = editTitle.trim() || getConversationTitle(conv);
                    updateConversationTitle(conv.id, finalTitle);
                    setIsEditing(false);
                  }
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                  }
                }}
                onBlur={() => {
                  const finalTitle = editTitle.trim() || getConversationTitle(conv);
                  updateConversationTitle(conv.id, finalTitle);
                  setIsEditing(false);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className={cn('text-sm truncate',
                isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-foreground'
              )}>
                {getConversationTitle(conv)}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {getRelativeTime(conv.updated_at)}
            </div>
          </div>
          {/* 编辑按钮 — hover 时显示 */}
          {!isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setEditTitle(getConversationTitle(conv));
                setIsEditing(true);
              }}
            >
              <Pencil className="w-3 h-3" />
            </Button>
          )}
```

**Step 2: 在 conversation-store 中添加 updateConversationTitle action**

修改 `stores/conversation-store.ts`，在 `ConversationState` 接口中添加方法签名：
```tsx
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;
```

在 store 实现中添加：
```tsx
    updateConversationTitle: async (conversationId, title) => {
      const workspace = get().conversations.length > 0
        ? useWorkspaceStore.getState().workspace
        : null;
      if (!workspace) return;

      await client.updateTitle({ workspaceId: workspace.id, conversationId, title });

      // 更新本地状态
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, title } : c
        ),
        selectedConversation: state.selectedConversation?.id === conversationId
          ? { ...state.selectedConversation, title }
          : state.selectedConversation,
      }));
    },
```

**Step 3: 验证**

Run: `bun run dev:renderer`
预期：
- hover 对话项时，标题右侧出现铅笔图标
- 点击铅笔图标，标题变为可编辑的 input
- Enter 保存、Escape 取消、失焦保存
- 空标题回退为自动生成标题

**Step 4: Commit**

```bash
git add components/BookConversationList.tsx stores/conversation-store.ts
git commit -m "feat: 支持对话标题内联编辑"
```

---

## Task 5: 添加 ScrollArea 组件

**Files:**
- Create: `components/ui/scroll-area.tsx` (via shadcn CLI)
- Modify: `components/agent-chat/AgentChat.tsx:93`
- Modify: `components/BookConversationList.tsx` (scrollRef 容器)
- Modify: `app/settings/page.tsx:137`

**Step 1: 安装 shadcn scroll-area 组件**

Run: `bunx shadcn@latest add scroll-area`

如果 CLI 不可用，手动创建 `components/ui/scroll-area.tsx`（标准 Radix ScrollArea 封装）。

**Step 2: 替换 AgentChat 消息列表滚动区域**

修改 `components/agent-chat/AgentChat.tsx`。

导入：
```tsx
import { ScrollArea } from '@/components/ui/scroll-area';
```

将第 93 行的 `<div className="flex-1 overflow-y-auto">` 和对应的 `</div>`（第 157 行）替换为：
```tsx
      <ScrollArea className="flex-1">
        {/* ...消息内容不变... */}
      </ScrollArea>
```

注意：需要验证 `messagesEndRef.scrollIntoView` 在 Radix ScrollArea 内仍然正常工作。如果不行，改用 ScrollArea 的 ref 手动设置 scrollTop。

**Step 3: 替换设置页面滚动区域**

修改 `app/settings/page.tsx`，导入 ScrollArea 并将第 137 行的：
```tsx
      <div className="flex-1 overflow-y-auto">
```
替换为：
```tsx
      <ScrollArea className="flex-1">
```
对应的 `</div>` 替换为 `</ScrollArea>`。

**Step 4: 替换对话列表滚动区域**

修改 `components/BookConversationList.tsx`，在对话树容器处使用 ScrollArea 替换原生滚动。找到 scrollRef 所在的 `<div ref={scrollRef} className="flex-1 overflow-y-auto">` 容器，替换为 ScrollArea。

注意：对话列表使用了 `scrollRef` 保持滚动位置，需确认 ScrollArea 的 Viewport 能正确获取/设置 scrollTop。

**Step 5: 验证**

Run: `bun run dev:renderer`
预期：所有滚动区域显示自定义的细滚动条（Radix 样式），hover 时显示、非 hover 时隐藏。自动滚动功能正常。

**Step 6: Commit**

```bash
git add components/ui/scroll-area.tsx components/agent-chat/AgentChat.tsx app/settings/page.tsx components/BookConversationList.tsx
git commit -m "feat: 使用 shadcn ScrollArea 替换原生滚动条"
```

---

## Task 6: 空状态引导页

**Files:**
- Modify: `app/page.tsx` (中间面板条件渲染)

**Step 1: 在 page.tsx 中添加空状态 UI**

修改 `app/page.tsx`。在导入区添加：
```tsx
import { MessageSquareText } from 'lucide-react';
```

从 conversation-store 获取：
```tsx
const selectedConversation = useConversationStore((s) => s.selectedConversation);
const newConversation = useConversationStore((s) => s.newConversation);
```

将中间面板（AgentChat 的容器）改为条件渲染：
```tsx
        <section className="flex-1 flex flex-col min-w-0">
          {selectedConversation ? (
            <div className="flex-1 overflow-hidden">
              <AgentChat
                placeholder="我可以帮你分析书籍内容、回答问题..."
                showStatusHint={false}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4">
                <MessageSquareText className="w-12 h-12 mx-auto text-muted-foreground/50" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">还没有选择对话</p>
                  <p className="text-xs text-muted-foreground/70">从左侧选择一个对话，或者创建新对话</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => newConversation()}>
                  <Plus className="w-4 h-4 mr-1" />
                  新建对话
                </Button>
              </div>
            </div>
          )}
        </section>
```

**Step 2: 验证**

Run: `bun run dev:renderer`
预期：应用启动时无选中对话，中间区域显示图标 + "还没有选择对话" + 新建按钮。选中对话后显示 AgentChat。

**Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: 无对话选中时显示空状态引导页"
```

---

## Task 7: 设置页面 Tabs 导航

**Files:**
- Modify: `app/settings/page.tsx:136-490`

**Step 1: 重构设置页面为 Tabs 布局**

修改 `app/settings/page.tsx`。

在导入区添加 Tabs 组件（已有 `components/ui/tabs.tsx`）：
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
```

将第 136-490 行的内容区域重构。替换当前的 `<div className="flex-1 overflow-y-auto">` 整体结构为：

```tsx
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs defaultValue="behavior" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-4">
            <TabsList>
              <TabsTrigger value="behavior">AI 行为</TabsTrigger>
              <TabsTrigger value="permissions">工具权限</TabsTrigger>
              <TabsTrigger value="profiles">模型方案</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="behavior" className="flex-1 overflow-y-auto mt-0">
            <div className="max-w-2xl mx-auto py-6 px-4">
              {/* 原 AI 行为 Card 的 CardContent 内容，不再需要 Card 包裹 */}
              <div className="space-y-6">
                {/* Thinking 模式、Effort、最大轮次 — 直接从原 Card 搬过来 */}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="permissions" className="flex-1 overflow-y-auto mt-0">
            <div className="max-w-2xl mx-auto py-6 px-4">
              {/* 原工具权限 Card 的 CardContent 内容 */}
            </div>
          </TabsContent>

          <TabsContent value="profiles" className="flex-1 overflow-y-auto mt-0">
            <div className="max-w-2xl mx-auto py-6 px-4">
              {/* 原模型方案 Card 的 CardContent 内容 */}
            </div>
          </TabsContent>
        </Tabs>
      </div>
```

每个 TabsContent 中放入原来对应 Card 的 CardContent 内容（去掉 Card/CardHeader 包裹），保持内部逻辑不变。

**Step 2: 验证**

Run: `bun run dev:renderer`
预期：设置页面顶部有 3 个 Tab 可切换，每个 Tab 展示对应的设置内容，不再上下滚动。

**Step 3: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: 设置页面改为 Tabs 导航布局"
```

---

## Task 8: 多会话并行标签页 — session-store

**Files:**
- Create: `stores/session-store.ts`

**Step 1: 创建 session-store**

创建 `stores/session-store.ts`：

```tsx
import { create } from 'zustand';

export interface SessionTab {
  conversationId: string;
  conversationTitle: string;
  sessionId: string | null;  // agent session ID，初始为 null
  isStreaming: boolean;
  permissionMode: string;
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string | null;  // 当前显示的 conversationId

  openTab: (conversationId: string, title: string) => void;
  closeTab: (conversationId: string) => void;
  switchTab: (conversationId: string) => void;
  updateSession: (conversationId: string, sessionId: string, permissionMode: string) => void;
  updateStreaming: (conversationId: string, isStreaming: boolean) => void;
  updateTitle: (conversationId: string, title: string) => void;
  getTab: (conversationId: string) => SessionTab | undefined;
}

const MAX_TABS = 5;

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (conversationId, title) => {
    const existing = get().tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      set({ activeTabId: conversationId });
      return;
    }
    if (get().tabs.length >= MAX_TABS) {
      // 拒绝打开，由调用方提示用户
      return;
    }
    set((state) => ({
      tabs: [...state.tabs, {
        conversationId,
        conversationTitle: title,
        sessionId: null,
        isStreaming: false,
        permissionMode: 'default',
      }],
      activeTabId: conversationId,
    }));
  },

  closeTab: (conversationId) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.conversationId !== conversationId);
      let newActive = state.activeTabId;
      if (state.activeTabId === conversationId) {
        newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].conversationId : null;
      }
      return { tabs: newTabs, activeTabId: newActive };
    });
  },

  switchTab: (conversationId) => {
    set({ activeTabId: conversationId });
  },

  updateSession: (conversationId, sessionId, permissionMode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, sessionId, permissionMode }
          : t
      ),
    }));
  },

  updateStreaming: (conversationId, isStreaming) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, isStreaming }
          : t
      ),
    }));
  },

  updateTitle: (conversationId, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, conversationTitle: title }
          : t
      ),
    }));
  },

  getTab: (conversationId) => {
    return get().tabs.find((t) => t.conversationId === conversationId);
  },
}));
```

**Step 2: Commit**

```bash
git add stores/session-store.ts
git commit -m "feat: 创建 session-store 管理多会话标签页状态"
```

---

## Task 9: 多会话标签页 — UI 集成

**Files:**
- Modify: `app/page.tsx` (中间面板改为标签页 + 多 AgentChat)
- Modify: `components/agent-chat/hooks/useAgentSession.ts` (与 session-store 协作)
- Modify: `components/BookConversationList.tsx` (选中对话时打开标签页)

**Step 1: 修改 page.tsx 中间面板为标签页布局**

在 page.tsx 中导入：
```tsx
import { useSessionStore } from '@/stores/session-store';
import { X, Loader2 } from 'lucide-react';
```

获取 session store 状态：
```tsx
const tabs = useSessionStore((s) => s.tabs);
const activeTabId = useSessionStore((s) => s.activeTabId);
const closeTab = useSessionStore((s) => s.closeTab);
const switchTab = useSessionStore((s) => s.switchTab);
```

将中间面板替换为：
```tsx
        <section className="flex-1 flex flex-col min-w-0">
          {/* 标签页头 */}
          {tabs.length > 0 && (
            <div className="flex items-center border-b bg-muted/30 overflow-x-auto">
              {tabs.map((tab) => (
                <div
                  key={tab.conversationId}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0 max-w-[200px]',
                    activeTabId === tab.conversationId
                      ? 'bg-background font-medium'
                      : 'hover:bg-muted/50 text-muted-foreground'
                  )}
                  onClick={() => switchTab(tab.conversationId)}
                >
                  {tab.isStreaming && (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-500 shrink-0" />
                  )}
                  <span className="truncate">{tab.conversationTitle}</span>
                  <button
                    className="ml-1 p-0.5 rounded hover:bg-muted shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.conversationId);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 标签页内容 */}
          {tabs.length > 0 ? (
            <div className="flex-1 overflow-hidden relative">
              {tabs.map((tab) => (
                <div
                  key={tab.conversationId}
                  className="absolute inset-0"
                  style={{ display: activeTabId === tab.conversationId ? 'block' : 'none' }}
                >
                  <AgentChat
                    placeholder="我可以帮你分析书籍内容、回答问题..."
                    showStatusHint={false}
                    conversationIdOverride={tab.conversationId}
                  />
                </div>
              ))}
            </div>
          ) : (
            /* 空状态（复用 Task 6 的空状态 UI） */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4">
                <MessageSquareText className="w-12 h-12 mx-auto text-muted-foreground/50" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">还没有选择对话</p>
                  <p className="text-xs text-muted-foreground/70">从左侧选择一个对话，或者创建新对话</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => newConversation()}>
                  <Plus className="w-4 h-4 mr-1" />
                  新建对话
                </Button>
              </div>
            </div>
          )}
        </section>
```

**Step 2: 修改 AgentChat 支持 conversationIdOverride prop**

修改 `components/agent-chat/types.ts`，在 AgentChatProps 中新增：
```tsx
  /** 覆盖 conversationId（多标签页模式下使用） */
  conversationIdOverride?: string;
```

修改 `components/agent-chat/AgentChat.tsx`，在 props 解构中接收 `conversationIdOverride`，并修改 conversationId 获取逻辑：
```tsx
  const storeConversationId = useConversationStore((s) => s.selectedConversation?.id) || null;
  const conversationId = conversationIdOverride || storeConversationId;
```

**Step 3: 修改对话列表选中行为**

修改 `components/BookConversationList.tsx` 中的 `onClick` 处理（第 230 行）：

```tsx
import { useSessionStore } from '@/stores/session-store';
```

在 ConversationTreeItem 中获取 openTab：
```tsx
const openTab = useSessionStore((s) => s.openTab);
```

修改 onClick：
```tsx
onClick={() => {
  selectConversation(conv);
  openTab(conv.id, getConversationTitle(conv));
}}
```

**Step 4: 修改 useAgentSession 以在关闭标签时关闭 session**

修改 `components/agent-chat/hooks/useAgentSession.ts`，在 cleanup 中调用 session-store：

```tsx
import { useSessionStore } from '@/stores/session-store';
```

会话创建成功后，更新 session-store：
```tsx
useSessionStore.getState().updateSession(conversationId, response.sessionId, response.permissionMode);
```

在 isLoading 变化时更新 streaming 状态：
```tsx
// 在 useSessionMessages 或 AgentChat 中适当位置
useSessionStore.getState().updateStreaming(conversationId, isLoading);
```

**Step 5: 验证**

Run: `bun run dev:renderer`
预期：
- 选中对话后在中间区域打开标签页
- 多个标签页可同时存在
- 标签页间切换不会关闭 agent session
- 关闭标签页会关闭对应 agent
- 运行中的标签页显示旋转图标

**Step 6: Commit**

```bash
git add stores/session-store.ts app/page.tsx components/agent-chat/AgentChat.tsx components/agent-chat/types.ts components/agent-chat/hooks/useAgentSession.ts components/BookConversationList.tsx
git commit -m "feat: 实现多会话并行标签页切换"
```

---

## Task 10: 对话列表运行状态联动

**Files:**
- Modify: `components/BookConversationList.tsx`

**Step 1: 在对话列表显示运行状态**

在 ConversationTreeItem 中获取标签页状态：
```tsx
const tabs = useSessionStore((s) => s.tabs);
const tab = tabs.find((t) => t.conversationId === conv?.id);
const isRunning = tab?.isStreaming ?? false;
const isOpenInTab = !!tab;
```

在图标区域（第 232-240 行），如果正在运行则替换为 Loader2：
```tsx
          {isRunning ? (
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-blue-500" />
          ) : isFork ? (
            <GitBranch className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-purple-600' : 'text-purple-400'
            )} />
          ) : (
            <MessageSquare className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-blue-600' : 'text-muted-foreground'
            )} />
          )}
```

可选：已在标签页打开但未运行的对话，图标旁加小圆点标记。

**Step 2: 验证**

Run: `bun run dev:renderer`
预期：对话列表中运行中的对话显示旋转图标，非运行对话恢复正常图标。

**Step 3: Commit**

```bash
git add components/BookConversationList.tsx
git commit -m "feat: 对话列表显示 agent 运行状态"
```

---

## Task 11: 对话列表排序（可选，P2）

> 此任务复杂度较高，涉及 @headless-tree/react 的排序 API 和 JSON 持久化，可在前面功能稳定后单独迭代。

**Files:**
- Modify: `electron/main/services/conversation-service.ts` (ConversationIndex 新增 sortIndex)
- Modify: `components/BookConversationList.tsx` (拖拽排序)
- Modify: `electron/main/tipc/conversations.ts` (新增 updateSortOrder RPC)

**概要**：
1. ConversationIndex 新增 `sortIndex: number` 字段
2. 新建时 sortIndex 默认为 0（最前）
3. @headless-tree/react 配置 `canDropOnIndex` + `onDrop` 处理排序
4. 拖拽结束后批量更新 sortIndex 并持久化
5. 加载对话列表时按 sortIndex 排序

此任务需要更详细的 @headless-tree/react 排序 API 调研后再细化步骤。

---

## 实施总结

| Task | 内容 | 预计改动量 |
|------|------|-----------|
| 1 | StreamingIndicator 运行指示器 | 新建 1 文件 + 改 1 文件 |
| 2 | Ctrl+Enter 快捷键 | 改 2 文件 |
| 3 | 移除固定标题 | 改 1 文件 |
| 4 | 对话标题可编辑 | 改 2 文件 |
| 5 | ScrollArea | 新建 1 文件 + 改 3 文件 |
| 6 | 空状态引导 | 改 1 文件 |
| 7 | 设置 Tabs 导航 | 改 1 文件 |
| 8 | session-store | 新建 1 文件 |
| 9 | 多会话标签页 UI | 改 5 文件 |
| 10 | 对话列表运行状态 | 改 1 文件 |
| 11 | 对话排序（可选 P2） | 改 3 文件 |
