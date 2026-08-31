# UI 实时刷新 实施计划

**目标**：后台数据变更（会话/组、工作区文件、话题面板数据）后前端自动刷新，刷新只换数据不动 UI 状态；顺带修复 30 天自动归档死路径、清理死事件。

**架构思路**：三个数据域三套机制——会话/组走 service 层统一广播（结构操作立即、touch 类 500ms 去抖）+ 前端删手动刷新统一事件回环；文件树新建 workspace-watcher 模块（fs.watch 递归、rename-only、忽略点开头/node_modules 段、去抖广播）；TopicPanel 走 groupDataChanged 写点广播。设计全文见 [../ui-realtime-refresh-design.md](../ui-realtime-refresh-design.md)，现状盘点见会话组共享区 `reports/ui-refresh-audit.md`。

**涉及模块**：conversation-service / group-service / workspace-watcher（新）/ group-shared-service / background-store / group-digest-store / auto-archive-service / renderer-handlers / index.ts；conversation-store / workspace-store / group-store / wechat-store / TopicPanel / WorkspaceExplorer。

## 步骤索引

- [ ] [Step 1: 会话/组 service 层统一广播](./step1-service-broadcast.md) — 主进程所有会话/组写点接 broadcastListChanged（两档去抖），复用现有 conversationListChanged 事件
- [ ] [Step 2: 前端会话域收敛](./step2-frontend-converge.md) — 删十几处手动 loadConversations 统一事件回环；订阅按 workspaceId 过滤；删 group-store 死链
- [ ] [Step 3: workspace-watcher 文件树实时刷新](./step3-workspace-watcher.md) — 新建 fs.watch 模块 + workspaceFilesChanged 事件 + workspace-store 订阅 + headless-tree 展开态验证
- [ ] [Step 4: TopicPanel 写点广播](./step4-topic-panel.md) — groupDataChanged 事件 + 三个写点接线 + TopicPanel 订阅替换 refreshKey
- [ ] [Step 5: 自动归档修复 + 死事件清理](./step5-archive-fix-cleanup.md) — 归档触发点挪主进程定时；删 4 死事件 + 5 类型残留 + 相关注释

## 全局决策

- **广播机制**：`BrowserWindow.getAllWindows()` 遍历发送（跳过 isDestroyed），复用项目现有模式（参考 notes-service.ts:271、task-service.ts:26）
- **事件负载带 workspaceId**（groupDataChanged 另带 groupId）：前端 store 匹配当前工作区/组才重拉，避免无关窗口抖动
- **两档广播原则**：结构操作（create/delete/归档/移动/改名）immediate；元数据高频变化（touch/touchGroup/autoUpdateTitle/usageSummary）尾部去抖 500ms 合并
- **刷新不动 UI 状态**：所有 store 重拉只替换数据字段，选中态/展开折叠态/运行态/滚动位置不碰；唯一风险点是文件树 headless-tree 展开态（Step 3 专项验证）
- **主进程改动必须 `bun run build:electron` 重编译验证**；渲染层走 Vite 热重载；每步完成跑 `bun run lint`
- **不写注释**（项目规范），命名自明；不留 TODO stub
- Step 1 先广播、Step 2 再删前端手动刷新——中间态是「双保险幂等重拉」，无害，禁止两件事塞一步做
