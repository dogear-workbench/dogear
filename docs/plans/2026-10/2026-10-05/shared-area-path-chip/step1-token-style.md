---
step: 1
title: 识别放宽与胶囊样式
status: done
---

## 目标

纯文件名路径进识别管道、MarkdownRenderer 支持额外候选根、行内 code 内纯路径脱掉灰底壳、徽章改 r 角。本步无 groupId / IPC 依赖，纯前端。

## 依赖上下文（接力棒输入）

- 设计：[design.md](./design.md)（背景与架构）
- 当前关键文件状态：
  - `components/agent-chat/path-resolve.ts:9` `REL_PATH_TOKEN_RE = /(^|[^A-Za-z0-9_.\-~@$+\\/]*)((?:[A-Za-z0-9_.\-~@$+]+[\\/])+[A-Za-z0-9_.\-~@$+]+\.(?:md|markdown|txt|json))(?![A-Za-z0-9_.\-])/gi` —— 量词 `+` 要求至少一个分隔段
  - `components/agent-chat/path-resolve.ts:65` `collectPathTokens` 中 REL token 与绝对 token 区间重叠时丢弃 REL（防误捕），放宽单段后此逻辑必须保留
  - `components/MarkdownRenderer.tsx` 行内 code 渲染器（`code:` 分支）走 `wrap(children)`，路径段已在 code 壳内变 GatedPathChip —— 这就是「灰底+徽章」双层来源
  - `components/agent-chat/path-link.tsx` PathChip className 含 `rounded-full`
- 关键决策回顾：误报由存在性校验兜底回退纯文本是管道既有原则，单段放宽沿用；放宽影响所有 workspacePath 场景（已拍板接受）

## 计划改动

- [ ] `path-resolve.ts` `REL_PATH_TOKEN_RE` 分隔段量词 `+` → `*`（允许 `xxx.md` 单段），确认后界断言 `(?![A-Za-z0-9_.\-])` 仍防粘连误吞（如 `foo.xxx.md` 不应截取 `xxx.md`）；`collectPathTokens` 逻辑不动
- [ ] `MarkdownRenderer.tsx` 新增 prop `extraRoots?: string[]`；内部 `const allRoots = useMemo(() => roots && extraRoots?.length ? [...roots, ...extraRoots] : roots, [roots, extraRoots])`，`splitPathSegments` / `resolvePathCandidates`（`renderPathSegments` 与 `openPathCandidates`）全部改用 allRoots；`mdComponents` 依赖数组同步
- [ ] `MarkdownRenderer.tsx` 行内 code 渲染器：开启路径模式（allRoots 存在）且 children 为纯 string 且 `splitPathSegments(text, allRoots)` 结果为单一 path 段时，直接渲染该段 GatedPathChip（不包 `<code>` 壳）；其余情况维持现状。注意 GatedPathChip 需要 workspaceId（组件内已有 `useWorkspaceIdByPath`）
- [ ] `path-link.tsx` PathChip 与（如有）其他胶囊 className `rounded-full` → `rounded-md`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异，逐条按计划实施。补充说明：
  - 脱壳条件用 `renderPathSegments` 存在性判断（等价于 `workspacePath && allRoots` 均非空），另加 `workspaceId` 非空检查（GatedPathChip 必需；缓存未加载时可能为 null）
  - 行内 code 内容为单一 path 段但**不存在**时：GatedPathChip 内部校验失败回退 span 纯文本（灰底壳也没了）——这是 GatedPathChip 的既有回退语义，与设计「存在性通过才脱壳」的字面差异是：PENDING/失败态下不保留 code 壳；与正文裸路径不存在时的回退行为一致，已接受
- 改动文件清单：
  - `components/agent-chat/path-resolve.ts`：`REL_PATH_TOKEN_RE` 分隔段量词 `+` → `*`，注释同步；`collectPathTokens` 未动（重叠丢弃逻辑保留）
  - `components/MarkdownRenderer.tsx`：新增 `extraRoots?: string[]` prop；`allRoots` memo（roots 为 null 或 extraRoots 空时引用不变，避免 mdComponents 无谓重建）；`openPathCandidates` / `renderPathSegments` 改用 allRoots；行内 code 脱壳；`mdComponents` 依赖数组 `roots` → `allRoots`
  - `components/agent-chat/path-link.tsx`：PathChip `rounded-full` → `rounded-md`（全局仅此一处路径胶囊形状，其余 rounded-full 均为按钮/圆点不相关）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `MarkdownRendererProps.extraRoots?: string[]`，与 `useWorkspaceRoots` 结果合并为 `allRoots`（主根 → 附加根 → extraRoots 顺序），下游 `splitPathSegments` / `resolvePathCandidates` 无感知
  - 正则：`/(^|[^A-Za-z0-9_.\-~@$+\\/]*)((?:[A-Za-z0-9_.\-~@$+]+[\\/])*[A-Za-z0-9_.\-~@$+]+\.(?:md|markdown|txt|json))(?![A-Za-z0-9_.\-])/gi`，已验证：单段/多段均捕获、`foo.xxx.md` 整体不截取、`afoo.md` 整体不截取、尾逗号排除、无扩展名不进管道
  - 行内 code 脱壳：`segments.length === 1 && type === 'path' && candidates?.length` 才脱，混合内容维持灰底壳 + 内部徽章现状
- 下个 step 该从哪里继续：step2 按 design.md「模块边界」做 groupId 链路：path-link.tsx（useExistenceResolved / GatedPathChip / PathChip 加 groupId 维度 + existenceCache key 加 groupId 段 + useSharedRoot hook）、workspace-id-context 扩展 groupId、聊天链路三文件透传 extraRoots/groupId、markdown-preview-store / MarkdownFileDialog / explorer.ts IPC。本 step 已预留 MarkdownRenderer.extraRoots 入口
- 待办或已知限制：
  - 存量既有 tsc 错误 `app/data-center/sync-user-paths.tsx:20`（`client.getAll({})` 传参给无参签名，HEAD 上已存在，与本 step 无关，未顺手修以守范围）
  - 裸文本绝对路径含空格截断局限（design.md 已声明不解决）

## 验收

- 聊天正文 / 笔记卡里出现工作区根下真实存在的纯文件名（如某 `.md` 文件名）→ 渲染为 r 角胶囊，无灰底壳
- `` `docs/plans/xx/plan.md` `` 行内 code 形式 → 单胶囊无双层嵌套
- 正文任意 `.md` 字样但文件不存在 → 纯文本不变
- `bun run lint` 0 errors、`bun x tsc -p tsconfig.json --noEmit` 全绿
