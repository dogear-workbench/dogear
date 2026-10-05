# 共享区路径胶囊 + 路径识别放宽 设计

**日期**：2026-10-05
**状态**：已拍板

## 背景

- 路径胶囊体系（2026-09 计划「会话内搜索修缮 + 路径可点」，提交 `2ce9d98c`）三层（识别 / 候选生成 / 存在性校验 / 预览读盘）全部锚定工作区 roots（主根 + enabled 附加根）。共享区文件物理在 `{configDir}/workspaces/{wsId}/groups/{gid}/shared/`（应用数据目录），天然越界，agent 提到交付文件时不可点。
- 共享区文件是应用自己生成的，`sharedDir` 由主进程从 workspaceId + groupId 唯一算出（`group-shared-service.ts:17`），路径完全可控，可以白名单方式纳入。
- 裸相对路径正则（`path-resolve.ts:9` `REL_PATH_TOKEN_RE`）要求至少一个 `/` 分隔段，agent 提共享区文件最自然的写法（纯文件名，SaveSharedNote relPath 形式）根本不进管道。
- 样式痛点：① 行内 code 内路径成徽章后残留外层 `bg-muted` 灰底壳（背景+徽章双层嵌套）；② 徽章 `rounded-full` 椭圆，改 r 角。

## 目标

1. 聊天正文里共享区文件路径（纯文件名 / `shared/xxx.md` 相对形式 / md 链接）渲染为与工作区路径**同款 PathChip 胶囊**，点击开同一 md 预览浮窗。
2. 裸相对路径识别放宽到**单段文件名**（`.md/.markdown/.txt/.json`）；误报由存在性校验兜底回退纯文本（管道既有原则）。
3. 行内 code 内容为纯路径并成徽章时，脱掉外层 code 灰底壳。
4. PathChip 形状 `rounded-full` → `rounded-md`。

## 架构

**共享区作为「读白名单根」注入现有管道**。三层核心实现全部是吃 `roots: string[]` 的通用函数，把主进程算出的 sharedDir 追加进 roots 即可，识别/校验/读盘核心逻辑零改动。

排除的选项：
- `dogear://shared/` 深链：依赖 agent 主动写特殊链接，行为不可控
- 前端传任意 roots：扩大探测面，破坏「不泄露根外文件存在性」安全边界

安全语义：从「工作区文件」扩为「工作区文件 + 本组共享区」，仍为显式白名单——前端只传 groupId，目录由主进程计算，前端不能指定任意路径。

## 模块边界

| 文件 | 改动 |
|---|---|
| `components/agent-chat/path-resolve.ts` | `REL_PATH_TOKEN_RE` 放宽单段文件名（量词 `(?:...[/\\])+` → `*`，调整边界断言防误吞） |
| `components/MarkdownRenderer.tsx` | 新 prop `extraRoots?: string[]`（与 useWorkspaceRoots 结果合并，附加根之后追加）；行内 code 渲染器：开启路径模式且整段内容为单一 path 段时直接输出 GatedPathChip、不包 code 壳 |
| `components/agent-chat/path-link.tsx` | `useExistenceResolved` / `GatedPathChip` / `PathChip` 增加可选 `groupId` 维度；existenceCache key 加 groupId 段；`PathChip` className `rounded-full` → `rounded-md`；新增 `useSharedRoot(groupId)` hook（拉组 sharedDir，模块级缓存，参照 `useWorkspaceRoots` 的 external store 模式） |
| `components/agent-chat/workspace-id-context.tsx` | 扩展为同时提供 `groupId`（会话所属组），AgentChat 挂 Provider 处从 conversation 取 `groupId` |
| `components/agent-chat/ContentBlockItem.tsx` / `MessageItem.tsx` / `shunt-suggestions.tsx` | 聊天链路透传 `extraRoots`（`useSharedRoot` 结果）与 `groupId` |
| `stores/markdown-preview-store.ts` | `open` 增加 groupId 维度（state 存 groupId） |
| `components/MarkdownFileDialog.tsx` | `readFile` 调用带 groupId |
| `electron/main/tipc/explorer.ts` | `checkPathsExist` / `readFile` 入参增加可选 `groupId`，命中时 `roots.concat(await groupSharedService.getSharedDir(workspaceId, groupId))` |
| `electron/main/services/workspace-fs-service.ts` | 无改动（roots 数组透传，既有 `resolveWithinRoots` 天然支持） |

Agent 消息链路（工具返回 sharedDir 绝对路径，agent 常引用）：裸文本绝对路径含空格（`Application Support`）会被 `PATH_TOKEN_RE` 在空格处截断——**既有局限，本设计不解决**，主场景由纯文件名 + 相对形式 + md 链接覆盖。

## 数据流

1. AgentChat 渲染消息 → WorkspaceIdProvider（扩展）挂 `conversation.groupId`
2. MessageItem / ContentBlockItem / shunt-suggestions：`useSharedRoot(groupId)` → `extraRoots` 传 MarkdownRenderer
3. MarkdownRenderer 内部 `roots = [...workspaceRoots, ...(extraRoots ?? [])]` → `splitPathSegments` / `resolvePathCandidates` 复用
4. 校验：`GatedPathChip → useExistenceResolved(workspaceId, candidates, groupId)` → IPC `checkPathsExist({workspaceId, paths, groupId?})` → 主进程拼 sharedDir 进 roots
5. 点击：`PathChip(workspaceId, groupId)` 兜底校验 → `markdownPreviewStore.open(workspaceId, path, name, groupId)` → Dialog `readFile({workspaceId, path, groupId?})`

## 错误处理 / 边界

- 组已删除 / 归档：`useSharedRoot` 拉不到 → extraRoots 缺省，回退纯文本（安全降级）
- roots 优先序：主根 → 附加根 → sharedDir（共享区排最后，不抢工作区路径）
- personal 临时会话：每会话一隐式单会话组，同样有 sharedDir，链路天然支持
- 单段放宽影响所有 `workspacePath` 场景（聊天正文 / 笔记卡 / plan 预览 / 任务详情）：纯文件名在工作区根或共享区真实存在即成胶囊——已拍板接受
- 行内 code 脱壳仅当**整段内容**为单一 path 段且存在性通过；混合内容维持现状
- existenceCache 负值 TTL 30s / 批量聚合 / 30ms debounce 既有机制不动，仅 key 加维度

## 未决问题

- 无。AgentChat 挂 Provider 处取 conversation 的具体位置在实施 step 中确认。
