# UI 改进方案 v1

> 基于 ideal.md 提出的 7 个改进点，结合当前代码状态的分析与设计方案。

---

## 1. Agent 运行中状态指示

**现状**：AgentChat 仅在底部有静态的"● 就绪"文本，流式输出时无明显的全局运行状态提示。用户无法直观感知 AI 是否仍在生成。

**方案**：

参考 Claude Code 的做法——当 agent 未完成回答时，在消息列表最底部始终显示一个运行中指示器，让用户明确知道"AI 还在生成中"。

### 1.1 消息底部运行指示器（核心）

- 在 AgentChat 消息列表的最末尾（`messagesEndRef` 之前）添加运行状态组件
- 当 `isStreaming === true` 时显示：
  - `Loader2` 旋转图标 + "正在思考..." / "正在生成..." 文案
  - 样式：居中，浅色文字，带呼吸动画，固定在消息流底部
  - 自动滚动确保该指示器始终可见
- 当 `isStreaming === false` 时隐藏
- 可选：根据当前 content block 类型细化文案（thinking → "正在思考..."，tool_use → "正在执行工具..."，text → "正在生成..."）

### 1.2 标签页运行标记（与第 6 点联动）

- 标签页标题旁也显示 `Loader2` 旋转图标，让用户在切换标签时也能看到哪些会话在运行
- 左侧对话列表中运行中的对话显示动态图标

**涉及文件**：
- `components/agent-chat/AgentChat.tsx` — 消息列表底部添加 StreamingIndicator 组件
- `components/agent-chat/StreamingIndicator.tsx` — 新建运行状态指示器组件
- `app/page.tsx` — 标签页渲染运行状态图标（与第 6 点合并）

---

## 2. 无对话时的空状态引导

**现状**：未选中对话时，AgentChat 依然渲染（但无 session），显示空白区域。

**方案**：

- 当 `selectedConversation === null` 时，中间面板不渲染 AgentChat
- 使用自定义 Empty 组件（shadcn 无官方 Empty，自行实现一个简洁的空状态组件）
- 内容：图标 + "选择一个对话开始，或者创建新对话" 文案 + 两个按钮：
  - 「新建对话」— 调用 conversation-store 的 createConversation
  - 「选择对话」— 聚焦左侧对话列表

**涉及文件**：
- `components/ui/empty.tsx` — 新建空状态组件
- `app/page.tsx` — 条件渲染 Empty vs AgentChat

---

## 3. 快捷键调整：Ctrl+Enter 发送

**现状**：Enter 发送、Shift+Enter 换行。

**方案**：

- 改为 **Enter 换行**（textarea 原生行为）、**Ctrl+Enter 发送**
- 在发送按钮旁使用 Kbd 组件展示快捷键提示 `Ctrl` `Enter`
- 添加 shadcn Kbd 组件（`components/ui/kbd.tsx`）

**涉及文件**：
- `components/agent-chat/hooks/useSendMessage.ts` — 修改 `handleKeyPress`：`e.key === 'Enter' && e.ctrlKey`
- `components/agent-chat/ChatInputArea.tsx` — 发送按钮区域显示 Kbd 提示
- `components/ui/kbd.tsx` — 新建 Kbd 组件

---

## 4. ScrollArea 美化滚动条

**现状**：所有滚动区域使用原生 `overflow-y-auto`，浏览器默认滚动条。

**方案**：

- 添加 shadcn `ScrollArea` 组件
- 替换以下位置的原生滚动：
  - AgentChat 消息列表区域
  - 对话列表（BookConversationList）
  - WorkspaceExplorer 文件树
  - ArticlePreview 文章内容区域
  - 设置页面

**涉及文件**：
- `components/ui/scroll-area.tsx` — 新建（shadcn add scroll-area）
- `components/agent-chat/AgentChat.tsx` — 消息列表替换
- `components/BookConversationList.tsx` — 对话树替换
- `components/WorkspaceExplorer.tsx` — 文件树替换
- `components/ArticlePreview.tsx` — 内容区替换
- `app/settings/page.tsx` — 设置页替换

**注意**：ScrollArea 替换后需确认自动滚动（messagesEndRef.scrollIntoView）仍正常工作。Radix ScrollArea 基于 `overflow: hidden` + 自定义滚动条，scrollIntoView 在其 Viewport 内应仍有效，但需验证。

---

## 5. 设置页面 Tabs 导航

**现状**：设置页面是上下排列的 3 个 Card（AI 行为、工具权限、模型方案），无分组导航。

**方案**：

- 使用已有的 `components/ui/tabs.tsx`（Tabs 组件已存在）
- 将 3 个 Card 分别放入 TabsContent：
  - Tab 1：**AI 行为** — Thinking、Effort、最大轮次
  - Tab 2：**工具权限** — 工具自动允许/拒绝规则
  - Tab 3：**模型方案** — API Key、模型选择
- 后续新增设置项直接加新 Tab，扩展性好

**涉及文件**：
- `app/settings/page.tsx` — 重构为 Tabs 布局

---

## 6. 多 Agent 会话并行 + 标签页切换

**现状**：每次切换对话时，`useAgentSession` 的 cleanup 会关闭当前 session，创建新 session。同一时间只有一个 agent 运行。

**方案**：

### 6.1 核心改动：会话生命周期解耦

- 新增 `stores/session-store.ts`，管理多个活跃会话：
  ```ts
  interface SessionInfo {
    sessionId: string;          // agent session ID
    conversationId: string;     // 对应的对话 ID
    conversationTitle: string;  // 显示名称
    isStreaming: boolean;       // 是否正在运行
    permissionMode: string;     // 权限模式
  }

  interface SessionStore {
    activeSessions: Map<string, SessionInfo>;  // conversationId → SessionInfo
    activeTab: string | null;                  // 当前显示的 conversationId
    openSession: (conversationId, sessionId, ...) => void;
    closeSession: (conversationId) => void;    // 关闭 agent + 移除标签
    switchTab: (conversationId) => void;       // 切换显示
    updateStreaming: (conversationId, isStreaming) => void;
  }
  ```

### 6.2 UI：标签页区域

- 替换原来的"AI 助手"静态标题
- 标签页样式：每个 tab 显示对话标题 + 运行状态图标 + 关闭按钮（×）
- 运行中的标签页名称旁有 `Loader2` 旋转动画
- 点击标签切换显示内容，关闭标签页会 close 对应的 agent session
- 当所有标签关闭时，显示第 2 点的空状态引导

### 6.3 AgentChat 适配

- AgentChat 改为支持多实例（每个标签页对应一个实例）
- 切换 tab 时不销毁组件，而是用 `display: none` 隐藏或使用 key 保持状态
- 推荐方案：每个 tab 对应独立的 AgentChat 实例，用 CSS 控制显示/隐藏，避免切换时丢失滚动位置和输入状态

### 6.4 左侧对话列表联动

- 对话列表中，已在标签页打开的对话显示特殊标记（小圆点或高亮）
- 运行中的对话显示动态图标
- 双击对话 → 打开新标签页（如果尚未打开）
- 单击对话 → 如果已有标签页则切换过去，否则替换当前标签或打开新标签

### 6.5 资源限制

- 设置最大并行 session 数（如 5 个），超出时提示用户关闭某个
- 切换对话不再自动关闭 agent，但左侧列表选中仅改变当前查看

**涉及文件**：
- `stores/session-store.ts` — 新建多会话状态管理
- `components/agent-chat/hooks/useAgentSession.ts` — 大幅重构，与 session-store 协作
- `components/agent-chat/AgentChat.tsx` — 支持多实例
- `app/page.tsx` — 中间面板改为标签页 + 多 AgentChat 渲染
- `components/BookConversationList.tsx` — 添加运行状态标记

---

## 7. 移除固定标题 + 对话标题可编辑 + 拖拽排序

**现状**：
- 左侧有"对话列表"标题（占 ~40px）
- 中间有"AI 助手"标题（占 ~40px）
- 对话标题由系统自动生成（时间戳），用户无法自定义修改
- 对话列表使用 @headless-tree/react，已支持拖放（文件夹间移动），但不支持手动排序索引

**方案**：

### 7.1 移除标题

- 移除左侧"对话列表"标题栏 — 将新建按钮合并到对话列表内部顶部（已有工具栏）
- 移除中间"AI 助手"标题栏 — 被第 6 点的标签页替代
- 节省约 80px 垂直空间

### 7.2 对话标题可编辑

- hover 对话项时，标题文字旁显示 `Pencil`（lucide-react）小图标按钮
- 点击编辑图标 → 标题切换为内联 input 编辑模式
- Enter 确认、Escape 取消、失焦自动保存
- 空标题回退为自动生成的时间标题
- 调用 conversation-service 更新 title 字段并持久化
- 标签页标题也同步更新（读取同一数据源）

### 7.3 对话列表排序

- @headless-tree/react 已支持拖放，扩展其排序能力：
  - 用户可拖动对话项改变顺序
  - 排序索引持久化到 conversations.json 中（增加 `sortIndex` 字段）
  - 同一文件夹内按 sortIndex 排序，新对话默认排最前

**涉及文件**：
- `app/page.tsx` — 删除两个标题区域
- `components/BookConversationList.tsx` — 增加标题编辑 + 排序索引逻辑
- `electron/main/services/conversation-service.ts` — updateTitle / sortIndex 字段存储
- `electron/main/tipc/conversations.ts` — 新增 updateConversationTitle RPC（如尚无）
- `types/electron-api.ts` — Conversation 类型新增 sortIndex

---

## 实施优先级建议

| 优先级 | 改进项 | 复杂度 | 理由 |
|--------|--------|--------|------|
| P0 | 3. Ctrl+Enter 快捷键 | 低 | 影响日常输入体验，改动最小 |
| P0 | 7. 移除标题 | 低 | 简单删除，立即释放空间 |
| P1 | 4. ScrollArea | 低 | 添加组件 + 替换 className，视觉提升明显 |
| P1 | 2. 空状态引导 | 低 | 新建简单组件 + 条件渲染 |
| P0 | 1. 运行状态指示(底部) | 低 | 消息底部加指示器，独立于标签页，体验提升大 |
| P1 | 5. 设置 Tabs | 中 | 组件已有，重构页面布局 |
| P2 | 6. 多会话并行标签页 | 高 | 核心架构改动，需要新 store + 重构会话生命周期 |
| P1 | 7. 对话标题可编辑 | 低 | 内联编辑，改动小 |
| P2 | 7. 对话排序 | 中 | 需扩展树组件 + 持久化 |

**建议实施顺序**：1(底部指示器) → 3 → 7(移除标题+标题可编辑) → 4 → 2 → 5 → 6(多会话标签页，含1的标签页标记) → 7(排序)

---

## 需要确认的问题

1. **第 6 点标签页上限**：默认最多同时开 5 个 session？还是不限制？
2. **第 6 点切换行为**：左侧单击已有标签的对话 → 直接切到该标签？还是有其他交互？
3. **第 7 点排序**：仅支持同一文件夹内排序？还是也支持跨文件夹拖拽排序？
4. ~~第 7 点标题编辑触发方式~~ — 已确认：hover 显示 Pencil 编辑图标，点击进入内联编辑
