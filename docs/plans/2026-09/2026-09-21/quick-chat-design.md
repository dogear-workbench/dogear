# 随手问与分流 设计

**背景**：日常使用中有两类轻量对话需求未被支持——① 工作会话中岔题（想到另一件事，想记录或另起处理，不想污染当前会话上下文）；② 与工作区无关的随手问（天气、常识等，不值得开工作区会话）。

**目标**：
1. 岔题处理：agent 建议分流（另起会话 / 另起话题 / 记为笔记），用户以「操作气泡」形式确认后由 agent 执行，agent 只建议不擅动会话结构
2. 临时会话：随手启用、无工作区绑定、最小能力、7 天自动归档，可事后移入工作区
3. 快捷键可发现性：设置页新增快捷键 tab，registry 驱动自动生成

**架构**（核心做法 + 排除的选项及原因）：

## 一、分流气泡（岔题处理）

### 交互链路

```
agent 检测岔题 → 回复末尾渲染「建议卡」（非阻塞，agent 不等待）
用户点卡上按钮 → 输入框插入「操作气泡」（复用引用芯片 UI + 发送时标签注入机制）
用户可编辑补充 / 删除 / 忽略 → 发出后 agent 看到标签 → 调工具执行 → 回执链接
```

关键语义区分：AskUserQuestionCard 是 agent **暂停等待**用户回答；分流建议卡是 agent 正常说完话后的**事后建议**，用户不理会则对话照常继续，零副作用。

### 建议卡渲染协议

agent 在回复文本末尾输出约定结构（如 fenced 块或行内 XML，含三个候选动作 + 附带的岔题摘要），前端 MessageItem 解析渲染为按钮组。按钮携带 `action` + `summary`（agent 生成的岔题上下文简述）。

### 操作气泡

点击按钮 → ChatInputArea 插入一个气泡（形态同引用芯片），内容 = action 标识 + agent 附带的 summary，用户可再输入补充文字。发送时 useSendMessage 把气泡转为标签注入消息（仿照现有引用芯片的 `<conversation>` 标签注入），agent 下一轮读到标签即知用户选了什么。

### 工具执行

| 按钮 | 执行工具 |
|---|---|
| 另起会话（当前话题组内） | `dogear__ForkSession`（新，`scope: 'same-topic'`） |
| 另起话题（新组） | `dogear__ForkSession`（`scope: 'new-topic'`） |
| 记为笔记 | `dogear__CreateNote`（已有） |

**ForkSession ≠ delegation CreateSession**：后者派子会话——建父子契约、父会话等待交付、消息回注父会话。ForkSession 创建**独立平级会话**：不建契约、当前会话不等它、首条输入 = 分流摘要 + 用户当前消息、继承当前工作区、按 scope 挂当前组或新建组。返回新会话 id，agent 在回执中给出可点击跳转链接（复用 focusConversation 基建）。

**控制原则**：agent 可主动建议分流，但创建会话、改变话题归属、写笔记必须经用户点按钮并发出气泡才执行。

## 二、临时会话（personal 空间）

### 承载方式：内置隐藏工作区

特殊 workspaceId `personal`（保留字，前后端共享常量），复用按 workspaceId 组织的全套设施：

```
.dogear/workspaces/personal/
  conversations.json   # 会话索引
  sessions/            # 历史 JSONL（pi-session-repository 照常）
  groups/...           # 隐式单会话组（见下）
```

workspace-session-decouple 已完成（tab 携带 workspaceId、切换零事件），临时会话 tab 与工作区会话并存于 tab 栏、随意切换、互不干扰——「不影响主要会话」由架构天然保证。

### 无话题组的实现：每会话隐式单会话组

现有自动归档是**按组**（archiveGroup）而非按会话，ConversationIndex/列表/焦点联动均假设主会话有组。因此 personal 会话创建时自动建单会话组（一话一组），**后端全复用**，前端渲染层平铺为单会话行（不显示组概念）。归档复用 archiveGroup，阈值 7 天（真实工作区保持 30 天）。

### 列表与生命周期

左侧会话列表**顶部**固定「临时会话」分区（不进工作区切换逻辑）：
- 当天会话直接显示
- 1–7 天收进分区内「更早」折叠区（默认收起）
- 7 天未活跃自动归档，进现有归档 tab，标记「临时」

### 能力与边界

- 最小能力包：基础工具 + 联网搜索/网页阅读（resolveAbilities 对 personal 走独立 overrides，设置页可调）
- 文件边界天然为空：无 workspacePath → computeBasePaths 只剩 configDir（顶层禁写），等于无文件能力
- 有 ModelSelector，默认全局默认模型
- 插话/暂停/自动压缩走 PiSession 现成机制
- 手动文件夹树（conversation-tree）对 personal 禁用

### 入口

- 分区头部「+」按钮：点击开新 tab 直接聚焦
- 全局快捷键 `Ctrl+Alt+N`

### 移入工作区

会话内提供「移入工作区」操作（顶部或输入框附近按钮），执行链：
1. 选目标工作区 + 组归属（现有组 / 新建组；agent 亦可用只读话题工具 ListTopics / ReadGroupBackground 辅助建议，不给文件权限）
2. 索引迁移：importConversation（已有，索引层）
3. **session JSONL 文件搬运**（新增，现缺）：personal/sessions → 目标工作区 sessions，并处理 pi-session-repository 缓存失效
4. personal 侧索引与隐式组清理，列表刷新

移入后即为普通工作区会话，不再受 7 天归档约束。

## 三、快捷键 registry 与设置 tab

新建渲染层 hotkey registry（`lib/hotkey-registry.ts`）：全局快捷键定义为数据（id、键位、描述、作用域），组件从 registry 取定义绑定 window keydown；设置页新增 ShortcutsTab 从 registry **自动渲染清单**，永不脱节。迁移现有 Ctrl+F（聊天搜索）、Ctrl+\（笔记面板）入 registry，新增 Ctrl+Alt+N（临时会话）。第一版只读，键位自定义留作后续。

## 排除的选项

| 选项 | 排除原因 |
|---|---|
| 真正 nullable workspaceId | 所有 workspaceId 消费方（存储/索引/组/归档/IPC）都要加空分支，改动面大 |
| 临时会话顶层新存储区 | conversation-service / group / archive 全部要加无工作区分支，且失去 decouple 铺好的并存能力 |
| 复用 delegation CreateSession 做分流 | 父子契约语义不符（等交付、回注父会话） |
| 同步确认弹窗（AskUser 式） | 打断主会话节奏；气泡方案用户控制权更完整（发出前可编辑可取消） |
| 手写快捷键清单 | 必然与实际脱节 |

## 模块边界

**渲染层**：`components/ConversationList.tsx` + `conversation-list/`（临时分区）、`stores/conversation-store.ts`（personal 会话加载/分区）、`components/agent-chat/ChatInputArea.tsx`（操作气泡）、`hooks/useSendMessage.ts`（气泡→标签注入）、`MessageItem.tsx`（建议卡解析渲染）、`app/settings/page.tsx` + 新 `ShortcutsTab`、新 `lib/hotkey-registry.ts`

**主进程**：`workspace-json-service.ts` / `workspace-service.ts`（getAll 过滤 personal + 目录确保）、`conversation-service.ts`（session 文件搬运）、`auto-archive-service.ts`（personal 7d 分支）、`group-service.ts`（personal 特殊处理）、新 `tools/fork-session-tool.ts`、`pi-session.ts` / `ability-registry.ts`（personal 能力包）、`session-append-templates.ts`（分流引导与临时会话精简提示词）

**IPC**：conversation/group 现有路由基本复用；personal 会话创建与移入需扩展现有 tipc 路由

## 数据流

- **临时会话创建**：分区「+」/ Ctrl+Alt+N → conversationService.create(personal, 单会话组) → PiSession attach（最小能力）→ tab 打开聚焦
- **分流**：agent 回复带建议卡 → 用户点按钮 → 输入框气泡 → 发送（注入 shunt 标签）→ agent 调 ForkSession / CreateNote → 新会话/笔记落盘 → 回执可点击跳转
- **移入**：会话内按钮 → 选工作区+组 → importConversation + session 搬运 + personal 清理 → conversationListChanged 回环刷新

## 错误处理 / 边界情况

- ForkSession 目标组不存在或已归档 → 工具返回 isError，不静默兜底
- 气泡发出时当前会话正在运行 → 走现有插话排队
- 移入工作区时 session 运行中 → 拒绝并提示先等结束
- personal 不得出现在：工作区切换器、workspace-watcher、手动文件夹树；用量面板显示为「临时」；伴随面板文件树显示空态
- registry 键位冲突 → 注册时 console 告警（第一版不做 UI）

## 未决问题

- 建议卡的文本协议精确格式（fenced JSON vs 行内 XML）——Step 5 实施时定
- 键位自定义（冲突检测/覆盖存储）——后续扩展
- personal 用量是否单独面板视图——先并入全局统计
- 临时会话标题生成策略——先沿用现有会话标题逻辑
