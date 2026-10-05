# 共享区路径胶囊 + 路径识别放宽 实施计划

**目标**：聊天正文里共享区文件路径渲染为与工作区路径同款可点胶囊（点击开 md 预览浮窗），识别放宽到纯文件名，顺带修行内 code 双层壳与徽章形状。

**架构思路**：共享区作为「读白名单根」注入现有路径胶囊管道——三层（识别 / 校验 / 读盘）核心实现都吃 `roots: string[]`，把主进程按 workspaceId+groupId 算出的 sharedDir 追加进 roots 即可，核心逻辑零改动。排除 `dogear://` 深链（依赖 agent 写特殊链接不可控）与前端传任意 roots（破坏安全边界）。设计全文见 [design.md](./design.md)。

**涉及模块**：`path-resolve.ts` / `path-link.tsx` / `MarkdownRenderer.tsx` / `workspace-id-context.tsx` / `ContentBlockItem.tsx` / `MessageItem.tsx` / `shunt-suggestions.tsx` / `markdown-preview-store.ts` / `MarkdownFileDialog.tsx` / `electron/main/tipc/explorer.ts`

## 步骤索引

- [x] [Step 1: 识别放宽与胶囊样式](./step1-token-style.md) — 单段文件名识别 + extraRoots prop + 行内 code 脱壳 + 徽章 r 角
- [x] [Step 2: groupId 上下文与校验链贯通](./step2-group-context.md) — 会话组上下文 + useSharedRoot + 存在性校验带 groupId，共享区文件名渲染成胶囊
- [x] [Step 3: 预览读盘链路与全链路验收](./step3-preview.md) — 预览 store/读盘 IPC 带 groupId + 点击链路 + 收尾验收

## 全局决策

- **安全边界**：前端只传 groupId，sharedDir 一律主进程计算（`group-shared-service.getSharedDir`）；「根外一律 false」语义保留，只是 roots 白名单多了一项
- **roots 优先序**：主根 → 附加根 → sharedDir（共享区排最后，同文名不抢工作区路径）
- **groupId 全链路可选**（`groupId?: string`）：无组上下文（笔记卡、plan 预览）行为与现状完全一致
- **existenceCache key**：`${workspaceId}\n${groupId ?? ''}\n${path}`，防跨组串缓存
- **不改 `workspace-fs-service.ts`**：其 roots 数组签名天然支持，只在 tipc 层拼装
- **裸文本绝对路径含空格**（`Application Support`）是 PATH_TOKEN_RE 既有局限，本计划不解决，由纯文件名 / 相对形式 / md 链接覆盖主场景
- 主进程改动需 `bun run build:electron` 重新编译才生效

## 完成总结

三个 step 全部完成（commit d213a7ae / e4d3e9ae / aefb8017）。

- **识别放宽**：`REL_PATH_TOKEN_RE` 量词 `+` → `*`，纯文件名（.md/.markdown/.txt/.json）进裸路径管道，前后边界断言防粘连误吞；误报由存在性校验兑底回退纯文本
- **胶囊样式**：PathChip `rounded-full` → `rounded-md`；行内 code 整段为单一存在路径时脱壳直接渲染胶囊，无双层嵌套
- **共享区链路**：共享区作为读白名单根注入现有管道——`MarkdownRenderer.extraRoots` 追加候选根（主根 → 附加根 → sharedDir 排最后），`useSharedRoot(groupId)` 拉组共享区目录，existenceCache key 含 groupId 防跨组串缓存；前端只传 groupId，sharedDir 一律主进程计算（explorer.ts checkPathsExist / readFile 拼 roots）
- **读盘收口**：PathChip 点击兑底校验 → markdown-preview-store（state + open 末位可选参）→ MarkdownFileDialog readFile → explorer.readFile 全链路带可选 groupId；无组上下文（笔记卡 / plan 预览 / 文件树）行为与改动前一致
- **与原计划偏差**：① MessageItem/ContentBlockItem 零改动，由唯一 markdown 渲染入口 ShuntAwareMarkdown 一处取 context 贯通；② IPC 实名 listSharedFiles（计划写的 listGroupFiles 不存在）；③ PathText 顺带贯通（工具详情场景共享区路径也可识别）；④ doc-sync 的 MarkdownRenderer 主描述行在 infra.md 非 chat.md，两文件都改；⑤ 验收发现并修复 `a` 渲染器 useExistenceResolved 漏传 groupId（md 链接指向共享区文件场景）
- **已知限制**：裸文本绝对路径含空格（Application Support）被 PATH_TOKEN_RE 截断为既有局限未解；全链路验收为代码级核对（无 UI 环境），建议下次 dev 起来后顺手点一次共享区胶囊终验
