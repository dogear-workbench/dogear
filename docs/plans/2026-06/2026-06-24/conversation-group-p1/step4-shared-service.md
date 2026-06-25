---
step: 4
title: 共享区物理层
status: done
---

## 目标

实现共享区两类内容的存取：**原生项**（落在 `<configDir>/workspaces/<wsId>/groups/<gid>/shared/`）+ **引用项**（metadata 已经在 Step 1 的 `group.sharedReferences` 数组里）。提供 IPC，前端能列出/读/写/删原生项，能添加/删引用项。**Step 6 的 MCP 工具会复用这套 service**。

## 依赖上下文（执行时填）

- 前置 step 产出：[step1] group-service / Group 类型 / SharedReference 类型；[step2] tipc/group.ts 已有 addReference/removeReference
- 当前关键文件状态：执行前读 `electron/main/services/workspace-fs-service.ts`（参考路径校验 + 文件操作风格）/ `electron/main/services/safe-json.ts`（已有原子写入）
- 关键决策回顾：路径必须 `path.relative` + `startsWith` 校验防越界；workspace 内文件引用项只存路径，不复制内容

## 计划改动

### 服务层
- 新增 `electron/main/services/group-shared-service.ts`：
  - `getSharedDir(workspaceId: string, groupId: string): string`：解析绝对路径并 `fs.mkdir` 确保存在
  - `listNativeFiles(workspaceId, groupId): Promise<NativeFileEntry[]>`：递归列共享目录下的文件（不含 `.`/隐藏文件），返回 `{ relPath, size, mtime }`
  - `readNativeFile(workspaceId, groupId, relPath): Promise<string>`：UTF-8 读取
  - `writeNativeFile(workspaceId, groupId, relPath, content: string): Promise<void>`：UTF-8 写入，自动建父目录
  - `deleteNativeFile(workspaceId, groupId, relPath): Promise<void>`：删除（不删目录）
  - `listReferences(workspaceId, groupId): Promise<SharedReference[]>`：薄包装，直接读 group.sharedReferences
  - **路径校验**：每个 relPath 都用 `safeResolve(sharedDir, relPath)` 检查解析后路径是否在 sharedDir 内，越界抛错
  - 引用项路径校验：addReference 时校验 path 在 workspace 内（不能引用 workspace 外文件）

### IPC 扩展
- 修改 `electron/main/tipc/group.ts`，新增：
  - `listSharedFiles({ workspaceId, groupId })`：返回原生项列表
  - `readSharedFile({ workspaceId, groupId, relPath })`
  - `writeSharedFile({ workspaceId, groupId, relPath, content })`
  - `deleteSharedFile({ workspaceId, groupId, relPath })`
  - `listSharedReferences({ workspaceId, groupId })`：薄包装 group-service.getGroup 后取 sharedReferences
  - `readReferencedFile({ workspaceId, groupId, refId })`：解析引用项 path 后读取 workspace 内的文件（复用 workspace-fs-service）
  - addReference/removeReference 在 Step 2 已加，确认路径校验逻辑

### 类型补全
- `types/group.ts` 加：
  - `interface NativeFileEntry { relPath: string; size: number; mtime: number }`
- 主进程镜像同步

### 清理钩子
- 修改 `electron/main/services/group-service.ts` 的 `deleteGroup`：
  - 删 group 时同步删共享目录（`fs.rm -r`）
  - P1 还不级联删 conversation（Step 2 已决定组内有 conv 拒绝删）

## 验证

- `bun run build:electron` / `bun run lint` 通过
- `bun run dev` 启动后：
  - 浏览器控制台手动 `client.writeSharedFile({ workspaceId, groupId, relPath: 'test.md', content: '# hello' })` → `.dogear/workspaces/<wsId>/groups/<gid>/shared/test.md` 出现
  - 手动 `client.listSharedFiles(...)` 能返回该文件
  - 手动尝试 relPath: `'../../escape.md'` → 报路径越界错误
  - 手动 `client.addReference({ workspaceId, groupId, path: '<workspace内某文件路径>' })` → group.sharedReferences 多一条
  - 手动 addReference 一个 workspace 外的路径 → 报错
  - 删除组目录联动删除（要先把组内会话先迁走或在 IPC 调用前清空）

## 实施回填（做完后填）

### 实际改动

与计划基本一致。差异/补充：
- `deleteGroup` 联动清理用 `path.dirname(sharedDir)`，即删除整个 `<configDir>/workspaces/<wsId>/groups/<gid>/` 目录（含 shared 子目录）；清理失败仅 console.warn，不阻塞主流程
- `validateWorkspacePath` 把绝对/相对输入统一归一化为 workspace 相对路径并存到 `ref.path`，下游 `readReferencedFile` 复用 workspace-fs-service 的 `readWorkspaceTextFile`，自然受其文件类型/大小限制
- `walk` 用 fs.Dirent + 只在 isDirectory/isFile 时下钻，跳过 dotfile/dotdir；不追踪 symlink
- `safeResolve` 用 `path.normalize` + `startsWith(base + sep)` 校验，与 workspace-fs-service.resolveAndValidate 一致

改动文件清单：
1. `types/group.ts` — 末尾新增 `NativeFileEntry { relPath, size, mtime }`
2. `electron/main/types.ts` — 镜像 `NativeFileEntry`
3. `electron/main/services/group-shared-service.ts` — 新增（8 个导出函数 + 2 个内部辅助）
4. `electron/main/tipc/group.ts` — 顶部加 fs/path/groupSharedService/workspaceJsonService imports；deleteGroup 联动清理；addReference 加 workspace 路径校验；新增 6 个 procedure

### 给下一步的接力棒

- **group-shared-service API**（`electron/main/services/group-shared-service.ts`）：
  - `getSharedDir(workspaceId, groupId): Promise<string>` — 解析并 mkdir 共享根目录
  - `listNativeFiles(workspaceId, groupId): Promise<NativeFileEntry[]>` — 递归扫描
  - `readNativeFile(workspaceId, groupId, relPath): Promise<string>` — UTF-8 读
  - `writeNativeFile(workspaceId, groupId, relPath, content): Promise<void>` — 自动建父目录
  - `deleteNativeFile(workspaceId, groupId, relPath): Promise<void>`
  - `listReferences(workspaceId, groupId): Promise<SharedReference[]>` — 薄包装 getGroup
  - `readReferencedFile(workspaceId, groupId, refId): Promise<string>` — 仅 type='file'，复用 workspace-fs-service.readWorkspaceTextFile
  - `validateWorkspacePath(workspacePath, inputPath): string` — 路径必须在工作区内，返回工作区相对路径
- **路径校验函数**：内部 `safeResolve(sharedDir, relPath)` 不导出；外部用 `validateWorkspacePath`
- **新增 IPC 列表**（`electron/main/tipc/group.ts`）：
  - `client.listSharedFiles({ workspaceId, groupId }) → { files: NativeFileEntry[], error? }`
  - `client.readSharedFile({ workspaceId, groupId, relPath }) → { content, error? }`
  - `client.writeSharedFile({ workspaceId, groupId, relPath, content }) → { ok, error? }`
  - `client.deleteSharedFile({ workspaceId, groupId, relPath }) → { ok, error? }`
  - `client.listSharedReferences({ workspaceId, groupId }) → { references, error? }`
  - `client.readReferencedFile({ workspaceId, groupId, refId }) → { content, error? }`
- **待办或已知限制**：
  - `writeNativeFile` 没有大小/扩展名限制，原生项可任意类型（与 readNativeFile 的 UTF-8 解码假设矛盾——非文本文件会读出乱码）。P1 假定 Agent 工具只写文本（md / txt / json），UI 写也类似。后续如需支持二进制要拆 readBinary/writeBinary
  - `readReferencedFile` 受 workspace-fs-service.ALLOWED_TEXT_EXT 限制（.md/.markdown/.txt/.json）+ 5MB 上限；扩展引用类型时需要重新设计
  - 没做并发写互斥（共享区原生项），多窗口/多 agent 同时写同一文件可能竞态。P1 暂不处理，等出问题再补
  - `listNativeFiles` 不返回目录节点，扁平列出所有文件——UI 渲染要自己按 relPath 重建层级（Step 5 处理）
  - addReference 接 P2 的 conversation/article 类型时，需在 IPC 入参 refType 上扩展并加对应校验分支
