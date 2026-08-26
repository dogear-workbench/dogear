# 会话路径直开按钮 + 引用修复 + 图片多模态 设计

**日期**：2026-08-26
**调研**：共享区 `research-render-layer.md`（渲染层与引用链路）、`research-pi-multimodal.md`（pi 多模态支持）

## 背景

三个用户痛点：
1. AI 回复正文和工具输出里的文件路径是纯文本，用户要自己去文件树找；write 工具执行完标题行只有工具名（摘要取值用了旧 SDK 的 `file_path` 字段而 pi 用 `path`），「看上去 write 后面啥也没有」。
2. 引用会话在会话区域不可见（解析正则不认 `workspaceId` 属性，内层 0 匹配 + 外层 XML 被无条件剥离）；同源 bug：文件夹引用（`type="folder"`）不可见、共享文件引用 XML 裸露正文、跨工作区提示文本残留。
3. 聊天贴图无效：`pi-session.ts` 的 `extractTextFromBlocks()` 静默丢弃 image 块（注释自述「阶段一不支持图像」），图片从未到达模型、未落盘，历史重载缩略图消失。用户已在生产环境接入 GLM glm-5.3-flash（Coding Plan），文本正常，要求图片基础功能可用。

## 目标

- A：会话渲染区所有能确定文件路径的位置渲染可点击按钮，点击弹 md 预览浮窗直接打开；write/edit 有专属渲染器，常显路径与写入结果。
- B：修复会话/文件夹/共享文件引用的渲染，剥离跨工作区提示残留。
- C：打通聊天贴图链路（渲染层→IPC→PiSession→pi harness→模型），历史回放显示缩略图；GLM 多模态开箱可用。

## 架构

### A. 路径按钮

**核心组件 `PathText`**（新建 `components/agent-chat/path-link.tsx`）：
- 输入任意文本 → 按识别规则切分为 [文本片段 | 路径片段] → 路径渲染成可点击胶囊（等宽小字 + 文件图标），其余原样。
- 识别规则（两类）：
  - 绝对路径：`[A-Za-z]:[\\/]` 开头或 `/` 开头；
  - 相对路径：含 `/` 或 `\` 分隔符且以白名单扩展名结尾（`.md/.markdown/.txt/.json`，与 readFile 白名单一致）。
- 渲染条件：`resolve(workspaceRoot, path)` 后必须落在 `workspace.path` 内（Windows 前缀比较 lowercase）且扩展名在白名单 → 渲染按钮；否则纯文本。保证不出现「点了打不开」。
- 点击 → `useMarkdownPreviewStore.open(workspaceId, resolvedPath, fileName)`，复用现有 MarkdownFileDialog 浮窗，不加新 IPC。
- workspaceId 下传：新建 `WorkspaceIdContext`（照 ConversationIdContext 先例），AgentChat 顶层 Provider 注入会话所属工作区 id；MessageItem / MarkdownRenderer / ToolBlock 消费。多工作区 tab 下取会话工作区，不取焦点工作区。

**挂载点 4 处**：
1. `MarkdownRenderer.tsx`：p/li 文本节点走 PathText（`wrapChildren` 现成入口，:27-37），行内 code 同样处理。
2. **write/edit 专属渲染器**（新组件，`tool-renderers/FileChangeRenderer.tsx`）：
   - `ContentBlockItem.tsx:199` 的大写 `['Edit','Write','Bash']` 判断改为大小写不敏感路由 write/edit 进新渲染器（Bash 回通用 ToolBlock）；入参双兼容（pi 的 `path/edits` 与旧 SDK 的 `file_path/old_string/new_string`）；`CodeChangeBlock.tsx` 退役删除，其 openInline 先例由新渲染器吸收。
   - 标题行常显：`文件路径 · 写入 N 字节 / 替换 N 处` + 状态图标；路径可点击。
   - 打开行为：write 用 `openInline`（toolInput 里有完整 content，零 IO、快照语义）；edit 用 `open` 读盘（无完整内容）。
   - 展开后输出区文本再过 PathText。
3. `ReadRenderer`（文件区路径加按钮）、`GlobRenderer`（结果行拼根）、`GrepRenderer`（`路径:行号: 内容` 只对路径部分做按钮，拼根）。
4. `ToolBlock.tsx` 的 KeyValueList / OutputBox（在 `ToolDetailShell.tsx`）：值与输出文本过 PathText，覆盖 `dogear__*` 工具输出路径。

**摘要修复**：`getToolSummary`（ToolBlock.tsx:104-110）Write/Edit 摘要取 `file_path || path`。

**排除的选项**：
- 不做「渲染前异步批量 exists 检查 + 相对路径全识别」——误判率与复杂度高，白名单扩展名 + 分隔符约束已覆盖主体（实测会话 JSONL 里 agent 用相对路径如 `docs/plans/xx.md`）。
- 不放开 readFile 工作区边界（additionalPaths / configDir 共享区不在内）——共享文件看 TopicPanel 已有入口；正文提到工作区外路径保持纯文本。
- 非 md 类扩展名（.py/.ts 等）不渲染按钮，保持纯文本。

### B. 引用修复

全部改解析端（`components/agent-chat/utils.ts` `parseUserMessageReferences`），对旧消息向后兼容，发送端不动：
1. `<conversation>` 正则（:70）加可选 `workspaceId` 属性 → 会话引用芯片恢复显示（MessageItem 芯片代码已存在 :230-241）。
2. `<file>` 正则（:52）加可选 `type` 属性 → 文件夹引用恢复；芯片按 type 显示文件夹图标。
3. 新增 `<referenced_shared_files>` 解析（剥 XML + 提 `group_id/rel_path/abs_path`）；`types.ts` ParsedUserMessage 加 `sharedFileRefs`；MessageItem 补一类只读芯片（「共享文件 · relPath」），不做点击打开（工作区外）。
4. 跨工作区提示文本（useSendMessage.ts:256-261 生成的固定文案）：解析端识别固定模式一并剥离（它是给模型的引导语）。

### C. 图片多模态

只修断点，两文件：
1. `electron/main/agents/pi-session/pi-session.ts`：`extractTextFromBlocks`（:183-192）改为分离 text 与 image——tipc 传来的 image 块（Anthropic 形状 `{type:'image', source:{type:'base64', media_type, data}}`，agent.ts:229-238）转 pi-ai `ImageContent {data, mimeType}`；`sendMessage`（:858-880）把 `images[]` 传给 adapter。
2. `electron/main/agents/pi-session/pi-harness-adapter.ts`：`prompt/steer`（:125-130）签名加 `images` 参数，透传 `harness.prompt(text, { images })` / `harness.steer(text, { images })`。

自动生效链路（已就绪）：图片进 UserMessage → pi 落 session JSONL → `history-adapter.extractUserContent`（:53-61）还原 data URL → MessageItem 缩略图（:271-281）。

**agent 读图**（read 工具读 png/jpg/gif/webp）：pi 开箱即用——read.js 对这些格式不配 imageProcessor 也直接返回 `{type:'image'}` 进 tool result，经 agent-loop 原样透传给模型（不经 Dogear 丢图代码）；BMP 需 imageProcessor，不做（罕见）。前端 toolOutput 显示 `Read image file [image/png]` 文本提示，可接受。

**GLM glm-5.3-flash**：零代码改动。生产 profile 文本已通；pi-ai 三种 wire 转换层（anthropic-messages / openai-responses / openai-completions）均有 image 实现，图片走现有 profile 协议发出。修完后实测服务端图片支持。

## 模块边界

| 文件 | 改动 |
|---|---|
| `components/agent-chat/path-link.tsx` | 新建：PathText + 路径识别/resolve 纯函数 |
| `components/agent-chat/workspace-id-context.tsx`（名实施时定） | 新建：WorkspaceIdContext |
| `components/MarkdownRenderer.tsx` | p/li/行内code 接 PathText |
| `components/agent-chat/tool-renderers/FileChangeRenderer.tsx` | 新建：write/edit 专属渲染器（双兼容新旧入参） |
| `components/agent-chat/CodeChangeBlock.tsx` | 删除（能力被 FileChangeRenderer 吸收） |
| `components/agent-chat/ContentBlockItem.tsx` | write/edit 路由（大小写不敏感）；WorkspaceIdContext 下传 |
| `components/ToolBlock.tsx` | getToolSummary 取 file_path ∥ path；KeyValueList/OutputBox 接 PathText |
| `components/agent-chat/tool-renderers/ToolDetailShell.tsx` | KeyValueList/OutputBox 文本过 PathText |
| `components/agent-chat/tool-renderers/ReadRenderer.tsx` / `GlobRenderer.tsx` / `GrepRenderer.tsx` | 路径按钮 |
| `components/AgentChat.tsx` | WorkspaceIdContext Provider |
| `components/agent-chat/utils.ts` | 引用解析正则修复 + shared_files 解析 + 提示剥离 |
| `components/agent-chat/types.ts` | ParsedUserMessage.sharedFileRefs、fileRefs type 字段、conversationRefs workspaceId |
| `components/agent-chat/MessageItem.tsx` | sharedFile 芯片、folder 图标 |
| `electron/main/agents/pi-session/pi-session.ts` | image 块→ImageContent，sendMessage 传 images（改完 build:electron） |
| `electron/main/agents/pi-session/pi-harness-adapter.ts` | prompt/steer 加 images 参数 |

## 数据流

- 路径按钮：消息渲染 → PathText 识别（workspaceRoot 从 context 的 workspaceId 查 workspace-store）→ 点击 → markdown-preview-store.open → MarkdownFileDialog → client.readFile（现有 IPC）。
- 图片上行：ChatInputArea 粘贴/选择 → PendingImage → IPC images[{media_type,data}] → tipc agent.ts 组 Anthropic 块 → PiSession.sendMessage → 转 ImageContent → adapter.prompt(text,{images}) → harness → pi-ai provider 转换 → glm-5.3-flash。
- 图片回放：session JSONL（base64 全量）→ history-adapter → data URL → MessageItem 缩略图。

## 错误处理 / 边界

- 路径误判：白名单扩展名 + 必含分隔符约束；正反斜杠都识别；不满足渲染条件一律纯文本。
- readFile 拒绝（>5MB / 越权）：浮窗现有报错路径，打开失败 toast。
- 旧消息兼容：正则全部用可选属性，无属性旧格式照常匹配。
- JSONL 膨胀：pi 原样存 base64（几百 KB~数 MB/张），接受；真成问题再外部化。
- 无 resize 压缩：图片按原尺寸进上下文（pi compaction 按 4800 字符/图估算 token）；未来增强项（imageProcessor + nativeImage resize）。
- steer（运行中插话）带图：adapter.steer 同样透传，插话图片同样落盘回放。

## 未决问题

- edit 的 diff 展示：pi 的 tool result details 里带 diff/patch，当前 `extractToolResultText` 丢弃。FileChangeRenderer 首版不做 diff（用户痛点是路径+打开），details 提取列为后续增强。
- Grep/Glob 结果在 additionalPaths 下是绝对路径（工作区外）→ 按统一规则不渲染按钮，可接受；若反馈强烈再议 readFile 边界。
- glm-5.3-flash 服务端对图片的实际行为（尺寸限制/报错格式）待修完后实测。
