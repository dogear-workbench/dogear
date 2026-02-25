# IPC 重构设计：迁移至 @egoist/tipc

日期：2026-02-25

## 目标

用 `@egoist/tipc` 替换当前手写的 IPC 通信层，消除主进程、preload、渲染层三处类型重复维护的问题，实现端到端类型安全。

## 当前问题

- `types/electron-api.ts`（480 行）手写接口，与实现无强绑定
- `electron/preload/index.ts`（357 行）逐一手写 `ipcRenderer.invoke`，参数类型为 `any`
- channel 字符串散落三处，拼写错误运行时才发现
- main→renderer 事件无类型约束

## 新架构

### 文件结构

```
electron/
├── main/
│   ├── tipc/                        ← 新建，替换 ipc/
│   │   ├── index.ts                 ← 合并所有 router + export Router type
│   │   ├── db.ts
│   │   ├── book.ts
│   │   ├── ai.ts
│   │   ├── file.ts
│   │   ├── workspace.ts
│   │   ├── agent.ts
│   │   ├── conversations.ts
│   │   └── renderer-handlers.ts     ← main→renderer 事件
│   ├── index.ts                     ← 改用 registerIpcMain(router)
│   └── ipc/                         ← 迁移完成后删除
├── preload/
│   └── index.ts                     ← 简化为 ~15 行
src/
├── lib/
│   ├── client.ts                    ← 渲染层唯一 invoke 入口
│   └── events.ts                    ← 渲染层事件监听入口
└── types/
    └── electron.d.ts                ← window.ipcRenderer 类型声明

types/
├── electron-api.ts                  ← 迁移完成后删除
├── books.ts   ✓ 保留
├── agents.ts  ✓ 保留
└── ai.ts      ✓ 保留
```

## 关键设计决策

### Router 组织：分域合并

每个业务域独立文件，最终 spread 合并为单一 router：

```typescript
export const router = {
  ...dbRouter,
  ...bookRouter,
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
}
export type Router = typeof router
```

### 命名冲突解决

原 `book.openInFolder` 和 `file.openInFolder` 合并冲突，改名：
- `openBookInFolder(bookId: string)`
- `openFileInFolder(filePath: string)`

### Input 传参规范

tipc 的 `.input<T>()` 只接受单个参数对象，多参数需包装：

```typescript
// 原来：ipcRenderer.invoke('db:updateBook', id, data)
// 改为：
updateBook: t.procedure
  .input<{ id: string; data: Partial<Book> }>()
  .action(async ({ input }) => bookService.updateBook(input.id, input.data))
```

### main→renderer 事件

```typescript
// electron/main/tipc/renderer-handlers.ts
export const rendererHandlers = {
  analysisUpdate:            t.renderer<AnalysisUpdateData>(),
  agentTaskUpdate:           t.renderer<AgentTaskUpdate>(),
  agentStreamChunk:          t.renderer<{ taskId: string; chunk: string }>(),
  mainProcessSessionMessage: t.renderer<{ sessionId: string; message: any }>(),
  queryBasedSessionMessage:  t.renderer<{ sessionId: string; message: any }>(),
  queryBasedSessionComplete: t.renderer<{ sessionId: string; result: any }>(),
}
export type RendererHandlers = typeof rendererHandlers
```

主进程推送：
```typescript
const handlers = createRendererHandlers(rendererHandlers)
handlers.agentTaskUpdate.send(browserWindow.webContents, data)
```

### Preload 简化

```typescript
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: ipcRenderer.invoke.bind(ipcRenderer),
  on:     ipcRenderer.on.bind(ipcRenderer),
  off:    ipcRenderer.off.bind(ipcRenderer),
  send:   ipcRenderer.send.bind(ipcRenderer),
})
```

### 渲染层客户端

```typescript
// src/lib/client.ts
import { createClient } from '@egoist/tipc/renderer'
import type { Router } from '../../electron/main/tipc'

export const client = createClient<Router>({
  ipcInvoke: window.ipcRenderer.invoke,
})

// src/lib/events.ts
import { createEventHandlers } from '@egoist/tipc/renderer'
import type { RendererHandlers } from '../../electron/main/tipc/renderer-handlers'

export const rendererEvents = createEventHandlers<RendererHandlers>({
  on:   window.ipcRenderer.on,
  send: window.ipcRenderer.send,
})
```

## 渲染层调用替换规则

| 原调用 | 新调用 |
|--------|--------|
| `window.electronAPI.db.getBooks()` | `client.getBooks.invoke()` |
| `window.electronAPI.db.getBookById(id)` | `client.getBookById.invoke({ id })` |
| `window.electronAPI.book.getChapter(id)` | `client.getChapter.invoke({ chapterId: id })` |
| `window.electronAPI.book.analyze(id)` | `client.analyzeBook.invoke({ bookId: id })` |
| `window.electronAPI.agent.onTaskUpdate(cb)` | `rendererEvents.agentTaskUpdate.listen(cb)` |
| `window.electronAPI.book.onAnalysisUpdate(cb)` | `rendererEvents.analysisUpdate.listen(cb)` |

`listen()` 返回 unlisten 函数，React `useEffect` cleanup 结构不变。

## 迁移顺序

1. 安装 `@egoist/tipc`
2. 新建 `electron/main/tipc/` 全部文件（保留旧 `ipc/` 暂不删除）
3. `main/index.ts` 切换到 `registerIpcMain(router)`，移除 `registerAllHandlers()`
4. 更新 `preload/index.ts`
5. 新建 `src/lib/client.ts`、`src/lib/events.ts`、`src/types/electron.d.ts`
6. 批量替换渲染层所有 `window.electronAPI` 调用
7. 删除 `electron/main/ipc/`、`types/electron-api.ts`

## 收益

| 指标 | 迁移前 | 迁移后 |
|------|--------|--------|
| 类型维护文件数 | 3处（ipc实现+preload+types） | 1处（tipc router） |
| electron-api.ts | 480 行手写 | 删除 |
| preload/index.ts | 357 行 | ~15 行 |
| channel 拼写错误 | 运行时发现 | 编译报错 |
| 参数/返回类型 | 大量 any | 完全推导 |