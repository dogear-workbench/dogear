---
paths:
  - "electron/main/tipc/**/*.ts"
---

# IPC 路由开发规则

- 新增路由文件后，必须在 `electron/main/tipc/index.ts` 中注册
- 路由 handler 的返回类型必须同步更新到 `types/electron-api.ts`
- 渲染层通过 `lib/client.ts` 的 tipc 客户端调用，不要直接使用 ipcMain/ipcRenderer
- 事件推送用 `renderer-handlers.ts` 中定义的 handler，不要自建 IPC channel
