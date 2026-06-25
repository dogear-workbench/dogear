---
step: 4
title: 共享区瘦身（前后端联动）
status: done
---

## 目标

把共享区从「原生项 + 引用项」双段、两个 Dialog 按钮的复杂结构，瘦身成只展示 agent 写出的文件 + 「在资源管理器打开」按钮。前后端「引用项」概念整套移除。

## 依赖上下文（接力棒输入）

- 前置 step：Step 1-3 已完成（UI bug 修复 + 新建即组 + GroupCard 视觉降级）
- 关键现状（前端）：
  - `components/SharedAreaPanel.tsx`：当前展示「原生项」+「引用项」两段，顶部有 `Plus` 新建文件 Dialog 和 `Link` 添加引用 Dialog
  - `stores/group-store.ts:107` `addReference` / `:128` `removeReference` 现有
  - `types/group.ts:7-10` `SharedReference` 联合类型；`:17` `Group.sharedReferences`
- 关键现状（后端）：
  - `electron/main/services/group-shared-service.ts:81` `listReferences` / `:87` `readReferencedFile` / `:97` `validateWorkspacePath`
  - `electron/main/services/group-service.ts:87` `addReference` / `:104` `removeReference`
  - `electron/main/tipc/group.ts:50` `updateGroup` 的 patch 类型含 `sharedReferences`；`:84` `addReference` / `:105` `removeReference` / `:165` `listSharedReferences` / `:177` `readReferencedFile` 整组 IPC
  - `electron/main/agents/group-context-builder.ts:97` 把 `group.sharedReferences` 注入 system prompt
  - `electron/main/agents/tools/group-tools.ts`：MCP 工具集含 `AddGroupReference`（要删）；`ListGroupFiles` / `ReadGroupFile` / `WriteGroupFile` 描述提到「原生+引用」要更新
  - `electron/main/types.ts`：主进程类型镜像也包含 `SharedReference`
- 新增需求：`openSharedAreaInExplorer({ workspaceId, groupId })` IPC，主进程 `shell.openPath(getSharedDir(...))`

## 计划改动

### 后端类型与服务

- [ ] `types/group.ts`：删 `SharedReference` 联合类型 + `SharedReferenceBase`；`Group` 删 `sharedReferences` 字段
- [ ] `electron/main/types.ts`：镜像同步删
- [ ] `electron/main/services/group-service.ts`：删 `addReference` / `removeReference` 函数；`createGroup` 内部不再初始化 `sharedReferences: []`；`updateGroup` patch 类型去掉 `sharedReferences`
- [ ] `electron/main/services/group-shared-service.ts`：删 `listReferences` / `readReferencedFile` / `validateWorkspacePath`
- [ ] `electron/main/agents/group-context-builder.ts:96-115`：删「引用项」整段注入逻辑

### 后端 IPC

- [ ] `electron/main/tipc/group.ts`：
  - 删 `addReference` / `removeReference` / `listSharedReferences` / `readReferencedFile` 四个 procedure
  - `updateGroup` 的 `patch` 类型去掉 `sharedReferences`
  - 新增 `openSharedAreaInExplorer` procedure：
    ```ts
    openSharedAreaInExplorer: t.procedure
      .input<{ workspaceId: string; groupId: string }>()
      .action(async ({ input }) => {
        try {
          const dir = await groupSharedService.getSharedDir(input.workspaceId, input.groupId);
          const result = await electron.shell.openPath(dir);
          return { ok: !result, error: result || undefined };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })
    ```
  - 顶部 import 加 `import electron from 'electron'`
- [ ] `types/electron-api.ts`：相应签名同步（按 `.claude/rules/tipc-routes.md` 要求）

### 后端 Agent 工具

- [ ] `electron/main/agents/tools/group-tools.ts`：
  - 删 `AddGroupReference` 工具注册和实现
  - 改 `ListGroupFiles` 描述：「列出当前会话组共享区的所有文件」（去掉「原生项+引用项」分类提法）
  - 改 `ReadGroupFile` 工具：去掉 `refId` 参数和分支，统一按 `relPath`；描述更新
  - 改 `WriteGroupFile` 描述去掉「原生项」字样

### 前端 Store

- [ ] `stores/group-store.ts`：
  - 删 `addReference` / `removeReference` action 和类型
  - `updateGroup` 的 patch 类型去掉 `sharedReferences`
  - `Group` 字段 `sharedReferences` 在所有 store 内部状态里去除（包括初始化、map/filter 等地方）

### 前端 UI

- [ ] `components/SharedAreaPanel.tsx`：基本上重写
  - 删两个 Dialog（新建文件 / 添加引用）和顶部 `Plus` / `Link` 按钮
  - 删「原生项 / 引用项」分段和折叠状态（`nativeExpanded` / `refExpanded`）
  - 顶部头改为：左侧组名 + 右侧 `FolderOpen` 按钮（标题「在资源管理器打开共享目录」），onClick 调 `client.openSharedAreaInExplorer({ workspaceId, groupId })`，失败 toast
  - 主体：直接列 `nativeFiles`，每行 `预览（仅 .md）` + `删除`（Step 5 再加「引用」按钮）
  - 预览限制：`previewExt === 'md'` 才用 `MarkdownRenderer`；其他扩展名显示「不支持预览，点击在资源管理器打开」灰字提示
  - 删 `references` 相关 state 和 useEffect
  - 删除 `client.removeReference` 调用

## 验证

- 共享区头部只有「在资源管理器打开」一个按钮，点击能用资源管理器打开 `<configDir>/workspaces/<wsId>/groups/<groupId>/shared`
- 列表只列 agent 写过的文件（手测：让 agent 用 `WriteGroupFile` 写一个 `.md` 出来，看是否显示）
- 点 `.md` 文件 → 预览渲染 Markdown
- 点 `.json`/`.txt` 等非 md → 显示「不支持预览」提示
- 旧 `groups.json` 里如果有 `sharedReferences` 字段，启动应用不报错（写时被丢弃）
- Agent 工具菜单里不再有 `AddGroupReference`
- `bun run build:electron && bun run build && bun run lint` 通过

## 实施回填（做完后填）

### 实际改动

执行人：executor 子代理。9 个文件全部落地：
- `types/group.ts` — 删 SharedReferenceBase / SharedReference 联合，Group 去掉 sharedReferences
- `electron/main/types.ts` — 镜像同步
- `electron/main/services/group-service.ts` — 删 addReference / removeReference / SharedReferenceInput，createGroup 不再初始化 sharedReferences
- `electron/main/services/group-shared-service.ts` — 删 listReferences / readReferencedFile / validateWorkspacePath 及相关 import（workspaceJsonService / groupService / readWorkspaceTextFile）
- `electron/main/agents/group-context-builder.ts` — 删「引用项」整段输出
- `electron/main/tipc/group.ts` — 删四个 procedure（addReference/removeReference/listSharedReferences/readReferencedFile），新增 `openSharedAreaInExplorer`，import `electron`
- `electron/main/agents/tools/group-tools.ts` — 完全重写：删 AddGroupReference 工具，ListGroupFiles 去 section 概念，ReadGroupFile 去 refId 分支
- `stores/group-store.ts` — 删 addReference/removeReference action，updateGroup patch 类型缩减
- `components/SharedAreaPanel.tsx` — 完全重写：单一文件列表 + FolderOpen 按钮 + .md 预览 / 非 md 提示，加 previewRelPath 活跃行高亮

验证：`bun run build:electron` 通过；`bun run lint` 0 errors。

### 给下一步的接力棒

- `SharedAreaPanel` state：`nativeFiles: NativeFileEntry[]`、`previewContent / previewExt / previewRelPath`、`refreshKey`。每行用 `<SharedFileRow>`（hover 显示删除按钮）。
- 共享目录绝对路径**目前仍未在前端可见** — Step 5 需要扩展 `listSharedFiles` 返回 `{ files, sharedDir }`，前端拼 `absPath = sharedDir + '/' + relPath`。
- IPC 已有：`listSharedFiles` / `readSharedFile` / `writeSharedFile` / `deleteSharedFile` / `openSharedAreaInExplorer`。Step 5 改 `listSharedFiles` 返回结构即可。
