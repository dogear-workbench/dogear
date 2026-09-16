# 归档 Tab 化与精简展示 实施计划

**目标**：归档从 Dialog 浮窗改为哨兵 tab 页（左话题列表 + 右精简展示），digest 摘要归档时预计算落盘，浏览只看「输入 + 最后文字结论」。

**架构思路**：前端仿文章 tab 的哨兵模式新增 `ARCHIVE_TAB_ID`；后端新增 `topic-digest-service` 在归档动作时预计算 `groups/<groupId>/digest.json`，浏览经 `getArchivedTopicDigest` 读取（缺失懒构建回写）。排除了「归档/活跃索引分文件存储」（索引轻量、查询路径分叉代价大）和「话题级一屏拼接展示」（用户拍板左侧需有会话层级，展示单位为主会话）。设计全文见 [../archive-tab-design.md](../archive-tab-design.md)。

**涉及模块**：`stores/session-store.ts`、`components/WorkspaceTabBar.tsx`、`app/page.tsx`、`components/conversation-list/ArchiveSection.tsx`、`components/archive/`（新）、`electron/main/services/topic-digest-service.ts`（新）、`electron/main/tipc/group.ts`

## 步骤索引

- [x] [Step 1: 后端 digest 服务与 IPC](./step1-digest-service.md) — digest 构建/落盘/懒构建 + archiveTopic 接入 + getArchivedTopicDigest
- [x] [Step 2: 归档 tab 与左侧列表](./step2-tab-and-list.md) — 哨兵 tab 机制、入口按钮改造、左侧话题列表（主会话行 + 子会话徽标 + 搜索 + 恢复/删除）
- [ ] [Step 3: 右侧精简展示](./step3-digest-view.md) — 点会话行拉 digest、话题级缓存、轮次流渲染、空态与错误态

## 全局决策

- digest 文件：`groups/<groupId>/digest.json`，`version: 1`；sessions 为主会话数组（created_at 升序，子会话不进 digest），turns 时间升序；完整结构见设计文档「数据流」第 3 条。
- 提取规则：轮头 = role=user 且非 isMeta、非压缩摘要/边界、非注入消息；结论 = 该轮从后往前第一个含非空 text 块的 assistant 消息的全部 text 块拼接；无结论存 null。注入 tag 集合与前端 `injection-tags.ts` 一致：delivery / reply / terminal / resume / task-execution / failover / dispatch。
- 前后端无法共享模块（rootDir 限制，见 `electron/main/tipc/agent.ts` 同类注释）：注入消息判定需在 `topic-digest-service.ts` 内实现等价逻辑，语义对齐前端 `components/agent-chat/utils.ts` 的 `isSdkInjectedUserMessage` / `isInjectedUserMessage` 与 `turns.ts` 的 `isHeader`。
- digest 数据源：`buildSessionHistory`（`electron/main/agents/pi-session/history-adapter.ts`）返回前端格式 Message[]，digest 构建直接消费该格式。
- tab 不写 localStorage（点开挂载、关闭卸载）；`ARCHIVE_TAB_ID` 必须加入 `SENTINEL_TAB_IDS`，使 CompanionPanel 自动隐藏。
- 恢复/删除复用现有 `restoreTopic` / `deleteTopic` / `showConfirm` 文案，不改语义。
- 主进程改动需 `bun run build:electron` 重新编译后才生效。
