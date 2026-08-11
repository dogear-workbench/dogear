# 附加工作区路径 实施计划

**目标**：一个工作区可挂载多个附加文件夹（每个独立开关），agent 边界动态扩展，UI 右栏改为 文件/附加/共享区 三 Tab，文件树支持文件和文件夹引用。

**架构思路**：Workspace 数据模型加 `additionalPaths: { path, enabled }[]`；`resolveWithinWorkspace` 改为 `resolveWithinPaths(roots[], candidate)` 多根校验；`WorkspaceExecutionEnv.allowedPaths` 改为可变数组，IPC 写盘后直接 `updateAllowedPaths()` 热更新到活跃会话。

**涉及模块**：workspace-json-service / workspace-boundary / WorkspaceExecutionEnv / pi-session / pi-session-manager / search-tools / tipc/workspace / workspace-store / reference-store / ui-store / page.tsx / WorkspaceExplorer / AdditionalFilesPanel（新增）/ ChatInputArea

**设计文档**：`docs/plans/2026-08/2026-08-11/workspace-additional-paths-design.md`

## 步骤索引

- [x] [Step 1: 数据模型 + 边界机制](./step1-data-boundary.md) — Workspace 加 additionalPaths 字段，边界校验改多根，WorkspaceExecutionEnv 改可变数组
- [x] [Step 2: Session 层 + IPC 热更新](./step2-session-ipc.md) — PiSession 传附加路径，IPC 增删改路由 + 热更新链路
- [x] [Step 3: UI 布局调整](./step3-layout.md) — 左栏去 Tab 只留对话列表，右栏改三 Tab，文章预览隐藏
- [x] [Step 4: 附加文件面板](./step4-additional-panel.md) — AdditionalFilesPanel 新组件：路径卡片 + 文件树 + 添加/移除/开关
- [x] [Step 5: 引用机制扩展](./step5-reference.md) — reference-store 加文件/文件夹引用，ChatInputArea 芯片，文件树引用交互，消息注入

## 全局决策

### 命名

- 数据模型字段：内部 `additionalPaths: AdditionalPath[]`，兼容格式 `additional_paths: AdditionalPathData[]`
- 边界函数：`resolveWithinPaths(roots: string[], candidate: string)` 取代 `resolveWithinWorkspace(workspacePath, candidate)`
- 热更新方法：`WorkspaceExecutionEnv.updateAllowedPaths(paths: string[])`
- 新组件：`AdditionalFilesPanel`
- ui-store Tab 类型：`rightPanelTab: 'files' | 'additional' | 'shared'`

### 数据格式

```typescript
interface AdditionalPath {
  path: string;
  enabled: boolean;
}
```

`additionalPaths` 默认值 `[]`（旧工作区迁移时自动补）。向后兼容：读取时 `workspace.additional_paths ?? []`。

### 错误处理

- 附加路径不存在：不阻止添加/开启，文件树显示空，边界校验无影响
- 热更新幂等：每次 IPC 调用都重算 `[primary, ...enabled]` 全量覆盖 allowedPaths
- 开关切换不影响当前 in-flight 工具调用，下一轮 guard 生效

### 不在本期范围

- 独立会话窗口（session-window/page.tsx）的右栏改造
- 文章预览代码删除（只隐藏不删）
- 文件树虚拟滚动/懒加载
