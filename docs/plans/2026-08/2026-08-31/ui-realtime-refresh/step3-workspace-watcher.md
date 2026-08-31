---
step: 3
title: workspace-watcher 文件树实时刷新
status: pending
---

## 目标

工作区内文件/目录**增删改名**后文件树自动刷新（内容修改不触发）；新建 workspace-watcher 模块管理 fs.watch 生命周期；验证并保住 headless-tree 展开态。

## 依赖上下文（接力棒输入）

- 设计决策：见 [../ui-realtime-refresh-design.md](../ui-realtime-refresh-design.md) 决策 2 与错误处理节
- 忽略规则对齐事实：getFiles 扫描排除 node_modules + 所有 `.` 开头项（electron/main/tipc/workspace.ts:251、workspace-fs-service.ts:11）——watcher 过滤规则与之完全一致
- fs.watch 语义：`rename` = 创建/删除/重命名（处理）；`change` = 内容修改（忽略）
- 参考实现：dashboard-watcher.ts（fs.watch + 去抖 + 广播的现成模式，electron/main/services/memory/dashboard-watcher.ts）
- 前端消费方：workspace-store.loadWorkspaceFiles（全量拉 getFiles 替换文件树）；WorkspaceExplorer 是唯一树渲染组件（含手动刷新按钮 WorkspaceExplorer.tsx:870，保留作降级兜底）
- 已知无害误报：编辑器原子写（tmp+rename）会触发 rename → 多一次幂等重拉

## 计划改动

- [ ] 新建 `electron/main/services/workspace-watcher.ts`，单例模式（参考 dashboard-watcher 组织方式）：
  - 内部 `Map<workspaceId, { watcher: FSWatcher; timer?: NodeJS.Timeout }>`
  - `syncWorkspaces(workspaces: Workspace[])`：diff 当前 Map——新增的 startWatching、消失的 stopWatching、路径变化的重建
  - watch handler 纪律：**回调内零 IO、零大分配**，仅做——eventType !== 'rename' return；filename 切段（注意 Windows 反斜杠）判「任一段 `.` 开头或 === 'node_modules'」return；命中则续 500ms 尾部去抖 timer
  - timer 到期 → `BrowserWindow.getAllWindows()` 广播 `workspaceFilesChanged { workspaceId }`
  - watcher error/close：清理 entry + warn 日志，静默降级（不自动重试，重启应用或再触发 sync 才恢复——写入已知限制）
- [ ] `electron/main/index.ts`：启动时（workspaces.json 可读后）fire-and-forget `syncWorkspaces`
- [ ] workspaces.json 写入点挂钩：执行时 Grep `workspace-json-service` 的调用方（新增/删除工作区、selectFolder 改路径处），写后调 `syncWorkspaces(getAll())`
- [ ] `electron/main/tipc/renderer-handlers.ts` 加 `workspaceFilesChanged` 事件类型
- [ ] `stores/workspace-store.ts`：模块级订阅 workspaceFilesChanged，匹配当前 workspace.id 才 `loadWorkspaceFiles()`
- [ ] **headless-tree 展开态验证**（全方案唯一无现成答案的风险点）：树数据全量替换后展开状态是否保留？先实验（外部建删文件观察）；不保留则按 path 集合保存/恢复展开态（在 WorkspaceExplorer 或其 state 初始化处）
- [ ] `bun run build:electron` + `bun run lint`

## 验证

- 外部资源管理器/终端在工作区建文件、建目录、重命名、删除：≤1s 后树自动更新
- 修改文件内容（只改不增删）：树不刷新不闪
- `bun install` / git checkout：无风暴（node_modules/.git 被过滤），CPU 无尖峰
- 展开若干目录 → 触发刷新 → 展开态保留、滚动位置不跳
- session-window 窗口的文件树同样实时
- 工作区目录被外部删除：应用不崩，warn 日志，手动刷新按钮仍可用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：
- headless-tree 展开态结论与处理方式：

### 给下一步的接力棒
- watcher 对外接口（syncWorkspaces 签名等）：
- 下个 step 该从哪里继续：
- 待办或已知限制：
