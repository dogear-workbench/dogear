# 会话路径直开 + 引用修复 + 图片多模态 实施计划

**目标**：会话渲染区文件路径一键打开（md 浮窗）；修复会话/文件夹/共享文件引用渲染；打通聊天贴图到 GLM glm-5.3-flash 的多模态链路。

**架构思路**：设计文档见 `docs/plans/2026-08/2026-08-26/session-path-link-and-multimodal-design.md`（已拍板）。A：新建 PathText 组件 + WorkspaceIdContext，4 处挂载，write/edit 专属渲染器替代 CodeChangeBlock；B：只改解析端正则（向后兼容）；C：只修 pi-session/po-harness-adapter 两文件断点，pi 侧其余链路现成。

**涉及模块**：`components/agent-chat/`（utils/types/MessageItem/ContentBlockItem/ToolBlock/tool-renderers/）、`components/MarkdownRenderer.tsx`、`stores/markdown-preview-store.ts`（只读消费）、`electron/main/agents/pi-session/`（pi-session.ts / pi-harness-adapter.ts）

## 步骤索引

- [x] [Step 1: 引用解析修复](./step1-reference-parse-fix.md) — 修 conversation/file 正则 + 新增 shared_files 解析 + 剥离跨工作区提示，芯片恢复显示
- [x] [Step 2: 路径按钮基础设施 + 正文挂载](./step2-pathtext-context.md) — PathText 组件 + WorkspaceIdContext + MarkdownRenderer 正文路径胶囊
- [x] [Step 3: 工具块路径按钮与专属渲染器](./step3-tool-renderers.md) — write/edit 专属渲染器（CodeChangeBlock 退役）+ Read/Glob/Grep/通用工具挂载 + 摘要修复
- [x] [Step 4: 图片多模态链路](./step4-image-multimodal.md) — pi-session 丢图断点修复 + adapter images 透传 + GLM 实测

## 完成总结

四步全部完成并提交：bb0f6a9（引用解析修复）→ b090720（PathText 路径胶囊基础设施）→ 4d72ad1（工具块专属渲染器）→ 99a746a（图片多模态链路）。

- A 线（路径直开）：PathText/PathChip + WorkspaceIdContext 全链路就绪，正文/行内 code/Read/Glob/Grep/write/edit/工具入参输出均有可点路径胶囊，CodeChangeBlock 退役
- B 线（引用修复）：四类引用芯片恢复显示，旧消息向后兼容
- C 线（多模态）：代码层已打通，待用户重启应用后 GUI 实测（清单见 step4 实施回填；glm-5.3-flash 对 tool result 图的支持待实测确认）
- 主要取舍：搜索高亮 matchId 在含路径段落近似错位（跳转有守卫）；不支持含空格路径；图片 base64 全量落 JSONL

## 全局决策

- **路径识别规则**（全步骤统一，实现放 PathText 同文件导出的纯函数）：① 绝对路径 `[A-Za-z]:[\\/]` 开头或 `/` 开头；② 相对路径必须含 `/` 或 `\` 且以 `.md/.markdown/.txt/.json` 结尾。渲染条件：`path.resolve(workspaceRoot, p)` 后以 `workspace.path + 分隔符`（或恰好相等）开头，前缀比较 lowercase（Windows）；条件不满足一律纯文本。
- **WorkspaceIdContext**：新建 `components/agent-chat/workspace-id-context.tsx`，导出 `WorkspaceIdProvider`（value: string）与 `useWorkspaceId()`；AgentChat.tsx 顶层包一层（值来自 props.workspaceId）。会话所属工作区，不是焦点工作区。
- **workspace 根路径获取**：`useWorkspaceStore.getState().workspaces.find(w => w.id === workspaceId)?.path`；PathText 内部 hook 化获取，挂载点不逐个传。
- **打开动作**：`useMarkdownPreviewStore.getState().open(workspaceId, resolvedAbsPath, fileName)`；PathText 不新造 API。
- **不写单测**；主进程改动后必须 `bun run build:electron` 重编译才生效。
- **B 端原则**：只改解析端，发送端（useSendMessage.ts）不动。
- **pi 图片格式**：pi-ai `ImageContent = {type:'image', data: string(base64 无前缀), mimeType: string}`；tipc 传来的形状是 `{type:'image', source:{type:'base64', media_type, data}}`，在 pi-session.ts 做转换。
