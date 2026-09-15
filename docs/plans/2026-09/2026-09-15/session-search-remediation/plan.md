# 会话内搜索修缮 + 路径可点 实施计划

**目标**：单会话搜索覆盖 tool 块/thinking 且跳转定位准确可靠；会话上 md 路径可点开（相对路径正确补全、未来式路径规避）；小地图预览从正文开始。

**架构思路**：搜索命中模型重构为「块内命中编号」（放弃跨块全局 offset，从根上消除两套口径错位）；路径走「确定性补全（主根 + 附加根逐试）+ 存在性校验门槛」。设计详见 [design.md](./design.md)，前置调研结论在共享区 `notes/session-search-architecture.md` 与 `notes/search-path-investigation.md`。

**涉及模块**：`components/agent-chat/`（useMessageSearch / highlight / MarkdownRenderer / MessageItem / ContentBlockItem / ThinkingBlock / ToolGroupBlock / tool-renderers / AgentChat / path-link / minimap-utils）、`electron/main/services/workspace-fs-service.ts`、tipc 新 procedure。

## 步骤索引

- [x] [Step 1: 命中模型重构与高亮定位修复](./step1-hit-model.md) — SearchMatch 改块内命中编号，修 text/thinking/user 三域高亮与三级 fallback 跳转
- [x] [Step 2: tool 块搜索覆盖与折叠联动](./step2-tool-coverage.md) — tool_use 三子域纳入扫描，命中自动展开卡片并滚动定位
- [x] [Step 3: 路径补全与存在性校验管道](./step3-path-pipeline.md) — 多根补全 + IPC 存在性门槛 + 正文路径识别开启 + planPath 接入
- [ ] [Step 4: 入口按钮与小地图收尾](./step4-entry-minimap.md) — 小地图上方搜索入口；小地图预览剔除 referenced_files

## 全局决策

- **SearchMatch 结构**：`{ id, messageId, blockIndex, hitIndexInBlock }`，`id = ${messageId}-${blockIndex}-${hitIndexInBlock}`。blockIndex 一律用**原始 contentBlocks 索引**（渲染端 tool_group 分组后必须映射回原始索引再生成 id）
- **可搜域定义**：user 正文（getUserMessageSearchableText）、text.content、thinking.content、tool_use 三子域（toolName / JSON.stringify(toolInput) / toolOutput 文本，按此顺序拼接为单域编号）
- **高亮渲染约定**：每个域内自行 `indexOf` 全量命中、按序编号 `<mark data-match-id>`；tool 块例外——只做块级定位（卡片高亮 + 展开 + 滚动），不做域内 mark
- **跳转三级 fallback**：mark DOM → 块级 DOM（`[data-block-index]`）→ 消息级 scrollToMessage + flash，逐级降级永不零反馈
- **路径补全语义**：候选（绝对路径直接用；相对路径须含分隔符且匹配 ALLOWED_EXT_RE）→ 主根拼接 → 逐附加根尝试 → 存在性校验通过才渲染 PathChip；所有前缀校验 `startsWith` 加路径分隔符防兄弟目录碰撞
- **存在性校验**：tipc 批量 procedure，前端按 workspaceId+path 缓存 bool；点击 PathChip 时兜底再校验，不存在 toast
- 项目约束照旧：无注释（WHY 除外）、不绕过 tipc、单文件 300 行内
