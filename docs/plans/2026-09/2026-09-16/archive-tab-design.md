# 归档 Tab 化与精简展示设计

**背景**：归档话题目前以 Dialog 浮窗列出（`ArchiveSection.tsx`），查看内容需打开只读 AgentChat tab，完整渲染 thinking、工具调用等所有中间过程，噪音大且浮窗信息密度低。归档浏览的真实诉求是快速回忆「问了什么、结论是什么」。

**目标**：

- 归档从浮窗改为专门 tab 页（哨兵 tab），页内左侧话题列表、右侧精简展示。
- 右侧只展示「用户输入 + 该轮最后文字结论」，中间过程（thinking、工具调用、权限请求、注入消息等）一概不展示。
- 子会话不展示内容，仅在主会话行上显示数量徽标。
- digest（精简摘要）在归档时预计算落盘，浏览零构建成本；消息本体保留不动（恢复后继续对话依赖完整历史）。
- 恢复/永久删除保持话题级语义（主子会话一起恢复，现状不变）。

**架构**：

- **Tab 形态**：`ARCHIVE_TAB_ID = '__archive__'` 哨兵 id，仿文章 tab 的选中驱动模式（不写 localStorage，点开挂载、关闭卸载）。tab 渲染在 WorkspaceTabBar 右组（笔记/数据中心/文章同组），Archive 图标 +「归档」+ 关闭按钮。
- **入口**：左侧会话列表底部「已归档话题」按钮保留，点击从开 Dialog 改为打开归档 tab；Dialog 及浮窗逻辑删除。
- **页面布局**：左侧与现有会话列表同构——话题卡（标题 + 会话总数）展开列主会话行，子会话不出行、只显示数量徽标（数字 = buildConversationTree 挂在其下的子会话数）；右侧展示选中主会话的精简轮次流。
- **存储决策（排除项）**：会话索引不拆分归档/活跃两个文件——conversations.json 是轻量索引（几百字节/条），消息本体早已按会话分文件存于 Harness；拆索引收益小而查询路径分叉、迁移、崩溃一致性代价大。真正分出去的是 digest 摘要文件。
- **digest 落盘**：`groups/<groupId>/digest.json`，归档动作（手动 `archiveTopic` + 30 天自动归档）时预计算整个话题；恢复→再对话→再归档时整文件重算；浏览时文件缺失则懒构建一次并回写。删除话题走现有组目录级联清理，digest.json 天然带走。

**模块边界**：

- `stores/session-store.ts`：`ARCHIVE_TAB_ID`、`archiveTabOpen` 状态、`openArchiveTab` / `closeArchiveTab`（仿 dataCenter 模式，不写 localStorage）。
- `components/WorkspaceTabBar.tsx`：右组渲染归档哨兵 tab。
- `app/page.tsx`：ArchivePage 挂载点（display 切换）。
- `components/conversation-list/ArchiveSection.tsx`：删 Dialog，改为打开归档 tab 的按钮。
- `components/archive/`（新目录）：ArchivePage（左列表 + 右视图，超 300 行按列表/视图拆文件）。
- `electron/main/services/topic-digest-service.ts`（新）：digest 构建、懒构建回写。
- `electron/main/tipc/group.ts`：`archiveTopic` 接入预计算；新增 `getArchivedTopicDigest(workspaceId, groupId)`。
- 恢复（`restoreTopic`）、删除（`deleteTopic`）语义不变。

**数据流**：

1. 打开归档 tab → `listArchivedTopics`（现有）取话题 + 全部会话 → 前端 `buildConversationTree` 构树，得到主会话行与子会话数量。话题级一次拉取，跟随 group-store 的 groups 变化刷新（自动归档实时可见）。
2. 点主会话行 → `getArchivedTopicDigest(groupId)` 读 digest 文件返回；同话题切换会话行用缓存，不重复 IPC。
3. digest 结构：

```jsonc
{
  "version": 1,
  "archivedAt": 1730000000000,
  "sessions": [                      // 主会话，created_at 升序
    {
      "conversationId": "…",
      "title": "…",
      "turns": [                     // 时间升序
        { "input": "真人原话", "inputAt": …, "conclusion": "最后文字结论", "concludedAt": … }
      ]
    }
  ]
}
```

4. **提取规则**（后端，语义对齐前端 `turns.ts` 的 isHeader）：
   - 轮头 = 真人消息：role=user 且非 isMeta、非压缩摘要/边界、非注入消息（delivery / terminal / resume / task-execution / failover / dispatch 全跳过）。
   - 结论 = 该轮从后往前第一个含文字块的 assistant 消息，该消息内全部 text 块拼接；工具调用、thinking、权限请求、状态块不取。
   - 无文字结论的轮：conclusion 存 null，前端灰字「（无文字回复）」，输入仍保留。
   - 用户消息图片不进 digest，纯文本流。

**交互细节**：

- 初始进入：默认展开第一个话题并选中其第一个主会话；无归档话题整页空态。
- 搜索：按话题标题前端过滤，会话行不参与。
- 话题卡右键菜单：恢复话题 / 永久删除话题（删除沿用现有 showConfirm 文案）。
- 恢复成功：toast + 列表刷新移除；右侧正展示该话题则清为空态；不自动跳转。
- 右侧标题栏：主会话标题 +「N 个子会话」徽标（数量来自左侧树）。
- 轮次流用现有 MarkdownRenderer 渲染 input / conclusion。
- `ARCHIVE_TAB_ID` 加入 `SENTINEL_TAB_IDS`，CompanionPanel 自动不显示（现有判断覆盖）。

**错误处理 / 边界情况**：

- digest 拉取失败：右侧错误提示 + 重试按钮。
- digest 文件缺失/损坏：懒构建（读 Harness 现算）并回写，下次直接读文件。
- 会话无 sessionId（从未发消息）：右侧「（无对话内容）」空态。
- 归档话题只读：归档 tab 内无任何发送/创建入口，天然满足。
- 自动归档与 tab 浏览并发：列表事件刷新，digest 由归档流程生成不冲突。
- 子会话内容、子会话 digest：完全不做。

**未决问题**：无。
