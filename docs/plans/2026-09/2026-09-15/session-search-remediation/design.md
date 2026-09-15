# 会话内搜索修缮 + 路径可点 设计

**日期**：2026-09-15
**前置调研**：共享区 `notes/session-search-architecture.md`（数据流/JSONL 侧）、`notes/search-path-investigation.md`（路径链路）

## 背景

现有 Ctrl+F 会话内搜索（`useMessageSearch`）四类痛点俱全：搜不到（tool 块不扫、压缩段加载即截断）、匹配死板、跳转定位渲染错位（多套 offset 口径 bug）、入口不可见。同时聊天正文的文件路径完全不可点（MessageItem 未传 workspacePath，相对 md 链接直接 window.open 必失败），agent 未来式路径（「我会写在 X」）无规避。

## 目标

1. 单会话搜索：覆盖 tool 块 + thinking、跳转定位准确可靠、入口可见
2. 会话上 md 文件路径可点击打开（含相对路径正确补全、未来式路径规避）
3. 小地图预览从正文开始（剔除 referenced_files）

## 架构（核心决策）

### 1. 命中模型：块内命中编号，放弃跨块全局 offset

SearchMatch 从 `{messageId, blockIndex, textStart, textEnd}` 改为 `{messageId, blockIndex, hitIndexInBlock}`。渲染端每块自己 `indexOf` 找出块内全部命中并按序编号渲染 `<mark>`，搜索端与渲染端只需「块内第 N 个」对齐——从根上消除现有两套 offset 口径（搜索按 block.content 全文、渲染按 markdown 段落 child）必然错位的问题。

计数顺序 = 命中列表生成顺序（消息序 → 块序 → 块内序），对用户仍是自然的文档顺序。

### 2. 路径补全：确定性补全 + 存在性校验门槛

agent 相对路径语义确定（一律相对主工作区根），前端不做「猜」：候选路径 → 主根拼接 → 不存在则逐附加根尝试（对齐 agent 侧 `resolveWithinPaths` 多根语义）→ 存在性校验通过才渲染胶囊。存在性校验天然挡掉：未来式路径（文件未写 → 纯文本）、相对路径误报（普通词组拼接不存在 → 不渲染）。

### 排除的选项

- **搜索整体搬 JSONL 文件侧**：流式内容只在内存、需复刻 history-adapter 合并规则对齐 blockIndex、压缩段跳转渲染复杂度与混合路线相同——不划算。文件扫描能力留给未来跨会话搜索任务。
- **压缩段搜索**：生产会话零 compaction（用户习惯新起会话），YAGNI，推迟到跨会话搜索任务一并做。
- **匹配算法升级**（模糊/分词）：中文场景子串够用，痛点在覆盖与定位。
- **tool 块内精确 offset 高亮**：卡片 DOM 结构复杂收益低，定位到「展开 + 卡片高亮 + 滚动到卡片」即可。

## 模块边界

| 模块 | 改动 |
|---|---|
| `components/agent-chat/hooks/useMessageSearch.ts` | 命中模型重构（hitIndexInBlock）；扫描纳入 tool_use 块（toolName / 输入序列化 / 输出文本三子域）、thinking 现状已有 |
| `components/agent-chat/highlight.ts` | 块内命中编号生成 `<mark>`，废弃全局 offset 对接 |
| `components/agent-chat/MarkdownRenderer.tsx` | wrapChildren 扩到标题/代码块/表格/strong/em；接 workspacePath 开正文路径识别 |
| `components/agent-chat/MessageItem.tsx` | 给正文 MarkdownRenderer 传 workspacePath；渲染链路统一传原始 blockIndex（tool_group 保留子块原始索引映射）；命中联动解除 line-clamp |
| `components/agent-chat/ContentBlockItem.tsx` / `ThinkingBlock.tsx` / `ToolGroupBlock.tsx` / `tool-renderers/*` | thinking 接高亮；tool 卡片块级高亮 + 命中自动展开 |
| `components/agent-chat/AgentChat.tsx` | 跳转三级 fallback（mark → 块 DOM → 消息级滚动+闪烁）；小地图上方加搜索按钮 |
| `components/agent-chat/path-link.tsx` | 相对路径补全管道（主根 + 附加根逐试 + 存在性校验）；startsWith 加分隔符防兄弟目录碰撞；裸相对路径 token 启发式（含分隔符 + ALLOWED_EXT_RE） |
| `electron/main/services/workspace-fs-service.ts` | resolveAndValidate 从单根改 allowedPaths 多根 |
| 新增 IPC（tipc） | 路径存在性批量校验；前端缓存（workspaceId+path → bool） |
| `components/agent-chat/minimap-utils.ts` | extractMessagePreview 与 parseUserMessageReferences 同口径（剔除 referenced_files），预览从正文开始 |

## 数据流

**搜索**：query（150ms 防抖）→ 扫 stableHistory + liveTail 快照（user 正文 / text / thinking / tool 三子域）→ SearchMatch 列表 → active 切换 → querySelector(`[data-match-id]`) 命中 → 滚动 top-third；未命中 → 块级 DOM → 消息级 scrollToMessage + flash。命中在折叠容器内：先展开（store 状态）→ rAF → 定位。

**路径**：消息文本 token 化 → 绝对路径直接校验 / 相对路径按根逐试 → IPC 存在性批量校验（缓存）→ 存在才渲染 PathChip → 点击 → 兜底再校验 → markdown-preview 浮窗（readFile 走多根 resolveAndValidate）→ 不存在 toast 提示。

## 错误处理 / 边界情况

- 块内命中但 mark DOM 不存在（折叠容器/渲染异常）：三级 fallback 逐级降级，永不零反馈
- 流式输出期间搜索：liveTail 快照照扫（现状保留），命中偏移在下一帧自动校正
- 路径存在性校验竞态（渲染后文件被删）：点击时兜底再校验 + toast
- 未来式路径：校验失败 → 纯文本渲染；文件后续落盘后新消息/重渲染的路径变可点（存量消息不自动刷新，可接受）
- tool 输出超长截断存储：实施时确认 toolOutput 是否截断，截断则命中定位到已展示部分
- `startsWith` 前缀校验统一加路径分隔符

## 未决问题

- 存在性校验 IPC 的批量粒度（逐条 + 缓存 vs 消息渲染期批量聚合）——实施时按消息内路径数量定，先逐条 + 缓存起步
- 搜索按钮具体样式与小地图按钮（MapIcon）并排的视觉细节——实施时定
