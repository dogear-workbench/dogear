# 会话体验重设计

> 基于 6 点改进思考的全面方案设计

---

## 概述

本次改进围绕 AgentChat 模块的 6 个核心问题，目标是：更准确的消息识别、更自由的交互方式、更好的滚动体验、更清晰的视觉层次、统一的渲染架构、以及更简约的系统消息。

---

## 第 1 点：用户消息 vs 系统消息的准确识别

### 问题

当前 `isMeta` 标记只检测了部分特殊文本（如 `[Request interrupted by user]`），但 JSONL 历史中大量 SDK 注入的 user 消息（skill 加载、command caveat、subagent 提示等）没有被正确识别，导致它们以"用户消息"样式展示。

### 方案

#### 识别规则

| 场景 | 判断方式 | 展示为 |
|------|---------|--------|
| 历史加载 - 真正用户消息 | JSONL 中 `userType === "external"` | 用户消息（蓝色头像） |
| 历史加载 - SDK 注入消息 | `userType` 不存在或不为 `"external"` 的 user 消息 | 系统/agent 消息 |
| 实时流 - 用户通过输入框发送 | 前端自己创建的消息（`sendMessage` 调用时标记 `isUserInput: true`） | 用户消息 |
| 实时流 - API 返回的 user 消息 | SDK 推送的 `type: "user"` 事件 | 系统/agent 消息 |

#### 修改点

1. **`useMessageHistory.ts`**（历史加载）
   - 主进程 `getSdkSessionHistory` 返回数据时，保留 JSONL 中的 `userType` 字段
   - 前端解析时：`userType === "external"` → 用户消息，其他 → `isMeta: true`

2. **`useSessionMessages.ts`**（实时流）
   - SDK 推送的 `type: "user"` 事件一律标记 `isMeta: true`
   - 用户通过输入框发送的消息由 `useSendMessage` 直接创建，不依赖 SDK 事件

3. **`tipc/agent.ts`**（IPC 层）
   - `getSdkSessionHistory` 解析 JSONL 时传递 `userType` 字段到前端

---

## 第 2 点：Agent 执行中途插入用户消息

### 问题

当前 `ChatInputArea` 在 `isLoading` 时禁用输入框，用户无法在 Agent 执行期间补充信息。

### 方案

**排队模式**：Agent 运行时输入框保持可用，用户输入的消息通过 `sendMessage()` 进入 `pendingMessages` 队列，SDK 在步骤间隙（工具执行完、下一步开始前）自动消费队列中的消息。

#### 交互设计

- Agent 运行时：输入框可用，发送按钮可点击
- 发送后：消息立即显示在消息列表中（乐观更新），标记为"已排队等待处理"
- 排队消息样式：正常用户消息样式，但右侧有淡色「排队中」标签
- Agent 消费后：标签自动消失

#### 修改点

1. **`ChatInputArea.tsx`**
   - 移除 `isLoading` 时的输入禁用逻辑
   - 发送按钮在 Agent 运行时仍然可用

2. **`useSendMessage.ts`**
   - 移除 `isLoading` 时的 early return
   - 发送消息时添加 `isQueued: true` 标记（Agent 运行中时）

3. **`MessageItem.tsx`**
   - 支持渲染 `isQueued` 标记的排队消息

4. **后端无需修改**：`QueryBasedSession.sendMessage()` 已有 `pendingMessages` 队列机制

---

## 第 3 点：滚动行为完全由用户控制

### 问题

当前每次 `messages` 变化都强制 `scrollIntoView`，导致用户查看历史内容时被不断打断。

### 方案

**永远不自动滚动**。新内容在下方生成，用户自己决定何时查看。底部提供不影响体验的"跳到最新"按钮。

#### 交互设计

- 移除 `useEffect` 中的自动 `scrollIntoView`
- 滚动容器右下角固定一个小型浮动按钮（向下箭头图标）
- 按钮仅在「有新内容且用户不在底部」时显示
- 按钮上可选显示未读新消息数量（如 badge）
- 点击后平滑滚动到底部
- 按钮样式：小圆形，半透明背景，不遮挡主要内容

#### 修改点

1. **`AgentChat.tsx`**
   - 删除自动滚动的 `useEffect`
   - 添加 `isAtBottom` 状态（通过 scroll 事件 + 阈值判断）
   - 添加 `newMessageCount` 计数器（当不在底部时累加）
   - 渲染 "跳到最新" 浮动按钮（条件显示）

2. **新增 `ScrollToBottomButton` 组件**（或直接写在 AgentChat 中）
   - 位置：消息列表右下角，`absolute` 定位
   - 样式：小圆形按钮，ChevronDown 图标，半透明背景
   - 可选：新消息数量 badge

---

## 第 4 点：内容块折叠/展开的重新设计

### 问题

当前设计中：
- 思考块和工具块的折叠/展开按钮在内容末尾，长内容需要滚很久才能收起
- 工具块缺少清晰的"关注点"，用户不知道工具在做什么
- 内容不够线性，嵌套层级影响阅读

### 方案

#### 设计原则

- **默认显示几行预览**而非完全折叠，用户能快速扫一眼判断是否感兴趣
- **展开按钮在左上角**，避免长内容时需要滚到底部才能收起
- **工具以 description 为标题**，这是用户最先关注的
- **线性展示**，工具调用和结果顺着排列

#### 各类型的默认展示

| 内容类型 | 默认显示 | 展开按钮位置 |
|---------|---------|-------------|
| 思考块 | 3 行文本预览，超出部分渐隐（gradient mask） | 左上角展开图标 |
| 工具块 | 1 行：工具图标 + description 文本（如"读取文件 src/App.tsx"） | 左上角展开图标 |
| 长文本（非最终回答） | 5 行预览，超出部分渐隐 | 左上角展开图标 |
| 最终回答文本 | 完整显示，不折叠 | - |

#### 工具块的新设计

**不使用卡片/背景色**，和思考块一样采用渐隐预览形式，内容直接流式展示：

```
[▶] 🔧 读取文件 src/App.tsx:1-50            ● 运行中
    { "file_path": "src/App.tsx", "limit": 50 }
    ~~~~~~~~~~~~~~~~~ (渐隐)

展开后：
[▼] 🔧 读取文件 src/App.tsx:1-50            ✓ 成功
    输入参数：
    { "file_path": "src/App.tsx", "limit": 50 }

    执行结果：
    1  import React from 'react';
    2  import { Route, Routes } from 'react-router';
    3  ...
```

- **标题行**：展开图标 + 工具图标 + description（从 `getSummary` 逻辑提取）+ 状态指示（脉冲圆点/勾/叉）
- **收起状态**：标题行 + 1-2 行内容预览（输入参数的前几行），超出部分 gradient 渐隐，无边框无背景
- **展开后**：输入参数 + 执行结果直接平铺展示，用淡色小标题分区（如 `text-muted-foreground` 的"输入参数："和"执行结果："），不用卡片包裹
- **整体风格**：无 border、无 background，和周围文本融为一体，只通过缩进和淡色文字区分层次
- **引用徽章**：保留在标题行末尾

#### 思考块的新设计

```
┌─ 🧠 思考中...                                      [▶ 展开]
│  用户要求分析这本书的主题，
│  我需要先搜索相关章节...
│  然后结合上下文来总结...
│  ~~~~~~~~~~~~~~~~~ (渐隐)
│
│  展开后：完整思考内容
```

- **默认 3 行预览**：超出部分用 CSS gradient mask 渐隐
- **展开按钮在左上角**：点击后显示完整内容，max-height 限制 + 内部滚动
- **流式中**：脉冲圆点 + "思考中..." 文字

#### 线性布局

所有内容块（文本、工具、思考）按时间顺序线性排列，不嵌套。工具调用的结果直接跟在后面展示，不需要点进去看。

#### 修改点

1. **新增 `CollapsibleBlock` 通用组件**
   - props: `icon`, `title`, `previewLines`, `children`, `status`
   - 左上角展开/收起按钮（ChevronRight 旋转动画）
   - 默认显示 N 行预览 + gradient mask 渐隐
   - 展开后显示完整内容
   - **无边框、无背景色**：不用 border/card/bg，通过缩进和淡色文字区分层次，和周围文本融为一体

2. **重写 `ToolBlock.tsx`**
   - 使用 `CollapsibleBlock`，title = description（现有 `getSummary` 逻辑）
   - previewLines = 2（标题 + 1-2 行输入参数预览，渐隐）
   - 展开内容 = 输入参数 + 执行结果，平铺展示，无卡片/背景色

3. **重写 `ThinkingBlock.tsx`**
   - 使用 `CollapsibleBlock`，title = "思考"
   - previewLines = 3
   - 展开内容 = 完整思考文本

4. **修改 `ContentBlockItem.tsx`**
   - 非最终回答的长文本也使用 `CollapsibleBlock`
   - previewLines = 5

---

## 第 5 点：统一实时/历史的渲染数据模型

### 问题

当前实时消息（`useSessionMessages`）和历史消息（`useMessageHistory`）有两套不同的数据构造逻辑，导致：
- 修改渲染时需要两边同步
- 历史加载时 tool_use 已包含 toolOutput，实时流时需要后续 tool_result 更新
- 重复的消息合并、过滤、类型判断逻辑

### 方案

**定义统一的 `ChatMessage` / `ChatContentBlock` 数据模型**，替换现有的 `Message` 和 `ContentBlock`。两套数据源（历史 / 实时）各自有一个转换器（transformer），输出相同结构。渲染组件只认这一种数据结构。

#### 统一数据模型

```typescript
// types.ts - 替换现有定义

interface ChatMessage {
  id: string;                    // 唯一标识（sdkUuid 或生成的 ID）
  role: 'user' | 'assistant';
  blocks: ChatContentBlock[];    // 所有内容块
  timestamp: number;
  model?: string;                // 助手消息的模型名称

  // 消息属性
  isUserInput: boolean;          // true = 用户通过输入框发出，false = 系统/agent 注入
  isStreaming: boolean;          // 是否正在流式生成
  isQueued: boolean;             // 是否在排队等待 Agent 处理
  isCompactBoundary: boolean;    // 是否为压缩分隔点
  isCompactSummary: boolean;     // 是否为压缩摘要
}

interface ChatContentBlock {
  id: string;                    // 唯一标识
  type: 'text' | 'thinking' | 'tool' | 'permission' | 'ask_user'
       | 'error' | 'status' | 'notification' | 'compact_boundary'
       | 'session_start' | 'session_end';

  // 文本类内容
  text?: string;

  // 工具调用
  tool?: {
    name: string;
    description: string;         // 从 getSummary 提取
    input: any;
    output?: string;
    status: 'running' | 'success' | 'error';
    isError: boolean;
    citations?: Citation[];
    // 子代理
    subAgent?: {
      id: string;
      status: string;
      duration?: number;
      tokens?: number;
      resultText?: string;
    };
  };

  // 权限请求
  permission?: {
    requestId: string;
    toolName: string;
    input: any;
    reason?: string;
    resolved: boolean;
    response?: 'allow' | 'deny' | 'always_allow';
  };

  // AskUser 问题
  askUser?: {
    requestId: string;
    questions: Array<{...}>;
    resolved: boolean;
    answers?: Record<string, string>;
  };

  // 状态/通知
  status?: string;
  notificationTitle?: string;
  notificationMessage?: string;

  // 元数据
  timestamp: number;
}
```

#### 转换器架构

```
JSONL 历史文件 ──→ historyTransformer() ──→ ChatMessage[]
                                                  │
SDK 实时事件 ──→ streamTransformer()    ──→ ChatMessage[] ──→ 渲染组件
```

1. **`historyTransformer(rawMessages)`**
   - 输入：主进程返回的 JSONL 解析结果
   - 输出：`ChatMessage[]`
   - 职责：消息合并、tool_use/tool_result 关联、compact_boundary 处理、userType 识别

2. **`streamTransformer(prevMessages, event)`**（纯函数 reducer）
   - 输入：当前消息列表 + 新的 SDK 事件
   - 输出：更新后的 `ChatMessage[]`
   - 职责：流式追加、tool_use 状态更新、thinking 累积、消息创建

3. **共享工具函数**
   - `mergeToolResult(block, result)` — 关联工具结果到工具调用块
   - `createChatMessage(role, blocks, attrs)` — 创建标准消息
   - `getToolDescription(toolName, toolInput)` — 提取工具的展示描述
   - `isExternalUserMessage(rawMessage)` — 判断是否为真实用户消息

#### 修改点

1. **重写 `types.ts`**
   - 用 `ChatMessage` / `ChatContentBlock` 替换 `Message` / `ContentBlock`

2. **新增 `transformers.ts`**
   - `historyTransformer` + `streamTransformer` + 共享工具函数

3. **简化 `useMessageHistory.ts`**
   - 调用 `historyTransformer`，不再自己做消息构造

4. **简化 `useSessionMessages.ts`**
   - 调用 `streamTransformer`，不再自己做消息构造

5. **更新渲染组件**
   - `MessageItem`, `ContentBlockItem` 等适配新类型

---

## 第 6 点：系统消息简约化

### 问题

当前系统消息（`isMeta`）使用灰色填充背景 + 齿轮图标，视觉上太重，干扰正文阅读。

### 方案

**淡色行内提示**风格：

```
   ···  [系统] skill:chat-skill 已加载         ← 淡灰单行
   ···  [系统] 权限模式已切换为「信任模式」     ← 淡灰单行
```

#### 设计细节

- **布局**：单行，左侧小圆点图标（`···` 或 `•`），居中对齐
- **文字**：`text-xs text-muted-foreground/50`（比当前更淡，约 50% 透明度）
- **无背景色**：不用 `bg-secondary`，直接融入背景
- **无头像/标签**：去掉齿轮图标和"系统"标签，用行内小图标暗示
- **不可交互**：无 hover 效果、无操作按钮
- **可选隐藏**：连续多条系统消息可折叠为"N 条系统消息"

#### 修改点

1. **`MessageItem.tsx`**
   - 系统消息渲染改为淡色行内样式
   - 去掉灰色背景卡片

---

## 实施策略

### 依赖关系

```
第 5 点（统一数据模型） ← 基础，其他改动依赖此
   ↓
第 1 点（消息识别） ← 在 transformer 中实现 userType 识别
   ↓
第 4 点（折叠/展开） ← 基于新 ChatContentBlock 重写渲染组件
   ↓
第 6 点（系统消息样式） ← 基于新 isUserInput 标记调整样式
   ↓
第 3 点（滚动行为） ← 独立，可并行
   ↓
第 2 点（中途插入消息） ← 独立，可并行
```

### 建议实施顺序

1. **Phase 1 - 数据层**：统一数据模型 + transformer（第 5 点 + 第 1 点）
2. **Phase 2 - 渲染层**：CollapsibleBlock + 工具/思考块重写 + 系统消息（第 4 点 + 第 6 点）
3. **Phase 3 - 交互层**：滚动行为 + 中途插入消息（第 3 点 + 第 2 点）

### 影响范围

| 文件 | 改动类型 |
|------|---------|
| `agent-chat/types.ts` | 重写数据类型 |
| `agent-chat/transformers.ts` | 新增，核心转换逻辑 |
| `agent-chat/hooks/useMessageHistory.ts` | 简化，调用 transformer |
| `agent-chat/hooks/useSessionMessages.ts` | 简化，调用 transformer |
| `agent-chat/hooks/useSendMessage.ts` | 修改，移除 isLoading 限制 |
| `agent-chat/AgentChat.tsx` | 修改，滚动行为 |
| `agent-chat/MessageItem.tsx` | 重写，系统消息样式 + 排队标记 |
| `agent-chat/ContentBlockItem.tsx` | 重写，适配新 block 类型 |
| `agent-chat/ThinkingBlock.tsx` | 重写，使用 CollapsibleBlock |
| `ToolBlock.tsx` | 重写，使用 CollapsibleBlock |
| `agent-chat/ChatInputArea.tsx` | 修改，Agent 运行时保持可用 |
| `agent-chat/CollapsibleBlock.tsx` | 新增，通用可折叠组件 |
| `agent-chat/StreamingIndicator.tsx` | 可能微调 |
| `tipc/agent.ts` | 修改，传递 userType 字段 |
