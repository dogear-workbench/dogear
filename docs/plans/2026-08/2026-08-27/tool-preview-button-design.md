# 工具块标题行预览按钮 设计

**背景**：md 等文档类内容目前折叠在工具块里，用户想查看必须先展开工具块，展开后还是纯文本 OutputBox，链接点不到。会话流空间宝贵，文字多的内容用浮窗查看更合理。用户场景：agent 写好文档后直接查看、查看 agent 引用/交付的共享区文件、查看加载的 skill 全文。

**目标**：折叠状态的工具块标题行直接提供 Eye 预览按钮，点击弹出 markdown 渲染浮窗，一步到位，无需展开工具块。

**架构**：在 ToolBlock 层新增 `buildPreviewAction()`，按工具名 + toolInput/toolOutput 判断是否提供预览入口及点击行为，生成按钮节点传给 CollapsibleBlock 现成的 `headerActions` 通道。浮窗复用 markdown-preview-store + MarkdownFileDialog，不新建组件。

覆盖工具（已拍板）：

| 工具 | 按钮显示条件 | 点击行为 | 内容来源 |
|------|------------|---------|---------|
| Read | 路径 .md/.txt/.json 且输出为文本字符串 | `openInline` | toolOutput（读取时快照，不读盘） |
| Write | 路径 .md/.markdown 且有 content | `openInline` | toolInput.content（写入时快照） |
| Edit | 路径在工作区内可解析（.md/.txt/.json） | `open`（读盘） | 盘上最新全文 |
| Skill | 有文本输出 | `openInline` | toolOutput（SKILL.md 全文） |
| dogear__ListGroupFiles | toolInput.relPath 存在且输出为文本 | `openInline` | toolOutput（共享区文件内容） |

明确排除：Grep / Glob / Bash 及其他工具不加（输出非文档形态）。

**模块边界**：

- `components/ToolBlock.tsx`：新增 buildPreviewAction 逻辑（约 +60 行）；Edit 读盘复用 `useWorkspaceId` / `useWorkspacePath` / `resolvePathInWorkspace`（path-link.tsx 已导出，ReadRenderer 同层级已在用）
- `components/agent-chat/tool-renderers/FileChangeRenderer.tsx`：删除展开态内「快照预览」按钮及 openSnapshot 逻辑（入口统一到标题行）
- 零改动：CollapsibleBlock、ReadRenderer、SkillRenderer、markdown-preview-store、MarkdownFileDialog

**数据流**：用户点击标题行 Eye 按钮 → stopPropagation 后调 `useMarkdownPreviewStore.getState().openInline(fileName, content)`（Edit 走 `open(workspaceId, resolvedPath, fileName)`）→ 全局挂载的 MarkdownFileDialog 弹出，MarkdownRenderer 渲染内容，正文内路径胶囊/链接可点。

**错误处理 / 边界情况**：

- 标题行本身是 `<button>`（CollapsibleBlock.tsx:59），Eye 按钮必须用 `span role="button" tabIndex={0} + onClick(stopPropagation)`，规避嵌套 button 与误触折叠
- 显示条件统一加 `status === 'success' && !isError`；运行中/出错不显示
- Read 图片读取输出非纯文本字符串，typeof 判断自然排除
- Edit 读盘时文件已删/改：走 MarkdownFileDialog 已有 error 分支，不额外处理
- Read 截断输出末尾 `[Showing lines ...]` 提示保留在预览中（有效信息）
- 旧 SDK 会话 Read 输出带行号（`1→xxx`），预览会有行号污染，不做清洗（YAGNI，新会话均为 pi 无行号格式）

**未决问题**：

- Eye 按钮最终视觉细节（尺寸/颜色/与状态图标间距）实施时微调
- pi 渲染层 toolOutput 的具体形态（字符串 vs 对象）实施时以 SkillRenderer 现有 typeof 判断为准验证
