# 笔记人机协作闭环 设计

**日期**：2026-08-29
**来源**：与用户围绕笔记 s3pg7hi0（原生笔记方向）、16b1h86d（编辑体验诊断）的深度讨论，方向拍板：人机协作优先，编辑体验为下一话题。

## 背景

用户与 Agent 围绕笔记协作存在两个断点（2026-08-29 现场痛点）：

1. **无法指定讨论对象**：用户想聊某张卡只能口述「你去笔记里看看」，靠关键词碰运气；没有通道把「这张卡」显式递给会话中的 Agent。
2. **Agent 存卡黑箱**：Agent 调 `dogear__CreateNote` 存卡后用户不知情，卡片不记录诞生会话，事后无法回到产生它的讨论。

同时调研发现既有缺陷：**引用队列全局无主**（`reference-store` 全局单例、无会话归属、切 tab 不重置），引用项会「漂移」到最后停留的会话；而输入框文字草稿本来就是 per-session 的（`useSendMessage.ts:67` 每实例 `useState`），两者心智模型不一致。

## 目标

1. 笔记卡可一键引用进会话（链路：指定讨论对象）
2. Agent 存卡：瞬间知情 + 来源追溯（链路：讨论 → 落卡回路）
3. 引用队列锚定化：6 类引用（含新增笔记）全部带归属会话，根治漂移

**明确不做**（用户拍板「还没到那一步，用起来才会知道」）：
- 链路 2：Agent 聊文章/股票时主动浮现相关笔记
- 链路 4：Agent 替用户整理收件箱（依赖方向 B 的收件箱状态地基）
- 链路 5：持续讨论锚点单独立项（来源字段已覆盖大半）
- 双链（Obsidian 式内容关联）——与「来源元数据」是两回事，不混入
- 输入框 @ 搜索引用、会话消息流渲染卡片缩略块

## 架构

### 1. 笔记引用 = 第 6 类引用（照抄现有模式）

现有 5 类引用（文章/片段/文件/会话/共享文件）走同一管道：`reference-store` → ChatInputArea 彩色芯片（带 X 可删）→ 发送时拼 XML text block → 发送后清空。笔记引用完全同构：

```
数据：NoteReference { noteId, title, workspacePath }
发送：<referenced_notes><note noteId="..." title="..." workspacePath="..." /></referenced_notes>
Agent 侧：零新增工具，dogear__GetNote(noteId) 读全文
```

### 2. 引用锚定模型（根治漂移）

队列结构不变，每类引用项增加 `anchorConversationId`（加入时 = 当前焦点会话 tab）：

- ChatInputArea 只渲染锚定本会话的芯片
- 发送时只取、只清锚定本会话的引用
- 现有 5 类引用一并迁移，行为变化：切到别的 tab 看不到别人的芯片（比现状正确）

### 3. 从笔记引用的动线（引用即跳转）

```
笔记卡片 hover / 详情栏 header → 点「引用」按钮
  → 跨工作区守卫（笔记 workspacePath ≠ 焦点会话工作区时 toast 拦截）
  → addReferencedNote，锚定「最近活跃的会话」
  → 自动激活该会话 tab + 聚焦输入框（跳转即归属确认）
  → 用户打字发送
```

排除的选项及原因：
- **输入框 @ 搜索**：小输入框嵌迷你搜索器是糟糕交互，用户有整个笔记栏可搜
- **模糊口述检索为主通道**：本质是模型对齐用户指称，不可靠；其可信形态（Agent 搜出候选亮标题确认）依赖引用块显式化，是本设计的自然副产物
- **全局队列 + 「将发送至」提示**：漂移没治根
- **引用时弹会话选择器**：多一步，高频场景（继续聊）下多余
- **新建会话为默认锚定**：新会话在 Dogear 语义复杂（话题/会话层级），不搅进动线

### 4. Agent 存卡回路（仅 Agent 存的卡记来源）

- **瞬间知情**：Agent 存卡后必须在回复正文说一声存了什么（行为规范层）
- **来源身份证**：`dogear__CreateNote` 写入 `sourceSessionId`（+ 来源会话标题）到 frontmatter；用户手记的卡不记（手记卡天然带用户自身上下文，溯源冗余）
- **回到讨论入口**：NoteEditor 详情栏渲染「来自会话 · 日期 · 点击跳转」

定位：来源不是笔记通用元数据，是人机协作产物的身份证（区分「我的想法」与「AI 给的」，碎卡靠它恢复上下文）。

## 模块边界

| 文件 | 改动 |
|------|------|
| `stores/reference-store.ts` | 加 `NoteReference` + add/remove/clear；5 类引用项加 `anchorConversationId`；clear 系列改为按会话清 |
| `components/notes/NoteCardItem.tsx:38-65` | hover 按钮区加引用按钮（与回收站并排） |
| `components/notes/NoteEditor.tsx:178-200` | header 行加引用按钮；详情栏渲染来源会话行 |
| `components/agent-chat/ChatInputArea.tsx:129-243` | 笔记芯片（新配色，现有 5 色已占）；全部芯片按锚定过滤 |
| `components/agent-chat/hooks/useSendMessage.ts:216-314` | 拼接 `<referenced_notes>` 块；只取/只清本会话引用 |
| `components/agent-chat/utils.ts:22-139` | `parseUserMessageReferences` 加笔记正则（否则气泡显示原文 XML） |
| `electron/main/agents/tools/notes-tools.ts` | `CreateNote` 支持写 `sourceSessionId`；工具描述加「存卡后在回复中告知用户」 |
| `types/note.ts` | `NoteMeta` 加 `source` 相关字段 |
| tab 激活机制 | 「最近活跃会话」判定 + 激活 tab + 聚焦输入框（实施时查 tab-store） |
| 守卫 | 照抄 `lib/reference-guard.ts` 模式；注意 `NoteMeta` 无工作区字段，workspacePath 从 workspace-store 取 |

## 数据流

**引用流**：NoteCardItem/NoteEditor 按钮 → 工作区守卫 → `addReferencedNote`（锚定最近活跃会话）→ 激活会话 tab + 聚焦输入框 → 芯片渲染 → 发送拼 `<referenced_notes>` → Agent `GetNote` → 清本会话引用

**落卡流**：Agent `CreateNote(sourceSessionId)` → frontmatter `source` → NoteEditor 渲染「来自会话 · 日期」→ 点击跳回该会话

## 错误处理 / 边界情况

- **锚定会话被关闭**：关闭会话 tab 时清掉其锚定的引用项
- **无最近活跃会话**（冷启动无会话）：toast 提示先打开会话或禁用按钮（实施定）
- **跨工作区**：toast 拦截（同 guardReferenceIntoFocus 模式）
- **无标题卡片**：芯片显示截断正文（title 现从正文第一行推断，独立 title 字段属方向 B）
- **重复引用同一张卡**：按 noteId 去重（照抄现有模式）
- **消息自动标题**：引用块在用户文本 block 之前，自动标题取最后一个 block（agent.ts:199-201），不受影响

## 未决问题

1. 「最近活跃会话」数据来源：tab-store 是否已有该概念（上一个活跃会话 tab），实施时确认
2. 跳转 + 聚焦输入框的前端 API 具体形态
3. 连续引用多张卡需来回切换：先上线看真实频率，再决定是否加「Shift+点击只引用不跳转」变体
4. 「存卡后告知」规范落点：工具描述 vs 系统提示词（按三层职责边界，倾向工具描述尾部）
5. 笔记芯片配色（淡蓝/灰紫/青绿/淡紫/青柠已占用）
